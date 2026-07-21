import { requireUserId } from '#server/utils/auth'
import { cancelGemOrder } from '#server/utils/gem-exchange'
import { broadcastGemExchangeUpdate } from '#server/utils/gem-exchange-live'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
    if (!orderId) throw createError({ statusCode: 400, statusMessage: 'Missing orderId' })

    const result = await cancelGemOrder(userId, orderId)
    broadcastGemExchangeUpdate()
    return result
})
