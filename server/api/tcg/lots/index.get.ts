import { requireUserId } from '#server/utils/auth'
import { lotsFor } from '#server/utils/tcg/lots'

export default defineEventHandler(async (event) => {
    await requireUserId(event)
    const setId = getQuery(event).setId
    if (typeof setId !== 'string' || !setId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })
    }
    return await lotsFor(setId)
})
