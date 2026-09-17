import { requireUserId } from '#server/utils/auth'
import { cancelLot } from '#server/utils/tcg/lots'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ lotId?: string }>(event)
    if (typeof body?.lotId !== 'string' || !body.lotId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid lotId' })
    }
    await cancelLot(userId, body.lotId)
    return { ok: true }
})
