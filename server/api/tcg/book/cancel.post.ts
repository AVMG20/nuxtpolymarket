import { requireUserId } from '#server/utils/auth'
import { cancelBuyOrder } from '#server/utils/tcg/book'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ orderId?: string }>(event)
    if (typeof body?.orderId !== 'string' || !body.orderId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid orderId' })
    }
    await cancelBuyOrder(userId, body.orderId)
    return { ok: true }
})
