import { requireUserId } from '#server/utils/auth'
import { sellToFloor } from '#server/utils/town'
import { broadcastTownMarket } from '#server/utils/town-live'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const result = await sellToFloor(userId, String(body?.resource ?? ''), Number(body?.quantity))
    if (result.filledByPlayers > 0) broadcastTownMarket(result.resource)
    return result
})
