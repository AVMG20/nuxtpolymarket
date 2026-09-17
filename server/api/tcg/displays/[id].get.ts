import { requireUserId } from '#server/utils/auth'
import { getDisplay } from '#server/utils/tcg/display'

/** One display, readable by any logged-in user — profiles link straight here. */
export default defineEventHandler(async (event) => {
    await requireUserId(event)
    const displayId = getRouterParam(event, 'id')
    if (!displayId) throw createError({ statusCode: 400, statusMessage: 'id is required' })
    return await getDisplay(displayId)
})
