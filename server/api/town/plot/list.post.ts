import { requireUserId } from '#server/utils/auth'
import { listPlot } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const price = body?.price === null || body?.price === undefined ? null : Number(body.price)
    return listPlot(userId, String(body?.plotId ?? ''), price)
})
