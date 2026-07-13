import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { PIRATE_RUN_DURATION_MS, pirateMaxPayoutForRun } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const body = await readBody(event)
    const reportedCoins = Math.max(0, Math.floor(Number(body?.coins) || 0))
    const reportedAmmoUsed = Math.max(0, Math.floor(Number(body?.ammoUsed) || 0))
    const reportedGemAmmoUsed = Math.max(0, Math.floor(Number(body?.gemAmmoUsed) || 0))
    // The client's own elapsed-time counter only advances while the voyage is
    // actively simulating (it's frozen whenever the tab is paused/navigated
    // away), unlike wall-clock time below — this is what lets a paused-and-
    // resumed voyage report its real playtime instead of however long the
    // player spent browsing the armory.
    const reportedElapsedMs = Math.max(0, Math.floor(Number(body?.elapsedMs) || 0))
    const survived = Boolean(body?.survived)
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
    // as a full 5-minute survival, but a genuinely long pause also can't be
    // used to inflate the payout cap beyond what real wall-clock time allows.
    const rawElapsedMs = Date.now() - s.runStartedAt.getTime()
    const wallClampedMs = Math.max(0, Math.min(rawElapsedMs, PIRATE_RUN_DURATION_MS + 5000))
    const elapsedMs = abandoned ? 0 : Math.max(0, Math.min(reportedElapsedMs, wallClampedMs))
    const power = s.runPowerSnapshot ?? 5

    const ammoUsed = abandoned ? 0 : Math.min(reportedAmmoUsed, s.ammoCount)
    const gemAmmoUsed = abandoned ? 0 : Math.min(reportedGemAmmoUsed, s.gemAmmoCount)
    const maxPayout = abandoned ? 0 : pirateMaxPayoutForRun(elapsedMs, power, gemAmmoUsed)
    const awarded = Math.min(reportedCoins, maxPayout)

    await db.update(pirateState).set({
        runStartedAt: null,
        runPowerSnapshot: null,
        runsPlayed: abandoned ? s.runsPlayed : s.runsPlayed + 1,
        totalCoinsEarned: s.totalCoinsEarned + awarded,
        ammoCount: s.ammoCount - ammoUsed,
        gemAmmoCount: s.gemAmmoCount - gemAmmoUsed,
        bestSurvivalMs: abandoned ? s.bestSurvivalMs : Math.max(s.bestSurvivalMs, Math.min(elapsedMs, PIRATE_RUN_DURATION_MS))
    }).where(eq(pirateState.userId, userId))

    if (awarded > 0) await credit(userId, awarded.toFixed(4), 'pirates')

    return { awarded, capped: awarded < reportedCoins, elapsedMs, survived, ammoRemaining: s.ammoCount - ammoUsed, gemAmmoRemaining: s.gemAmmoCount - gemAmmoUsed }
})
