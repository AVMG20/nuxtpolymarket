import { requireUserId } from '#server/utils/auth'
import { deleteDisplay } from '#server/utils/tcg/display'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const displayId = getRouterParam(event, 'id')
    if (!displayId) throw createError({ statusCode: 400, statusMessage: 'id is required' })
    await deleteDisplay(userId, displayId)
    return { ok: true }
})
