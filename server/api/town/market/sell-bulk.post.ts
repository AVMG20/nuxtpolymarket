import { requireUserId } from '#server/utils/auth'
import { sellBulkToFloor } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const items = Array.isArray(body?.items)
        ? (body.items as { resource?: unknown, quantity?: unknown }[]).map(i => ({ resource: String(i?.resource ?? ''), quantity: Number(i?.quantity) }))
        : []
    return sellBulkToFloor(userId, items)
})
