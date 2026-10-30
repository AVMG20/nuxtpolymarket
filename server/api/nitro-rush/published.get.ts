import { requireUserId } from '#server/utils/auth'
import { nrPublishedTracks } from '#server/utils/nitro-rush-tracks'

/** Players' published courses: the viewer's own and the newest from everyone else. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return nrPublishedTracks(userId)
})
