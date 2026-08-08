import { requireUserId } from '#server/utils/auth'
import { auctionsFor } from '#server/utils/tcg/auction'

/** Active auctions for a set — the read also settles anything due. */
export default defineEventHandler(async (event) => {
    await requireUserId(event)
    const setId = getQuery(event).setId
    if (typeof setId !== 'string' || !setId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })
    }
    return await auctionsFor(setId)
})
