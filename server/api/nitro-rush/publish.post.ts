import { requireUserId } from '#server/utils/auth'
import { publishNrTrack } from '#server/utils/nitro-rush-tracks'

/** Publishes the player's course, or updates their published copy; answers with its published id. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ track?: unknown }>(event)
    return { id: await publishNrTrack(userId, body?.track) }
})
