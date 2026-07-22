import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { getLockedShapezzState } from '#server/utils/shapezz'
import { shapezzCooldownRushCost, shapezzRunCooldownRemainingMs } from '#shared/utils/gamelogic/shapezz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    return db.transaction(async (tx) => {
        const state = await getLockedShapezzState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot rush the arena during a run' })

        const remainingMs = shapezzRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now())
        if (remainingMs <= 0) throw createError({ statusCode: 400, statusMessage: 'The arena is already ready' })

        const cost = shapezzCooldownRushCost(remainingMs)
        const gems = await debitGems(userId, cost, tx)
        await tx.update(shapezzState)
            .set({ lastRunFinishedAt: null })
            .where(eq(shapezzState.userId, userId))

        return { cost, gems }
    })
})
