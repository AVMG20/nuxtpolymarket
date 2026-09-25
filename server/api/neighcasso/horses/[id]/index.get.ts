import { requireUserId } from '#server/utils/auth'
import { getSharedHorse } from '#server/utils/neighcasso'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const horse = await getSharedHorse(userId, getRouterParam(event, 'id') ?? '')
    if (!horse) throw createError({ statusCode: 404, statusMessage: 'This horse ran away' })
    return horse
})
