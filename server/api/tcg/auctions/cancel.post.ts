import { requireUserId } from '#server/utils/auth'
import { cancelAuction } from '#server/utils/tcg/auction'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ auctionId?: string }>(event)
    if (typeof body?.auctionId !== 'string' || !body.auctionId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid auctionId' })
    }
    await cancelAuction(userId, body.auctionId)
    return { ok: true }
})
