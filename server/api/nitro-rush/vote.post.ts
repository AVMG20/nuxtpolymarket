import { requireUserId } from '#server/utils/auth'
import { voteNrTrack } from '#server/utils/nitro-rush-tracks'

/** Sets the player's vote on a published course (1 up, -1 down, 0 none); answers with its new counts. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ trackId?: unknown, vote?: unknown }>(event)
    return voteNrTrack(userId, body?.trackId, body?.vote)
})
