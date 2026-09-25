import { requireUserId } from '#server/utils/auth'
import { createHorse, getSharedHorse } from '#server/utils/neighcasso'
import { NC_NAME_MAX } from '#shared/utils/neighcasso/types'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const horse = await getSharedHorse(userId, getRouterParam(event, 'id') ?? '')
    if (!horse) throw createError({ statusCode: 404, statusMessage: 'This horse ran away' })
    const name = horse.mine ? `${horse.name} II` : horse.name
    return createHorse(userId, name.slice(0, NC_NAME_MAX), horse.drawing)
})
