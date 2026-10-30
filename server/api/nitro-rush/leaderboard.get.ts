import { requireUserId } from '#server/utils/auth'
import { nrLeaderboard } from '#server/utils/nitro-rush'
import { nrTrackDef } from '#server/utils/nitro-rush-tracks'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const trackId = getQuery(event).track
    if (typeof trackId !== 'string' || !(await nrTrackDef(trackId))) throw createError({ statusCode: 400, statusMessage: 'Unknown track' })
    return nrLeaderboard(trackId, userId)
})
