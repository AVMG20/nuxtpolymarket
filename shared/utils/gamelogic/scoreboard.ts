import { TOWN_MILESTONES } from './town'
import { TOWN_RESEARCH } from './town-research'
import { VOID_MAX_SECTOR, VOID_SHIP_IDS, VOID_TRADE_MAX_LEVEL, voidNormalizeLevels } from './void'
import { voidPilotLevel } from './void-skills'

/**
 * What Polytown and Void Runner add to the site scoreboard.
 *
 * The score is a plain count of upgrades, so each game contributes the things
 * that are counted the same way: permanent, one point each, and earned by
 * playing rather than by spending. Anything a player can mint or lose is left
 * out on purpose: buildings and plots can be bulldozed or traded, crafted gear
 * can be scrapped and re-rolled. Both games top out near Xeno's 85 points, so
 * none of them decides the board alone.
 */

const MILESTONE_IDS = new Set(TOWN_MILESTONES.map(m => m.id))
const RESEARCH_IDS = new Set(TOWN_RESEARCH.map(r => r.id))

export interface TownScore {
    milestones: number
    research: number
    total: number
}

/** Milestones claimed plus research finished. Ids the game no longer has don't count. */
export function townScore(milestonesClaimed: readonly string[], researchIds: readonly string[]): TownScore {
    const milestones = new Set(milestonesClaimed.filter(id => MILESTONE_IDS.has(id))).size
    const research = new Set(researchIds.filter(id => RESEARCH_IDS.has(id))).size
    return { milestones, research, total: milestones + research }
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
