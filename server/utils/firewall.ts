import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { firewallState } from '#server/database/schema'
import {
    firewallDifficulty,
    firewallMainframeEffects,
    firewallPayoutForRun,
    type FirewallMainframeLevels
} from '#shared/utils/gamelogic/firewall'

export async function getLockedFirewallState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(firewallState).where(eq(firewallState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'FIREWALL state not initialized' })
    return state
}

export interface FirewallLevelState {
    bulwarkLevel: number
    munitionsLevel: number
    foundryLevel: number
    grantLevel: number
    salvageLevel: number
    capacitorLevel: number
    charterLevel: number
    arsenalLevel: number
}

export function firewallLevels(state: FirewallLevelState): FirewallMainframeLevels {
    return {
        bulwark: state.bulwarkLevel,
        munitions: state.munitionsLevel,
        foundry: state.foundryLevel,
        grant: state.grantLevel,
        salvage: state.salvageLevel,
        capacitor: state.capacitorLevel,
        charter: state.charterLevel,
        arsenal: state.arsenalLevel
    }
}

export const FIREWALL_LEVEL_COLUMN = {
    bulwark: 'bulwarkLevel',
    munitions: 'munitionsLevel',
    foundry: 'foundryLevel',
    grant: 'grantLevel',
    salvage: 'salvageLevel',
    capacitor: 'capacitorLevel',
    charter: 'charterLevel',
    arsenal: 'arsenalLevel'
} as const

export interface FirewallSettlementState {
    runDifficultySnapshot: string | null
    runCoinMultiplierSnapshot: string | null
    runsPlayed: number
    totalCoinsEarned: string
    bestWave: number
    bestKills: number
    bestPayout: number
    victories: number
}

export interface FirewallRunReport {
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
export function settleFirewallRun(state: FirewallSettlementState, report: FirewallRunReport) {
    const difficulty = firewallDifficulty(state.runDifficultySnapshot)
    const coinMultiplier = Number(state.runCoinMultiplierSnapshot ?? '1') || 1
    const wave = Math.max(0, Math.floor(report.reportedWave))
    const kills = Math.max(0, Math.floor(report.reportedKills))
    const banked = Math.max(0, Math.floor(report.reportedCoins))
    const awarded = firewallPayoutForRun(banked, wave, difficulty, coinMultiplier)

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
export function firewallCoinMultiplier(levels: FirewallMainframeLevels) {
    return firewallMainframeEffects(levels).coins
}
