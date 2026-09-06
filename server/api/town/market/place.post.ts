import { requireUserId } from '#server/utils/auth'
import { placeTownOrder } from '#server/utils/town'
import { broadcastTownMarket } from '#server/utils/town-live'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const side = body?.side === 'buy' ? 'buy' as const : body?.side === 'sell' ? 'sell' as const : null
    if (!side) throw createError({ statusCode: 400, statusMessage: 'Choose buy or sell' })
    const result = await placeTownOrder(userId, String(body?.resource ?? ''), side, Number(body?.price), Number(body?.quantity))
    broadcastTownMarket(result.resource)
    return result
})
