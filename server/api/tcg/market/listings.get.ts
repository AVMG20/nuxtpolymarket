import { requireUserId } from '#server/utils/auth'
import { listingsFor } from '#server/utils/tcg/market'
import type { TcgListingSummary } from '#shared/types/tcg'

/** Active listings for one set, sellers named — no anonymity (§7.1). */
export default defineEventHandler(async (event): Promise<TcgListingSummary[]> => {
    await requireUserId(event)
    const setId = getQuery(event).setId
    if (typeof setId !== 'string' || !setId) {
        throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    }
    return await listingsFor(setId)
})
