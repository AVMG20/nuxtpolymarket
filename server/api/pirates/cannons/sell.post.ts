import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, pirateCannons } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { PIRATE_CANNON_SELL_REFUND_RATE } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const body = await readBody(event)
    const slotIndex = Number(body?.slotIndex)

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot refit mid-voyage' })

    const cannon = await db.query.pirateCannons.findFirst({
        where: and(eq(pirateCannons.userId, userId), eq(pirateCannons.slotIndex, slotIndex))
    })
    if (!cannon) throw createError({ statusCode: 404, statusMessage: 'No cannon in that slot' })

    const refund = Math.round(cannon.purchasePrice * PIRATE_CANNON_SELL_REFUND_RATE)

    await db.delete(pirateCannons).where(eq(pirateCannons.id, cannon.id))
    if (refund > 0) await credit(userId, refund.toFixed(4), 'pirates:cannon-sale')

    return { slotIndex, refund }
})
