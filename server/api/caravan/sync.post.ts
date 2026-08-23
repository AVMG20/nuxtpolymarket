import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, readCaravan } from '#server/utils/caravan'

/**
 * The client calls this the moment it predicts a worker has finished something.
 * There is no polling: the next call is scheduled for the exact timestamp the
 * simulation says the next activity ends.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    return caravanResponse(await readCaravan(userId))
})
