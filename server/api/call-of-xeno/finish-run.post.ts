import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { callOfXenoState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedCallOfXenoState, settleCallOfXenoRun } from '#server/utils/call-of-xeno'
import { callOfXenoBeatsBestRun } from '#shared/utils/gamelogic/call-of-xeno-meta'

/**
 * Ends a run and settles its payout.
 *
 * The client reports the round it died on, the lifetime points the run
 * earned and the time it actually spent playing (the server wall clock
 * keeps running through pauses, so it is the wrong source for the
 * leaderboard duration). The round and played time are scoreboard data
 * and are taken on faith — clamped only to sane bounds — after clamps
 * once cost a real round-20 run its place. The payout is different:
 * elapsed time comes off the server-stamped `runStartedAt` and the
 * shared payout model clamps the gross to what that much playtime could
 * plausibly have earned before converting it to cash.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const reportedRound = Number(body?.round ?? 0)
    const reportedGross = Number(body?.grossPoints ?? 0)
    const reportedPlayedMs = Number(body?.playedMs ?? 0)
    if (!Number.isFinite(reportedRound) || !Number.isFinite(reportedGross) || !Number.isFinite(reportedPlayedMs)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid run report' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedCallOfXenoState(tx, userId)
        if (!state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active CALL OF XENO run' })

        const elapsedMs = Date.now() - state.runStartedAt.getTime()
        const result = settleCallOfXenoRun(state, {
            round: reportedRound,
            grossPoints: reportedGross
        }, elapsedMs)
        // Played time is what the leaderboard shows; the wall clock (which
        // includes pauses) is only the sanity cap.
        const durationSeconds = reportedPlayedMs > 0
            ? Math.min(Math.round(elapsedMs / 1000), Math.round(reportedPlayedMs / 1000))
            : Math.max(1, Math.round(elapsedMs / 1000))

        // Clearing the active-run lock *is* the claim: a second request in
        // flight finds it already null, throws, and pays nothing.
        const beatsBest = callOfXenoBeatsBestRun(result.round, result.difficulty.id, state.bestRunRounds, state.bestRunDifficulty)
        const [claimed] = await tx.update(callOfXenoState).set({
            runStartedAt: null,
            runDifficultySnapshot: null,
            runPayoutMultSnapshot: null,
            runSave: null,
            runSaveRevision: 0,
            lastRunFinishedAt: new Date(),
            runsPlayed: result.runsPlayed,
            totalEarned: result.totalEarned,
            bestEarned: result.bestEarned,
            ...(beatsBest
? {
                bestRunRounds: result.round,
                bestRunDifficulty: result.difficulty.id,
                bestRunDurationSeconds: Math.max(1, durationSeconds)
            }
: {}),
            ...result.bestRounds
        }).where(and(eq(callOfXenoState.userId, userId), isNotNull(callOfXenoState.runStartedAt)))
            .returning({ userId: callOfXenoState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'No active CALL OF XENO run' })

        if (result.awarded > 0) await credit(userId, result.awarded.toFixed(4), 'call-of-xeno', tx)

        return {
            awarded: result.awarded,
            counted: result.counted,
            capped: result.capped,
            round: result.round,
            difficulty: result.difficulty.id,
            bestRounds: result.bestRounds,
            bestEarned: result.bestEarned
        }
    })
})
