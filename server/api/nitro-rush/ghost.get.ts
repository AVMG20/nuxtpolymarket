import { requireUserId } from '#server/utils/auth'
import { nrGhost } from '#server/utils/nitro-rush'
import { findTrack } from '#shared/utils/nitro-rush/tracks'

/** The viewer's own ghost on a course, so it follows them to any device. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const trackId = getQuery(event).track
    if (typeof trackId !== 'string' || !findTrack(trackId)) throw createError({ statusCode: 400, statusMessage: 'Unknown track' })
    return { ghost: await nrGhost(userId, trackId) }
})
