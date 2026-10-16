import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { hackerzState } from '#server/database/schema'
import {
    hackerzDifficulty,
    hackerzMainframeEffects,
    hackerzPayoutForRun,
    type HackerzMainframeLevels
} from '#shared/utils/gamelogic/hackerz'

export async function getLockedHackerzState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(hackerzState).where(eq(hackerzState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Hackerz state not initialized' })
    return state
}

export interface HackerzLevelState {
    bulwarkLevel: number
    munitionsLevel: number
    foundryLevel: number
    grantLevel: number
    salvageLevel: number
    capacitorLevel: number
    charterLevel: number
    arsenalLevel: number
    scannerLevel: number
    blipLevel: number
    whitehatLevel: number
    surgeLevel: number
}

export function hackerzLevels(state: HackerzLevelState): HackerzMainframeLevels {
    return {
        bulwark: state.bulwarkLevel,
        munitions: state.munitionsLevel,
        foundry: state.foundryLevel,
        grant: state.grantLevel,
        salvage: state.salvageLevel,
        capacitor: state.capacitorLevel,
        charter: state.charterLevel,
        arsenal: state.arsenalLevel,
        scanner: state.scannerLevel,
        blip: state.blipLevel,
        whitehat: state.whitehatLevel,
        surge: state.surgeLevel
    }
}

export const HACKERZ_LEVEL_COLUMN = {
    bulwark: 'bulwarkLevel',
    munitions: 'munitionsLevel',
    foundry: 'foundryLevel',
    grant: 'grantLevel',
    salvage: 'salvageLevel',
    capacitor: 'capacitorLevel',
    charter: 'charterLevel',
    arsenal: 'arsenalLevel',
    scanner: 'scannerLevel',
    blip: 'blipLevel',
    whitehat: 'whitehatLevel',
    surge: 'surgeLevel'
} as const

export interface HackerzSettlementState {
    runDifficultySnapshot: string | null
    runCoinMultiplierSnapshot: string | null
    runsPlayed: number
    totalCoinsEarned: string
    bestWave: number
    bestKills: number
    bestPayout: number
    victories: number
}

export interface HackerzRunReport {
    reason: 'victory' | 'defeat' | 'retire'
    reportedWave: number
    reportedCoins: number
    reportedKills: number
}

/**
 * Turns a finished run into the row it should leave behind.
 *
 * The coin multiplier comes off the snapshot taken at deploy, never from the
 * account's current Salvage level, so buying Salvage between runs cannot
 * retroactively inflate coins an earlier run already banked.
 */
export function settleHackerzRun(state: HackerzSettlementState, report: HackerzRunReport) {
    const difficulty = hackerzDifficulty(state.runDifficultySnapshot)
    const coinMultiplier = Number(state.runCoinMultiplierSnapshot ?? '1') || 1
    const wave = Math.max(0, Math.floor(report.reportedWave))
    const kills = Math.max(0, Math.floor(report.reportedKills))
    const banked = Math.max(0, Math.floor(report.reportedCoins))
    const awarded = hackerzPayoutForRun(banked, wave, difficulty, coinMultiplier)

    return {
        awarded,
        capped: awarded < banked,
        difficulty,
        wave,
        kills,
        victory: report.reason === 'victory',
        runsPlayed: state.runsPlayed + 1,
        totalCoinsEarned: (Number(state.totalCoinsEarned) + awarded).toFixed(4),
        bestWave: Math.max(state.bestWave, wave),
        bestKills: Math.max(state.bestKills, kills),
        bestPayout: Math.max(state.bestPayout, awarded),
        victories: report.reason === 'victory' ? state.victories + 1 : state.victories
    }
}

/** Coin multiplier a deploying run should be stamped with. */
export function hackerzCoinMultiplier(levels: HackerzMainframeLevels) {
    return hackerzMainframeEffects(levels).coins
}
