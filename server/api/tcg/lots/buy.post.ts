import { requireUserId } from '#server/utils/auth'
import { buyLot } from '#server/utils/tcg/lots'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ lotId?: string }>(event)
    if (typeof body?.lotId !== 'string' || !body.lotId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid lotId' })
    }
    return await buyLot(userId, body.lotId)
})
