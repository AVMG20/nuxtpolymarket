import { requireUserId } from '#server/utils/auth'
import { nrTrackSummaries } from '#server/utils/nitro-rush'
import { nrTrackVotes, type NrTrackVotes } from '#server/utils/nitro-rush-tracks'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'

/** The track menu: each built-in course's record, the viewer's best, its plays and its votes. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const ids = TRACKS.map(t => t.id)
    const [summaries, votes] = await Promise.all([nrTrackSummaries(userId, ids), nrTrackVotes(userId, ids)])
    return {
        summaries,
        votes: Object.fromEntries(votes) as Record<string, NrTrackVotes>
    }
})
