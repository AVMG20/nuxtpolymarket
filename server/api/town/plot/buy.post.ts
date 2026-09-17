import { requireUserId } from '#server/utils/auth'
import { buyPlot } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return buyPlot(userId, Number(body?.x), Number(body?.y))
})
