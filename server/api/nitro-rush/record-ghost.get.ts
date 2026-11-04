import { requireUserId } from '#server/utils/auth'
import { nrRecordGhost } from '#server/utils/nitro-rush'
import { nrTrackDef } from '#server/utils/nitro-rush-tracks'

/** The course record holder's ghost, for everyone but the holder to race. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const trackId = getQuery(event).track
    if (typeof trackId !== 'string' || !(await nrTrackDef(trackId))) throw createError({ statusCode: 400, statusMessage: 'Unknown track' })
    return { record: await nrRecordGhost(trackId, userId) }
})
