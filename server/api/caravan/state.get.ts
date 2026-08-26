import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, readCaravan } from '#server/utils/caravan'

export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    return caravanResponse(await readCaravan(userId))
})
