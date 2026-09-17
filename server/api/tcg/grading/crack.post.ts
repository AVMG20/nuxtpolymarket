import { requireUserId } from '#server/utils/auth'
import { crackSlab } from '#server/utils/tcg/grading'

/** Crack a slab: back to raw, resubmittable — with a chance of new damage. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ copyId?: unknown }>(event)
    if (typeof body?.copyId !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'copyId is required' })
    }
    return await crackSlab(userId, body.copyId)
})
