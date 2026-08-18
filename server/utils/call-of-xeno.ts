import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { callOfXenoState } from '#server/database/schema'
import {
    CALL_OF_XENO_MAX_SETTLED_ROUND,
    callOfXenoDifficulty,
    callOfXenoPayoutForRun,
    type CallOfXenoBestRounds,
    type CallOfXenoDifficultyId,
    type CallOfXenoUpgradeLevels
} from '#shared/utils/gamelogic/call-of-xeno-meta'
import { callOfXenoMaxRoundForElapsedMs } from '#shared/utils/gamelogic/call-of-xeno-save'

export async function getLockedCallOfXenoState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(callOfXenoState).where(eq(callOfXenoState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'CALL OF XENO state not initialized' })
    return state
}

export function callOfXenoLevels(state: {
    warChestLevel: number
    bodyArmorLevel: number
    adrenalineLevel: number
    scavengerLevel: number
    contractLevel: number
    sidearmLevel: number
}): CallOfXenoUpgradeLevels {
    return {
        warChest: state.warChestLevel,
        bodyArmor: state.bodyArmorLevel,
        adrenaline: state.adrenalineLevel,
        scavenger: state.scavengerLevel,
        contract: state.contractLevel,
        sidearm: state.sidearmLevel
    }
}

export function callOfXenoBestRounds(state: {
    bestRoundRecruit: number
    bestRoundVeteran: number
    bestRoundSurvivor: number
    bestRoundNightmare: number
}): CallOfXenoBestRounds {
    return {
        recruit: state.bestRoundRecruit,
        veteran: state.bestRoundVeteran,
        survivor: state.bestRoundSurvivor,
        nightmare: state.bestRoundNightmare
    }
}

export const CALL_OF_XENO_LEVEL_COLUMN = {
    warChest: 'warChestLevel',
    bodyArmor: 'bodyArmorLevel',
    adrenaline: 'adrenalineLevel',
    scavenger: 'scavengerLevel',
    contract: 'contractLevel',
    sidearm: 'sidearmLevel'
} as const

export interface CallOfXenoSettlementState {
    runDifficultySnapshot: CallOfXenoDifficultyId | string | null
    runPayoutMultSnapshot: string | null
    /** Last round-boundary checkpoint the server holds, if any. */
    runSave: { round: number } | null
    runsPlayed: number
    totalEarned: string
    bestEarned: number
    bestRoundRecruit: number
    bestRoundVeteran: number
    bestRoundSurvivor: number
    bestRoundNightmare: number
}

export interface CallOfXenoRunReport {
    /** Round the player died on. */
    round: number
    /** Lifetime points earned over the run, client-reported. */
    grossPoints: number
}

const BEST_ROUND_COLUMN: Record<CallOfXenoDifficultyId, 'bestRoundRecruit' | 'bestRoundVeteran' | 'bestRoundSurvivor' | 'bestRoundNightmare'> = {
    recruit: 'bestRoundRecruit',
    veteran: 'bestRoundVeteran',
    survivor: 'bestRoundSurvivor',
    nightmare: 'bestRoundNightmare'
}

/**
 * Turns a finished run into the row update + payout it should leave behind.
 * The gross is clamped by the shared wall-clock ceiling, the payout
 * multipliers come off the deploy snapshot, and the round only ever raises
 * the record for the tier the run was actually played on. The reported
 * round is a client claim too: it settles as at most the round in flight
 * at the last checkpoint, and never deeper than the spawn pacing says the
 * wall clock allows.
 */
export function settleCallOfXenoRun(state: CallOfXenoSettlementState, report: CallOfXenoRunReport, elapsedMs: number) {
    const difficulty = callOfXenoDifficulty(state.runDifficultySnapshot)
    const payoutMult = Number(state.runPayoutMultSnapshot ?? '1') || 1
    // Deeper than round 100 settles as 100 — nobody survives there by hand,
    // so the clamp is pure exploit armour.
    const round = Math.min(
        CALL_OF_XENO_MAX_SETTLED_ROUND,
        Math.max(0, Math.floor(report.round)),
        // The checkpoint holds the round that was in flight at the last
        // boundary; a death can only land on that round, never past it.
        // With no checkpoint at all, only the clock has an opinion.
        state.runSave ? state.runSave.round : CALL_OF_XENO_MAX_SETTLED_ROUND,
        callOfXenoMaxRoundForElapsedMs(elapsedMs, difficulty)
    )
    const payout = callOfXenoPayoutForRun(report.grossPoints, elapsedMs, difficulty, payoutMult)

    const bestColumn = BEST_ROUND_COLUMN[difficulty.id]
    const bestRounds = {
        bestRoundRecruit: state.bestRoundRecruit,
        bestRoundVeteran: state.bestRoundVeteran,
        bestRoundSurvivor: state.bestRoundSurvivor,
        bestRoundNightmare: state.bestRoundNightmare,
        [bestColumn]: Math.max(state[bestColumn], round)
    }

    return {
        ...payout,
        round,
        difficulty,
        runsPlayed: state.runsPlayed + 1,
        totalEarned: (Number(state.totalEarned) + payout.awarded).toFixed(4),
        bestEarned: Math.max(state.bestEarned, payout.awarded),
        bestRounds
    }
}
