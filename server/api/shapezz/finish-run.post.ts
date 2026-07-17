import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedShapezzState, settleShapezzRun } from '#server/utils/shapezz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const rawReason = String(body?.reason ?? '')
    const reason = ['cashout', 'defeat', 'abandoned'].includes(rawReason)
        ? rawReason as 'cashout' | 'defeat' | 'abandoned'
        : 'defeat'
    const reportedElapsedMs = Math.max(0, Math.floor(Number(body?.elapsedMs) || 0))
    const reportedCoins = Math.min(1_000_000_000, Math.max(0, Math.floor(Number(body?.coins) || 0)))
    const reportedKills = Math.min(1_000_000, Math.max(0, Math.floor(Number(body?.kills) || 0)))

    return db.transaction(async (tx) => {
        const state = await getLockedShapezzState(tx, userId)
        if (!state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active SHAPEZZ run' })

        const result = settleShapezzRun({ ...state, runStartedAt: state.runStartedAt }, {
            reason,
            reportedElapsedMs,
            reportedCoins,
            reportedKills
        }, Date.now())

        const [claimed] = await tx.update(shapezzState).set({
            runStartedAt: null,
            runDifficultySnapshot: null,
            runPowerSnapshot: null,
            runsPlayed: result.runsPlayed,
            totalCoinsEarned: result.totalCoinsEarned,
            bestSurvivalMs: result.bestSurvivalMs,
            bestKills: result.bestKills,
            bestCheckpoint: result.bestCheckpoint
        }).where(and(eq(shapezzState.userId, userId), isNotNull(shapezzState.runStartedAt)))
            .returning({ userId: shapezzState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'No active SHAPEZZ run' })

        if (result.awarded > 0) await credit(userId, result.awarded.toFixed(4), 'shapezz', tx)

        return result
    })
})
