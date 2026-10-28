import { requireUserId } from '#server/utils/auth'
import { nrTrackSummaries } from '#server/utils/nitro-rush'

/** The track menu: each course's record and the viewer's best. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return nrTrackSummaries(userId)
})
