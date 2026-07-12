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
    const survived = Boolean(body?.survived)
    // Set when the client is just clearing a stale lock left by a closed tab on
    // page load, not reporting a real voyage — its wall-clock "elapsed" time is
    // dead browser-closed time, not gameplay, so it must never count toward
    // stats (bestSurvivalMs, runsPlayed) even though the lock still needs clearing.
    const abandoned = Boolean(body?.abandoned)

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (!s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active voyage' })

    // Elapsed time is derived from the server-recorded start, not the client, and
    // clamped to the run length (plus a small grace window for network latency)
    // so a stalled tab can't keep "earning" past the timer.
    const rawElapsedMs = Date.now() - s.runStartedAt.getTime()
    const elapsedMs = Math.max(0, Math.min(rawElapsedMs, PIRATE_RUN_DURATION_MS + 5000))
    const power = s.runPowerSnapshot ?? 5

    const maxPayout = abandoned ? 0 : pirateMaxPayoutForRun(elapsedMs, power)
    const awarded = Math.min(reportedCoins, maxPayout)
    const ammoUsed = abandoned ? 0 : Math.min(reportedAmmoUsed, s.ammoCount)

    await db.update(pirateState).set({
        runStartedAt: null,
        runPowerSnapshot: null,
        runsPlayed: abandoned ? s.runsPlayed : s.runsPlayed + 1,
        totalCoinsEarned: s.totalCoinsEarned + awarded,
        ammoCount: s.ammoCount - ammoUsed,
        bestSurvivalMs: abandoned ? s.bestSurvivalMs : Math.max(s.bestSurvivalMs, Math.min(elapsedMs, PIRATE_RUN_DURATION_MS))
    }).where(eq(pirateState.userId, userId))

    if (awarded > 0) await credit(userId, awarded.toFixed(4), 'pirates')

    return { awarded, capped: awarded < reportedCoins, elapsedMs, survived, ammoRemaining: s.ammoCount - ammoUsed }
})
