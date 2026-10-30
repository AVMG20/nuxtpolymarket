import { requireUserId } from '#server/utils/auth'
import { nrLeaderboard, submitNrLap, validLap } from '#server/utils/nitro-rush'
import { nrTrackDef } from '#server/utils/nitro-rush-tracks'

/** A finished lap; the board keeps only each player's quickest. Answers with the board as it now stands. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ trackId?: unknown, lapMs?: unknown }>(event)
    const lap = validLap(await nrTrackDef(body?.trackId), body?.lapMs)
    if (!lap) throw createError({ statusCode: 400, statusMessage: 'Invalid lap' })
    const { improved } = await submitNrLap(userId, lap.trackId, lap.lapMs)
    return { improved, board: await nrLeaderboard(lap.trackId, userId) }
})
