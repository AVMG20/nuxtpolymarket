import { requireUserId } from '#server/utils/auth'
import { voidSell } from '#server/utils/void'
import { VOID_RESOURCE_IDS, type VoidResourceId } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const resource = String(body?.resource) as VoidResourceId
    if (!VOID_RESOURCE_IDS.includes(resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })
    const requested = body?.amount === 'all' ? Number.POSITIVE_INFINITY : Math.floor(Number(body?.amount) || 0)
    if (requested <= 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to sell' })
    return voidSell(userId, resource, requested)
})
