import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { hackerzState } from '#server/database/schema'
import {
    HACKERZ_MAX_WAVE,
    hackerzDifficulty,
    hackerzMainframeEffects,
    hackerzPayoutForRun,
    type HackerzMainframeLevels
} from '#shared/utils/gamelogic/hackerz'
import type { HackerzAccountBounds } from '#shared/utils/gamelogic/hackerz-sim'

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
 *
 * The save that reports the wave and the coins is written by the client, so
 * both are bounded by what the account's own build could have done
 * (`bounds`, from `hackerzAccountBounds`): the wave first — the run's records,
 * and with them the difficulties `bestWave` unlocks, only ever move by the
 * bounded wave — then the payout, which is the least of what was banked, the
 * game-wide ceiling for that wave, and the account's own.
 */
export function settleHackerzRun(state: HackerzSettlementState, report: HackerzRunReport, bounds: HackerzAccountBounds) {
    const difficulty = hackerzDifficulty(state.runDifficultySnapshot)
    const coinMultiplier = Number(state.runCoinMultiplierSnapshot ?? '1') || 1
    const reportedWave = Math.max(0, Math.floor(report.reportedWave))
    const wave = Math.min(reportedWave, bounds.maxWave)
    const kills = Math.max(0, Math.floor(report.reportedKills))
    const banked = Math.max(0, Math.floor(report.reportedCoins))
    const awarded = Math.min(hackerzPayoutForRun(banked, wave, difficulty, coinMultiplier), bounds.maxCoins(wave))
    // A cleared run is one that reached the last wave, whatever the client calls it.
    const victory = report.reason === 'victory' && wave >= HACKERZ_MAX_WAVE

    return {
        awarded,
        capped: awarded < banked || wave < reportedWave,
        difficulty,
        wave,
        kills,
        victory,
        runsPlayed: state.runsPlayed + 1,
        totalCoinsEarned: (Number(state.totalCoinsEarned) + awarded).toFixed(4),
        bestWave: Math.max(state.bestWave, wave),
        bestKills: Math.max(state.bestKills, kills),
        bestPayout: Math.max(state.bestPayout, awarded),
        victories: victory ? state.victories + 1 : state.victories
    }
}

/** Coin multiplier a deploying run should be stamped with. */
export function hackerzCoinMultiplier(levels: HackerzMainframeLevels) {
    return hackerzMainframeEffects(levels).coins
}
