import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { getLockedShapezzState } from '#server/utils/shapezz'
import { shapezzHeadStartCost } from '#shared/utils/gamelogic/shapezz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    return db.transaction(async (tx) => {
        const state = await getLockedShapezzState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot buy a head start during a run' })

        const level = state.headStartLevel
        const cost = shapezzHeadStartCost(level)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: 'Head start is already active' })

        await debitGems(userId, cost, tx)
        await tx.update(shapezzState).set({ headStartLevel: level + 1 }).where(eq(shapezzState.userId, userId))

        return { level: level + 1, cost }
    })
})
