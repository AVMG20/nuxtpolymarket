/**
 * Arena rules (`arena.md`): seasons, the daily attempts and their Gem ladder, asymmetric Elo,
 * Medals, the matchmaking band, the Arena Shop's catalogue and the season rewards.
 *
 * Pure, like everything in `shared/`: no clock and no randomness of its own. A caller hands in the
 * time and, for the candidate draw, the random source; the server applies every result under the
 * `hq_state` row locks (`server/utils/hero-quest-arena.ts`), and the client reads the same functions
 * to show prices and countdowns.
 */

import {
    ARENA_CANDIDATE_COUNT,
    ARENA_ELO_SCALE,
    ARENA_EXTRA_ATTEMPT_BASE_GEMS,
    ARENA_EXTRA_ATTEMPT_GROWTH,
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_FREE_REFRESHES_PER_DAY,
    ARENA_MATCH_BAND_RATING,
    ARENA_REFRESH_BASE_GEMS,
    ARENA_REFRESH_GROWTH,
    ARENA_RATING_FLOOR,
    ARENA_RATING_START,
    ARENA_SEASON_DAYS,
    ARENA_SEASON_EPOCH_MS,
    ARENA_SEASON_REWARDS,
    ARENA_SHOP_GEM_PRICE,
    ARENA_SHOP_KEY_LEVEL,
    ARENA_SHOP_TRAIT_KEY_PRICE,
    ARENA_SHOP_SEAL_PRICE,
    K_ATTACK,
    K_DEFEND,
    MEDAL_BASE_LOSS,
    MEDAL_BASE_WIN,
    MEDAL_UPSET_BONUS,
    TRAIT_SLOT_COUNT
} from './constants'
import { RAIDS, getRaid, type RaidId } from './content/raids'
import { raidReward } from './raids'
import type { GachaSystem } from './gacha'
import { traitSlotOf, type TraitBoard, type TraitSlotState } from './traits'
import type { FormationRow } from './types'

const DAY_MS = 86_400_000
const SEASON_MS = ARENA_SEASON_DAYS * DAY_MS

/** A Trait slot as the defence keeps it: what it rolled. */
export interface ArenaDefenseTrait { stat: string, grade: string, set: string }

/**
 * The stored defence (§1): the same five components a Loadout captures (`loadouts.md` §1), Gear
 * included, and the Trait board, kept apart from the live ones so attack and defence diverge by
 * design. The selection is frozen until the player sets the defence again; its stats are not:
 * IDs only, so star and level are read from the defender's collection, and hero level, the Passive
 * Skill Tree, the Shop's stat tracks and the collection passives from the account as it stands
 * (issue #32, the user's call 2026-10-15).
 */
export interface ArenaDefenseLoadout {
    partyChampionIds: string[]
    formation: Record<string, FormationRow>
    equippedSkillIds: string[]
    equippedArtifactIds: string[]
    equippedGear: Record<string, string>
    /**
     * The Trait board as it was set, by slot index, null for an empty slot. Absent on a defence set
     * before Traits were frozen with it (2026-10-15): that one fights on the live board until it is
     * set again.
     */
    traits?: (ArenaDefenseTrait | null)[]
}

/** A Trait board as the defence stores it: each slot's roll, the lock left behind. */
export function defenseTraitsFrom(board: TraitBoard): (ArenaDefenseTrait | null)[] {
    return Array.from({ length: TRAIT_SLOT_COUNT }, (_, i) => {
        const slot = board[i]
        return slot ? { stat: slot.stat, grade: slot.grade, set: slot.set } : null
    })
}

/** The Trait board the defence fights on: its own, or `live` for a defence stored without one. */
export function defenseTraitBoard(defense: ArenaDefenseLoadout, live: TraitBoard): TraitBoard {
    if (!defense.traits) return live
    return Array.from({ length: TRAIT_SLOT_COUNT }, (_, i): TraitSlotState | null => {
        const slot = defense.traits![i]
        return slot ? traitSlotOf({ ...slot, locked: false }) : null
    })
}

// ── Seasons ────────────────────────────────────────────────────────────────────────

/**
 * The season running at `now`: 1 from `ARENA_SEASON_EPOCH_MS`, one more every `ARENA_SEASON_DAYS`.
 * Every player shares it, so a season ends for everyone at once, settled by whichever read comes
 * first after it (`tech-architecture.md` §4a: no cron).
 */
export function arenaSeasonAt(now: number): number {
    return Math.max(1, Math.floor((now - ARENA_SEASON_EPOCH_MS) / SEASON_MS) + 1)
}

export function arenaSeasonStartsAt(season: number): number {
    return ARENA_SEASON_EPOCH_MS + (Math.max(1, season) - 1) * SEASON_MS
}

export function arenaSeasonEndsAt(season: number): number {
    return arenaSeasonStartsAt(season) + SEASON_MS
}

/** A player's Arena standing as stored: the season it belongs to, and that season's Rating and matches. */
export interface ArenaStanding {
    season: number
    rating: number
    matches: number
}

/**
 * A standing carried into `season`: unchanged within its own season, back to the start (§7) once a
 * later one has begun. Never backwards: a standing already in a later season than the caller's
 * clock says (another request rolled it a moment after this one read the time) stays where it is.
 */
export function rollStanding(stored: ArenaStanding, season: number): ArenaStanding {
    if (stored.season >= season) return stored
    return { season, rating: ARENA_RATING_START, matches: 0 }
}

/** The Rating a player fights at in `season`: their own within it, the starting Rating otherwise. */
export function ratingIn(stored: ArenaStanding, season: number): number {
    return rollStanding(stored, season).rating
}

/** What a final rank pays (§7), in Medals: the first row it is within. */
export function seasonRewardFor(rank: number): number {
    const row = ARENA_SEASON_REWARDS.find(r => rank <= r.maxRank)
    return row?.medals ?? 0
}

/**
 * Final ranks for a season's standings, highest Rating first. Ties share a rank and the next rank
 * skips past them (1, 2, 2, 4): no player is ranked below anyone they matched.
 */
export function rankStandings<T extends { rating: number }>(rows: readonly T[]): (T & { rank: number })[] {
    const sorted = [...rows].sort((a, b) => b.rating - a.rating)
    let rank = 0
    return sorted.map((row, i) => {
        if (i === 0 || row.rating !== sorted[i - 1]!.rating) rank = i + 1
        return { ...row, rank }
    })
}

// ── Attempts ───────────────────────────────────────────────────────────────────────

/** Today's attacks as stored: the UTC day they count for, attacks made, extra attacks bought. */
export interface ArenaAttempts {
    date: string | null
    used: number
    purchased: number
}

/**
 * Today's counters: as stored on the same UTC day, back to none on a new one (§3: free attacks do
 * not bank, and the extra-attack ladder starts over). `today` is a `ladderDateKey`.
 */
export function attemptsOn(stored: ArenaAttempts, today: string): ArenaAttempts {
    if (stored.date === today) return stored
    return { date: today, used: 0, purchased: 0 }
}

/** Attacks left today: the free ones and those bought, less those made. */
export function attemptsLeft(today: ArenaAttempts): number {
    return Math.max(0, ARENA_FREE_ATTEMPTS_PER_DAY + today.purchased - today.used)
}

/** Today's list redraws as stored: the UTC day they count for, and how many were made. */
export interface ArenaRefreshes {
    date: string | null
    used: number
}

/** Today's redraws: as stored on the same UTC day, back to none on a new one. */
export function refreshesOn(stored: ArenaRefreshes, today: string): ArenaRefreshes {
    return stored.date === today ? stored : { date: today, used: 0 }
}

/** The next redraw's Gem price after `usedToday` today: free for the first two, then 5, 10, 20, … */
export function refreshPrice(usedToday: number): number {
    const paid = Math.max(0, Math.floor(usedToday)) - ARENA_FREE_REFRESHES_PER_DAY
    return paid < 0 ? 0 : Math.round(ARENA_REFRESH_BASE_GEMS * ARENA_REFRESH_GROWTH ** paid)
}

/** The price of the next extra attack, after `purchasedToday` bought today: 10, 20, 40, … Gems (§3). */
export function extraAttemptPrice(purchasedToday: number): number {
    return Math.round(ARENA_EXTRA_ATTEMPT_BASE_GEMS * ARENA_EXTRA_ATTEMPT_GROWTH ** Math.max(0, Math.floor(purchasedToday)))
}

// ── Rating ─────────────────────────────────────────────────────────────────────────

/** `expectedAttacker` (§4): the attacker's chance of winning, by the Elo curve. */
export function expectedScore(attackerRating: number, defenderRating: number): number {
    return 1 / (1 + 10 ** ((defenderRating - attackerRating) / ARENA_ELO_SCALE))
}

export interface RatingChange {
    before: number
    after: number
    /** `after − before`: what the floor left of the delta. */
    change: number
}

function moved(before: number, delta: number): RatingChange {
    const after = Math.max(ARENA_RATING_FLOOR, before + Math.round(delta))
    return { before, after, change: after - before }
}

/**
 * One match's Rating update (§4), asymmetric:
 *
 *     attacker' = attacker + K_ATTACK × (actual − expectedAttacker)
 *     defender' = defender + K_DEFEND × ((1 − actual) − expectedDefender)
 *
 * Each delta is rounded to a whole point and the result floored at `ARENA_RATING_FLOOR`.
 */
export function eloUpdate(attackerRating: number, defenderRating: number, attackerWon: boolean): {
    expectedAttacker: number
    attacker: RatingChange
    defender: RatingChange
} {
    const expectedAttacker = expectedScore(attackerRating, defenderRating)
    const actual = attackerWon ? 1 : 0
    return {
        expectedAttacker,
        attacker: moved(attackerRating, K_ATTACK * (actual - expectedAttacker)),
        defender: moved(defenderRating, K_DEFEND * ((1 - actual) - (1 - expectedAttacker)))
    }
}

/**
 * What an attack pays the attacker (§5). A win scales with how unlikely it was; a loss pays the
 * flat floor. `expectedAttacker` null is a Training Dummy, which pays the base win flat (§2a).
 */
export function medalsFor(won: boolean, expectedAttacker: number | null): number {
    if (!won) return MEDAL_BASE_LOSS
    if (expectedAttacker === null) return MEDAL_BASE_WIN
    return Math.round(MEDAL_BASE_WIN * (1 + MEDAL_UPSET_BONUS * (1 - expectedAttacker)))
}

// ── Matchmaking ────────────────────────────────────────────────────────────────────

/** The Rating band around an attacker's Rating a defender's must fall in (§2): ±`ARENA_MATCH_BAND_RATING`. */
export function matchBand(attackerRating: number, width = ARENA_MATCH_BAND_RATING): { lo: number, hi: number } {
    return { lo: attackerRating - width, hi: attackerRating + width }
}

export function inMatchBand(attackerRating: number, defenderRating: number, width = ARENA_MATCH_BAND_RATING): boolean {
    const band = matchBand(attackerRating, width)
    return defenderRating >= band.lo && defenderRating <= band.hi
}

/**
 * The opponent list (§2, §2a): up to `ARENA_CANDIDATE_COUNT` distinct players drawn at random from
 * the in-band pool, then in-band Arena bots for the slots players can't fill (the user's call,
 * 2026-10-11), and a Training Dummy (`null`) for any slot still empty. The band is never widened to
 * fill one.
 *
 * `pick(n)` returns a uniform index in `[0, n)`; the server passes `#shared/utils/random`, so the
 * draw is a CSPRNG one while this stays pure and testable.
 */
export function drawCandidates(pool: readonly string[], pick: (n: number) => number, bots: readonly string[] = [], count = ARENA_CANDIDATE_COUNT): (string | null)[] {
    const drawn: (string | null)[] = []
    for (const from of [pool, bots]) {
        const left = [...new Set(from)]
        while (drawn.length < count && left.length > 0) {
            const at = Math.min(left.length - 1, Math.max(0, Math.floor(pick(left.length))))
            drawn.push(left.splice(at, 1)[0]!)
        }
    }
    while (drawn.length < count) drawn.push(null)
    return drawn
}

// ── The Arena Shop ─────────────────────────────────────────────────────────────────

export type ArenaShopItem =
    | { id: string, kind: 'seals', system: GachaSystem, price: number }
    | { id: string, kind: 'keys', raid: RaidId, price: number }
    | { id: string, kind: 'gems', price: number }

const SEAL_SYSTEMS: readonly GachaSystem[] = ['champion', 'skill', 'artifact', 'gear']

/**
 * A raid Key's Medal price: for a Seal raid, the Seals a clear pays at `ARENA_SHOP_KEY_LEVEL` at the
 * Seal's own price; the Trait raid, which pays Trait Gems, at its own.
 */
export function arenaKeyPrice(raid: RaidId): number {
    if (!getRaid(raid).pairedSystem) return ARENA_SHOP_TRAIT_KEY_PRICE
    return raidReward(raid, ARENA_SHOP_KEY_LEVEL) * ARENA_SHOP_SEAL_PRICE
}

/**
 * Everything the shop sells, one unit each (§6): all four Seals, all five raids' Keys, and Gems at
 * the deliberately bad rate. No Gold (the user's call, 2026-10-10). IDs are stable; a purchase names one.
 */
export const ARENA_SHOP: readonly ArenaShopItem[] = [
    ...SEAL_SYSTEMS.map(system => ({ id: `seals_${system}`, kind: 'seals' as const, system, price: ARENA_SHOP_SEAL_PRICE })),
    ...RAIDS.map(raid => ({ id: `keys_${raid.id}`, kind: 'keys' as const, raid: raid.id, price: arenaKeyPrice(raid.id) })),
    { id: 'gems', kind: 'gems', price: ARENA_SHOP_GEM_PRICE }
]

export function arenaShopItem(id: unknown): ArenaShopItem | null {
    return ARENA_SHOP.find(item => item.id === id) ?? null
}

/** A Training Dummy slot's sentinel on the wire, where a real candidate's user ID would be. */
export const ARENA_DUMMY_ID = 'training_dummy'
