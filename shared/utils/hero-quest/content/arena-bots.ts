/**
 * Arena bots: opponents the game fields when too few players are in a Rating band (the user's call,
 * 2026-10-11). The list fills with real players first, then bots in band, then Training Dummies.
 *
 * **Content, not accounts.** A bot has no `user` or `hq_state` row, so it can never reach a
 * leaderboard, a season's standings or anything else that reads players. Its Rating is fixed: an
 * attack moves the attacker's Rating against it, never its own.
 *
 * Every bot is a Beginner, as class switching opens at the first prestige and the Arena before it.
 * The loadout is drawn from a seed per bot, scaled by its Rating through `ARENA_BOT_LOADOUT`, so the
 * same bot fields the same party on every list and every fight. A roster edit may re-cut them;
 * saves only ever hold the ID, on a candidate list or in the battle log.
 */

import { ARENA_BOT_LOADOUT, ARENA_BOT_RATING_MAX, BASE_ARTIFACT_SLOTS, BASE_SKILL_SLOTS } from '../constants'
import { seededRandom } from '../fight'
import type { FormationRow, OwnedCopy, Rarity } from '../types'
import { ARCHETYPE_BY_ID, CHAMPIONS } from './champions'
import { GEAR_SLOTS, gearIdFor } from './gear'
import { SKILLS } from './skills'
import { ARTIFACTS } from './artifacts'

export interface ArenaBot {
    /** `bot_<name>`: stable, and never a user ID (those are UUIDs) or the dummy's sentinel. */
    id: string
    name: string
    rating: number
    heroLevel: number
    champions: readonly (OwnedCopy & { row: FormationRow })[]
    /** Equipped, filling the slots a player starts with: a bot has bought none. */
    skills: readonly OwnedCopy[]
    artifacts: readonly OwnedCopy[]
    /** One piece per Gear slot, all equipped. */
    gear: readonly OwnedCopy[]
}

/** Name and Rating, highest first. The Ratings stop at `ARENA_BOT_RATING_MAX`; the spacing is a guess. */
const ROSTER: readonly (readonly [name: string, rating: number])[] = [
    ['Mossfoot', 1000],
    ['Ashwyn', 975],
    ['Corvel', 950],
    ['Dunmere', 900],
    ['Elsbeth', 850],
    ['Fenwick', 800],
    ['Garrow', 750],
    ['Hollis', 700],
    ['Ivers', 625],
    ['Juniper', 550]
]

export const ARENA_BOT_PREFIX = 'bot_'

/** A seed from the ID, so a bot's draw never depends on where it sits in the roster. */
function seedOf(id: string): number {
    let h = 2166136261
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
    return h >>> 0
}

function generate(name: string, rating: number, low: number): ArenaBot {
    const id = `${ARENA_BOT_PREFIX}${name.toLowerCase()}`
    const random = seededRandom(seedOf(id))
    const t = ARENA_BOT_RATING_MAX > low ? (rating - low) / (ARENA_BOT_RATING_MAX - low) : 1
    const at = (range: { low: number, high: number }) => range.low + (range.high - range.low) * t
    const L = ARENA_BOT_LOADOUT

    const rarity = (): Rarity => {
        const r = random()
        return r < at(L.rareChance) ? 'rare' : r < at(L.rareChance) + at(L.uncommonChance) ? 'uncommon' : 'common'
    }
    const copy = (contentId: string): OwnedCopy => ({
        contentId,
        star: random() < at(L.starChance) ? 1 : 0,
        level: 1 + Math.floor(random() * Math.round(at(L.maxLevel)))
    })
    /** `count` distinct entries, each of a rarity rolled for it, falling back to any not yet taken. */
    const pick = <T extends { id: string, rarity: Rarity }>(pool: readonly T[], count: number): T[] => {
        const taken: T[] = []
        while (taken.length < count) {
            const want = rarity()
            const left = pool.filter(entry => !taken.includes(entry))
            const fits = left.filter(entry => entry.rarity === want)
            const from = fits.length ? fits : left
            if (!from.length) break
            taken.push(from[Math.floor(random() * from.length)]!)
        }
        return taken
    }

    return {
        id,
        // marked as a bot wherever it shows; the ID and seed keep the bare name, so loadouts don't move
        name: `Bot ${name}`,
        rating,
        heroLevel: Math.round(at(L.heroLevel)),
        champions: pick(CHAMPIONS, Math.round(at(L.champions)))
            .map(champion => ({ ...copy(champion.id), row: ARCHETYPE_BY_ID[champion.archetype].defaultRow })),
        skills: pick(SKILLS, BASE_SKILL_SLOTS).map(skill => copy(skill.id)),
        artifacts: pick(ARTIFACTS, BASE_ARTIFACT_SLOTS).map(artifact => copy(artifact.id)),
        gear: GEAR_SLOTS.map(slot => copy(gearIdFor(slot, rarity())))
    }
}

let roster: readonly ArenaBot[] | null = null

/** The whole roster, drawn on first use (the seeded draw reads content that must be loaded first). */
export function arenaBots(): readonly ArenaBot[] {
    if (!roster) {
        const low = Math.min(...ROSTER.map(([, rating]) => rating))
        roster = ROSTER.map(([name, rating]) => generate(name, rating, low))
    }
    return roster
}

export function isArenaBotId(id: string): boolean {
    return id.startsWith(ARENA_BOT_PREFIX)
}

export function getArenaBot(id: string): ArenaBot | undefined {
    return isArenaBotId(id) ? arenaBots().find(bot => bot.id === id) : undefined
}
