import { requireUserId } from '#server/utils/auth'
import { bid, settleDueAuctions } from '#server/utils/tcg/auction'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ auctionId?: string, amount?: number }>(event)
    if (typeof body?.auctionId !== 'string' || !body.auctionId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid auctionId' })
    }
    // Any auction whose clock ran out settles before the bid is judged.
    await settleDueAuctions()
    return await bid(userId, body.auctionId, Number(body?.amount))
})
