import { requireUserId } from '#server/utils/auth'
import { buyPlotFromPlayer } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return buyPlotFromPlayer(userId, String(body?.plotId ?? ''))
})
