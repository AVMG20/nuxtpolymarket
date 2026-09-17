import { requireUserId } from '#server/utils/auth'
import { listCopy } from '#server/utils/tcg/market'

/** List a copy at a fixed price in Coins. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ copyId?: unknown, price?: unknown, note?: unknown }>(event)
    if (typeof body?.copyId !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'copyId is required' })
    }
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null
    const row = await listCopy(userId, body.copyId, Number(body.price), note)
    return { id: row.id, copyId: row.copyId, price: Number(row.price) }
})
