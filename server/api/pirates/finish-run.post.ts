import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateRunHistory, pirateState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { PIRATE_RUN_DURATION_MS, pirateMaxPayoutForRun, pirateRepairDurationMs } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const body = await readBody(event)
    const reportedCoins = Math.max(0, Math.floor(Number(body?.coins) || 0))
    const reportedAmmoUsed = Math.max(0, Math.floor(Number(body?.ammoUsed) || 0))
    const reportedGemAmmoUsed = Math.max(0, Math.floor(Number(body?.gemAmmoUsed) || 0))
    const reportedKills = Math.min(10_000, Math.max(0, Math.floor(Number(body?.kills) || 0)))
    const reportedShotsFired = Math.min(100_000, Math.max(0, Math.floor(Number(body?.shotsFired) || 0)))
    // The client's own elapsed-time counter only advances while the voyage is
    // actively simulating (it's frozen whenever the tab is paused/navigated
    // away), unlike wall-clock time below — this is what lets a paused-and-
    // resumed voyage report its real playtime instead of however long the
    // player spent browsing the armory.
    const reportedElapsedMs = Math.max(0, Math.floor(Number(body?.elapsedMs) || 0))
    const survived = Boolean(body?.survived)
    const reportedReason = String(body?.reason ?? '')
    const reason = ['timeout', 'defeat', 'cancelled'].includes(reportedReason) ? reportedReason : 'defeat'
    // The client reports how banged-up the hull ended up (0 = pristine, 1 =
    // sunk) so we know how long the repair should take. A 'defeat' finish
    // means hp hit zero by definition, so that one is forced to full damage
    // server-side regardless of what's reported — no reason to trust the
    // client on the one case that's unambiguous.
    const reportedHullDamageFraction = Math.min(1, Math.max(0, Number(body?.hullDamageFraction) || 0))
    // Set when the client is just clearing a stale lock left by a closed tab on
    // page load, not reporting a real voyage — its wall-clock "elapsed" time is
    // dead browser-closed time, not gameplay, so it must never count toward
    // stats (bestSurvivalMs, runsPlayed) even though the lock still needs clearing.
    const abandoned = Boolean(body?.abandoned)

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (!s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active voyage' })

    // Wall-clock elapsed, clamped to the run length (plus a small grace window
    // for network latency), bounds how much time could plausibly have been
    // spent playing regardless of what the client claims. The client-reported
    // elapsed (real, pause-immune playtime) is then clamped to that wall-clock
    // ceiling too, so a voyage that was paused for a while doesn't get treated
    // as a full 8-minute survival, but a genuinely long pause also can't be
    // used to inflate the payout cap beyond what real wall-clock time allows.
    const rawElapsedMs = Date.now() - s.runStartedAt.getTime()
    const wallClampedMs = Math.max(0, Math.min(rawElapsedMs, PIRATE_RUN_DURATION_MS + 5000))
    const elapsedMs = abandoned ? 0 : Math.max(0, Math.min(reportedElapsedMs, wallClampedMs))
    const power = s.runPowerSnapshot ?? 5
    const difficulty = s.runDifficultySnapshot ?? 0

    const ammoUsed = abandoned ? 0 : Math.min(reportedAmmoUsed, s.ammoCount)
    const gemAmmoUsed = abandoned ? 0 : Math.min(reportedGemAmmoUsed, s.gemAmmoCount)
    const maxPayout = abandoned ? 0 : pirateMaxPayoutForRun(elapsedMs, difficulty, gemAmmoUsed)
    const awarded = Math.min(reportedCoins, maxPayout)

    const hullDamageFraction = abandoned ? 0 : (reason === 'defeat' ? 1 : reportedHullDamageFraction)
    const repairMs = pirateRepairDurationMs(hullDamageFraction)
    const hullRepairUntil = repairMs > 0 ? new Date(Date.now() + repairMs) : null
    const isBestRun = !abandoned && (
        elapsedMs > s.bestSurvivalMs
        || (elapsedMs === s.bestSurvivalMs && awarded > s.bestRunLoot)
    )
    const completed = !abandoned && survived && reason === 'timeout' && elapsedMs >= PIRATE_RUN_DURATION_MS - 1000
    const isBestCompletedRun = completed && (
        difficulty > s.highestCompletedDifficulty
        || (difficulty === s.highestCompletedDifficulty && awarded > s.bestCompletedLoot)
    )

    await db.update(pirateState).set({
        runStartedAt: null,
        runPowerSnapshot: null,
        runDifficultySnapshot: null,
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
        hullRepairTotalMs: abandoned ? s.hullRepairTotalMs : repairMs
    }).where(eq(pirateState.userId, userId))

    if (!abandoned) {
        await db.insert(pirateRunHistory).values({
            userId,
            loot: awarded,
            durationMs: elapsedMs,
            power,
            difficulty,
            survived,
            reason,
            kills: reportedKills,
            shotsFired: reportedShotsFired,
            skinId: s.equippedSkinId
        })
    }

    if (awarded > 0) await credit(userId, awarded.toFixed(4), 'pirates')

    return {
        awarded,
        capped: awarded < reportedCoins,
        elapsedMs,
        survived,
        completed,
        difficulty,
        ammoRemaining: s.ammoCount - ammoUsed,
        gemAmmoRemaining: s.gemAmmoCount - gemAmmoUsed,
        repairUntil: abandoned ? s.hullRepairUntil : hullRepairUntil,
        repairTotalMs: abandoned ? s.hullRepairTotalMs : repairMs
    }
})
