import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { getLockedPathwardenState } from '#server/utils/pathwarden'
import { PATHWARDEN_SURGE_COST_GEMS } from '#shared/utils/gamelogic/pathwarden'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const debugMode = import.meta.dev || Boolean(useRuntimeConfig(event).devMode)
    const body = await readBody<{ count?: number }>(event)
    const count = Math.floor(Number(body.count ?? 1))
    if (!Number.isInteger(count) || count < 1 || count > 100) {
        throw createError({ statusCode: 400, statusMessage: 'Choose between 1 and 100 charges' })
    }
    const cost = count * PATHWARDEN_SURGE_COST_GEMS
    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        const gems = debugMode ? null : await debitGems(userId, cost, tx)
        const [updated] = await tx.update(pathwardenState)
            .set({ surgeCharges: sql`${pathwardenState.surgeCharges} + ${count}` })
            .where(eq(pathwardenState.userId, userId))
            .returning({ surgeCharges: pathwardenState.surgeCharges })
        return { cost: debugMode ? 0 : cost, gems, surgeCharges: updated?.surgeCharges ?? state.surgeCharges + count }
    })
})
