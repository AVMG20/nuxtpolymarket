import { requireUserId } from '#server/utils/auth'
import { sellBulkToFloor } from '#server/utils/town'
import { broadcastTownMarket } from '#server/utils/town-live'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const items = Array.isArray(body?.items)
        ? (body.items as { resource?: unknown, quantity?: unknown }[]).map(i => ({ resource: String(i?.resource ?? ''), quantity: Number(i?.quantity) }))
        : []
    const result = await sellBulkToFloor(userId, items)
    for (const resource of result.resources) broadcastTownMarket(resource)
    return result
})
