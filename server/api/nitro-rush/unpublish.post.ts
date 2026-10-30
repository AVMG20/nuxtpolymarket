import { requireUserId } from '#server/utils/auth'
import { unpublishNrTrack } from '#server/utils/nitro-rush-tracks'

/** Takes the player's published copy of a course down, with its times and ghosts. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ sourceId?: unknown }>(event)
    await unpublishNrTrack(userId, body?.sourceId)
    return { ok: true }
})
