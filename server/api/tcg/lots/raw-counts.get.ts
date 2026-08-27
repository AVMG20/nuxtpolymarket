import { requireUserId } from '#server/utils/auth'
import { rawCountsFor } from '#server/utils/tcg/lots'

/** The caller's lot-eligible raw copy counts per printing (lot builder). */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const setId = getQuery(event).setId
    if (typeof setId !== 'string' || !setId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })
    }
    return await rawCountsFor(userId, setId)
})
