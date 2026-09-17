import { requireUserId } from '#server/utils/auth'
import { cancelListing } from '#server/utils/tcg/market'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ listingId?: unknown }>(event)
    if (typeof body?.listingId !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'listingId is required' })
    }
    await cancelListing(userId, body.listingId)
    return { ok: true }
})
