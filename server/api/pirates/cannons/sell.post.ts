import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, pirateCannons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { PIRATE_CANNON_SELL_REFUND_RATE } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const slotIndex = Number(body?.slotIndex)

    return db.transaction(async (tx) => {
        const s = await tx.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
        if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot refit mid-voyage' })

        // The delete is the mutex; (userId, slotIndex) is unique, so it also prices the refund.
        const [cannon] = await tx.delete(pirateCannons)
            .where(and(eq(pirateCannons.userId, userId), eq(pirateCannons.slotIndex, slotIndex)))
            .returning({ purchasePrice: pirateCannons.purchasePrice })
        if (!cannon) throw createError({ statusCode: 404, statusMessage: 'No cannon in that slot' })

        const refund = Math.round(cannon.purchasePrice * PIRATE_CANNON_SELL_REFUND_RATE)

        if (refund > 0) await credit(userId, refund.toFixed(4), 'pirates', tx)

        return { slotIndex, refund }
    })
})
