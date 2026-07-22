import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { getLockedPirateState } from '#server/utils/pirates'
import { pirateRepairRushGemCost } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    return db.transaction(async (tx) => {
        const state = await getLockedPirateState(tx, userId)
        const remainingMs = state.hullRepairUntil ? state.hullRepairUntil.getTime() - Date.now() : 0
        if (remainingMs <= 0) throw createError({ statusCode: 400, statusMessage: 'Your ship isn\'t under repair' })

        const gemCost = pirateRepairRushGemCost(remainingMs)
        const gems = await debitGems(userId, gemCost, tx)
        await tx.update(pirateState)
            .set({ hullRepairUntil: null, hullRepairTotalMs: 0 })
            .where(eq(pirateState.userId, userId))

        return { gemCost, gems }
    })
})
