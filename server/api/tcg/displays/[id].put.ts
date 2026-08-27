import { requireUserId } from '#server/utils/auth'
import { saveDisplay } from '#server/utils/tcg/display'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const displayId = getRouterParam(event, 'id')
    if (!displayId) throw createError({ statusCode: 400, statusMessage: 'id is required' })
    const body = await readBody(event)
    if (!Array.isArray(body?.slots) || !body.slots.every((slot: unknown) => slot === null || typeof slot === 'string')) {
        throw createError({ statusCode: 400, statusMessage: 'slots must be an array of copy ids and nulls' })
    }
    return await saveDisplay(userId, displayId, {
        name: typeof body?.name === 'string' ? body.name : undefined,
        capacity: typeof body?.capacity === 'number' ? body.capacity : undefined,
        slots: body.slots
    })
})
