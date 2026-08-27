import { requireUserId } from '#server/utils/auth'
import { acceptOffer } from '#server/utils/tcg/trade'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ offerId?: string }>(event)
    if (typeof body?.offerId !== 'string' || !body.offerId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid offerId' })
    }
    await acceptOffer(userId, body.offerId)
    return { ok: true }
})
