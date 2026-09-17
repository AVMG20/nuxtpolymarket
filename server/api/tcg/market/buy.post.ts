import { requireUserId } from '#server/utils/auth'
import { buyListing } from '#server/utils/tcg/market'

/** Atomic purchase: coins move, 5% burns, the copy changes hands. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ listingId?: unknown }>(event)
    if (typeof body?.listingId !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'listingId is required' })
    }
    return await buyListing(userId, body.listingId)
})
