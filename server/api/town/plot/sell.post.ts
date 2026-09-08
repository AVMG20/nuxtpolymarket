import { requireUserId } from '#server/utils/auth'
import { sellPlotToSystem } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return sellPlotToSystem(userId, String(body?.plotId ?? ''))
})
