import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { pirateState } from '#server/database/schema'
import { PIRATE_RUN_DURATION_MS, pirateMaxPayoutForRun, pirateRepairDurationMs, pirateCompletionBonus } from '#shared/utils/gamelogic/pirates'

export async function getLockedPirateState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(pirateState).where(eq(pirateState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    return state
}

export interface PirateSettlementState {
    runStartedAt: Date
    runPowerSnapshot: number | null
    runDifficultySnapshot: number | null
    ammoCount: number
    gemAmmoCount: number
    runsPlayed: number
    totalCoinsEarned: number
    bestSurvivalMs: number
    bestRunPower: number
    bestRunLoot: number
    highestCompletedDifficulty: number
    bestCompletedLoot: number
    bestCompletedPower: number
    bestCompletedSkinId: string
    equippedSkinId: string
    hullRepairUntil: Date | null
    hullRepairTotalMs: number
}

export interface PirateRunReport {
    abandoned: boolean
    survived: boolean
    reason: string
    reportedElapsedMs: number
    reportedCoins: number
    reportedKills: number
    reportedShotsFired: number
    reportedAmmoUsed: number
    reportedGemAmmoUsed: number
    reportedHullDamageFraction: number
}

/** Pure finish-run settlement: derives the state update and payout from the locked row, the client's report, and the server clock. */
export function settlePirateRun(s: PirateSettlementState, report: PirateRunReport, now: number) {
    const { abandoned, survived, reason, reportedElapsedMs, reportedCoins, reportedAmmoUsed, reportedGemAmmoUsed, reportedHullDamageFraction } = report

    // Wall-clock elapsed, clamped to the run length (plus a small grace window
    // for network latency), bounds how much time could plausibly have been
    // spent playing regardless of what the client claims. The client-reported
    // elapsed (real, pause-immune playtime) is then clamped to that wall-clock
    // ceiling too, so a voyage that was paused for a while doesn't get treated
    // as a full 6-minute survival, but a genuinely long pause also can't be
    // used to inflate the payout cap beyond what real wall-clock time allows.
    const rawElapsedMs = now - s.runStartedAt.getTime()
    const wallClampedMs = Math.max(0, Math.min(rawElapsedMs, PIRATE_RUN_DURATION_MS + 5000))
    const elapsedMs = abandoned ? 0 : Math.max(0, Math.min(reportedElapsedMs, wallClampedMs))
    const power = s.runPowerSnapshot ?? 5
    const difficulty = s.runDifficultySnapshot ?? 0

    const ammoUsed = abandoned ? 0 : Math.min(reportedAmmoUsed, s.ammoCount)
    const gemAmmoUsed = abandoned ? 0 : Math.min(reportedGemAmmoUsed, s.gemAmmoCount)
    const maxPayout = abandoned ? 0 : pirateMaxPayoutForRun(elapsedMs, difficulty, gemAmmoUsed)
    // Coins collected during the run, clamped by the anti-cheat ceiling.
    const runCoins = Math.min(reportedCoins, maxPayout)
    const completed = !abandoned && survived && reason === 'timeout' && elapsedMs >= PIRATE_RUN_DURATION_MS - 1000
    // Completing the full voyage adds a flat bonus on top, sized server-side so
    // the anti-cheat cap never clips it.
    const completionBonus = completed ? pirateCompletionBonus(difficulty) : 0
    const awarded = runCoins + completionBonus

    const hullDamageFraction = abandoned ? 0 : (reason === 'defeat' ? 1 : reportedHullDamageFraction)
    const repairMs = pirateRepairDurationMs(hullDamageFraction)
    const hullRepairUntil = repairMs > 0 ? new Date(now + repairMs) : null
    const isBestRun = !abandoned && (
        elapsedMs > s.bestSurvivalMs
        || (elapsedMs === s.bestSurvivalMs && awarded > s.bestRunLoot)
    )
    const isBestCompletedRun = completed && (
        difficulty > s.highestCompletedDifficulty
        || (difficulty === s.highestCompletedDifficulty && awarded > s.bestCompletedLoot)
    )

    return {
        runsPlayed: abandoned ? s.runsPlayed : s.runsPlayed + 1,
        totalCoinsEarned: s.totalCoinsEarned + awarded,
        ammoCount: s.ammoCount - ammoUsed,
        gemAmmoCount: s.gemAmmoCount - gemAmmoUsed,
        bestSurvivalMs: abandoned ? s.bestSurvivalMs : Math.max(s.bestSurvivalMs, Math.min(elapsedMs, PIRATE_RUN_DURATION_MS)),
        bestRunPower: isBestRun ? power : s.bestRunPower,
        bestRunLoot: isBestRun ? awarded : s.bestRunLoot,
        highestCompletedDifficulty: completed ? Math.max(s.highestCompletedDifficulty, difficulty) : s.highestCompletedDifficulty,
        bestCompletedLoot: isBestCompletedRun ? awarded : s.bestCompletedLoot,
        bestCompletedPower: isBestCompletedRun ? power : s.bestCompletedPower,
        bestCompletedSkinId: isBestCompletedRun ? s.equippedSkinId : s.bestCompletedSkinId,
        hullRepairUntil: abandoned ? s.hullRepairUntil : hullRepairUntil,
        hullRepairTotalMs: abandoned ? s.hullRepairTotalMs : repairMs,
        awarded,
        completionBonus,
        runCoins,
        capped: runCoins < reportedCoins,
        elapsedMs,
        completed,
        ammoUsed,
        gemAmmoUsed,
        repairMs,
        difficulty,
        power
    }
}
