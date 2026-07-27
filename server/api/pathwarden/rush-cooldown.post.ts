import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { getLockedPathwardenState } from '#server/utils/pathwarden'
import {
    pathwardenCooldownRushCost,
    pathwardenRunCooldownRemainingMs
} from '#shared/utils/gamelogic/pathwarden'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const debugMode = import.meta.dev || Boolean(useRuntimeConfig(event).devMode)

    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot rush recovery during a march' })

        const remainingMs = pathwardenRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now())
        if (remainingMs <= 0) throw createError({ statusCode: 400, statusMessage: 'The wardens are already ready' })

        const cost = pathwardenCooldownRushCost(remainingMs)
        const gems = debugMode ? null : await debitGems(userId, cost, tx)
        await tx.update(pathwardenState)
            .set({ lastRunFinishedAt: null })
            .where(eq(pathwardenState.userId, userId))

        return { cost: debugMode ? 0 : cost, gems }
    })
})
