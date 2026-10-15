import { TOWN_MILESTONES } from './town'
import { TOWN_MONUMENT_STAGES, isTownMonumentId } from './town-monuments'
import { VOID_MAX_SECTOR, VOID_SHIP_IDS, VOID_TRADE_MAX_LEVEL, voidNormalizeLevels } from './void'
import { voidPilotLevel } from './void-skills'
import { WORLD_COUNT } from '../hero-quest/constants'
import { GACHA_CONTENT } from '../hero-quest/content/registry'

/**
 * What Polytown, Void Runner and Hero Quest add to the site scoreboard.
 *
 * The score is a plain count of upgrades, so each game contributes the things
 * that are counted the same way: permanent, one point each, and earned by
 * playing rather than by spending. Anything a player can mint or lose is left
 * out on purpose: buildings and plots can be bulldozed or traded, crafted gear
 * can be scrapped and re-rolled. Polytown and Void Runner top out near Xeno's 85 points, so
 * neither decides the board alone; Hero Quest's collection counts as a completion percentage, so it
 * stops at 100, and its worlds add ten a run.
 */

const MILESTONE_IDS = new Set(TOWN_MILESTONES.map(m => m.id))

export interface TownScore {
    milestones: number
    monuments: number
    total: number
}

/**
 * Milestones claimed plus monument stages standing. A monument can be moved
 * but never torn down, so its stages are as permanent as a milestone. Ids the
 * game no longer has don't count, and each monument counts once, capped at
 * its last stage.
 */
export function townScore(milestonesClaimed: readonly string[], monuments: readonly { type: string, level: number }[]): TownScore {
    const milestones = new Set(milestonesClaimed.filter(id => MILESTONE_IDS.has(id))).size
    const best = new Map<string, number>()
    for (const m of monuments) {
        if (!isTownMonumentId(m.type)) continue
        best.set(m.type, Math.max(best.get(m.type) ?? 0, Math.max(0, Math.min(TOWN_MONUMENT_STAGES, m.level))))
    }
    const stages = [...best.values()].reduce((sum, n) => sum + n, 0)
    return { milestones, monuments: stages, total: milestones + stages }
}

export interface VoidScoreInput {
    runsPlayed: number
    highestSectorCleared: number
    pilotXp: number
    ownedShipIds: readonly string[]
    upgradeLevels: Record<string, unknown> | null
    tradeLevel: number
}

export interface VoidScore {
    sectors: number
    pilotLevel: number
    hulls: number
    systems: number
    trade: number
    total: number
}

const VOID_SCORE_NONE: VoidScore = { sectors: 0, pilotLevel: 0, hulls: 0, systems: 0, trade: 0, total: 0 }

/**
 * Sectors cleared, pilot level, hulls owned, station system levels and trade
 * contracts. A pilot who never launched scores nothing, so opening the hangar
 * once isn't worth the starter hull and level 1.
 */
export function voidScore(s: VoidScoreInput): VoidScore {
    if (s.runsPlayed <= 0) return VOID_SCORE_NONE
    const sectors = Math.max(0, Math.min(VOID_MAX_SECTOR, s.highestSectorCleared))
    const pilotLevel = voidPilotLevel(s.pilotXp)
    const hulls = new Set(s.ownedShipIds.filter(id => VOID_SHIP_IDS.includes(id))).size
    const systems = Object.values(voidNormalizeLevels(s.upgradeLevels)).reduce((sum, n) => sum + n, 0)
    const trade = Math.max(0, Math.min(VOID_TRADE_MAX_LEVEL, s.tradeLevel))
    return { sectors, pilotLevel, hulls, systems, trade, total: sectors + pilotLevel + hulls + systems + trade }
}

export interface HeroQuestScoreInput {
    prestige: number
    /** The World the run stands in, 1-based. */
    world: number
    runCleared: boolean
    /** Collection entries owned, across all four gachas. */
    entriesOwned: number
}

export interface HeroQuestScore {
    worlds: number
    /** Collection completion, 0–100: the share of every gacha entry owned, rounded. */
    collection: number
    total: number
}

/** Every entry across the four gachas (168 today: Skills 36, Gear 36, Champions 48, Artifacts 48). */
export const HERO_QUEST_COLLECTION_SIZE = Object.values(GACHA_CONTENT).reduce((sum, c) => sum + c.entries.length, 0)

/**
 * Worlds cleared, every run counted, plus collection completion as a whole percentage.
 *
 * Entries counted a point each from 2026-10-11 (#23); on 2026-10-15 (#35) the collection became
 * `round(owned / 168 × 100)`, so an entry is worth about 0.6 of a point and a full collection no
 * longer outweighs two other games. Entries come from pulls, which Gold can buy, so they stay the
 * smaller share. Levels and stages were weighed and left out: both run into the hundreds and would
 * decide the board, and a level is bought with pulls as much as it is played for.
 */
export function heroQuestScore(s: HeroQuestScoreInput): HeroQuestScore {
    const prestige = Math.max(0, Math.floor(s.prestige))
    const inRun = Math.max(0, Math.min(WORLD_COUNT, Math.floor(s.world) - 1 + (s.runCleared ? 1 : 0)))
    const worlds = prestige * WORLD_COUNT + inRun
    const owned = Math.max(0, Math.min(HERO_QUEST_COLLECTION_SIZE, Math.floor(s.entriesOwned)))
    const collection = Math.round(owned / HERO_QUEST_COLLECTION_SIZE * 100)
    return { worlds, collection, total: worlds + collection }
}
