import { requireUserId } from '#server/utils/auth'
import { cancelTownOrder } from '#server/utils/town'
import { broadcastTownMarket } from '#server/utils/town-live'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const result = await cancelTownOrder(userId, String(body?.orderId ?? ''))
    broadcastTownMarket(result.resource)
    return result
})
