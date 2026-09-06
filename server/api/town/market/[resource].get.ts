import { getSessionUserId } from '#server/utils/auth'
import { getTownMarket } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    const resource = getRouterParam(event, 'resource') ?? ''
    return getTownMarket(resource, userId)
})
