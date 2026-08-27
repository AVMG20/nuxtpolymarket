import { requireUserId } from '#server/utils/auth'
import { sellIntoBid } from '#server/utils/tcg/book'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ copyId?: string }>(event)
    if (typeof body?.copyId !== 'string' || !body.copyId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid copyId' })
    }
    return await sellIntoBid(userId, body.copyId)
})
