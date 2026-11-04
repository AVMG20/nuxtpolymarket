import { requireUserId } from '#server/utils/auth'
import { publishNrTrack } from '#server/utils/nitro-rush-tracks'

/** Publishes the player's course with the ghost of their lap on it, or updates their published copy; answers with its published id. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ track?: unknown, ghost?: unknown, standing?: unknown }>(event)
    return { id: await publishNrTrack(userId, body?.track, { ghost: body?.ghost, standing: body?.standing }) }
})
