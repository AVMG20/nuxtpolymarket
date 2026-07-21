import { requireUserId } from '#server/utils/auth'
import { placeGemOrder } from '#server/utils/gem-exchange'
import { broadcastGemExchangeUpdate } from '#server/utils/gem-exchange-live'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const side = body?.side === 'buy' ? 'buy' as const : body?.side === 'sell' ? 'sell' as const : null
    if (!side) throw createError({ statusCode: 400, statusMessage: 'Choose buy or sell' })

    // placeGemOrder validates ranges and decimal precision.
    const price = Number(body?.price)
    const quantity = Number(body?.quantity)

    const result = await placeGemOrder(userId, side, price, quantity)
    broadcastGemExchangeUpdate()
    return result
})
