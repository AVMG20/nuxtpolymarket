import { auth } from '#server/utils/auth'
import { rtSetWorldLook, type RtWorldLook } from '#server/utils/rail-tycoon/registry'
import { RT_PROTOCOL_BOUNDS } from '#shared/utils/rail-tycoon/protocol'
import { serializeEmblem } from '#shared/utils/emblem'

/** The owner's lobby setting and world drawing: `isPublic` (boolean) and `avatar` (an emblem, or null to clear). */
export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const worldId = getRouterParam(event, 'id')
    if (!worldId || worldId.length > RT_PROTOCOL_BOUNDS.worldIdBytes) throw createError({ statusCode: 404, statusMessage: 'World not found' })

    const body = await readBody<{ isPublic?: unknown, avatar?: unknown }>(event)
    if (typeof body !== 'object' || body === null) throw createError({ statusCode: 400, statusMessage: 'Nothing to change' })
    const look: RtWorldLook = {}
    if (body.isPublic !== undefined) {
        if (typeof body.isPublic !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Public must be on or off' })
        look.isPublic = body.isPublic
    }
    if (body.avatar !== undefined) {
        const avatar = body.avatar === null ? null : serializeEmblem(body.avatar)
        if (avatar === null && body.avatar !== null) throw createError({ statusCode: 400, statusMessage: 'Invalid avatar' })
        look.avatar = avatar
    }

    return rtSetWorldLook(session.user.id, worldId, look)
})
