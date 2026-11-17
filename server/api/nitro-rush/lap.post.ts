import { requireUserId } from '#server/utils/auth'
import { finishNrLap, validLap } from '#server/utils/nitro-rush'
import { nrTrackDef } from '#server/utils/nitro-rush-tracks'

/** Every finished lap: it counts as a play, and the board keeps only each player's quickest. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ trackId?: unknown, lapMs?: unknown }>(event)
    const lap = validLap(await nrTrackDef(body?.trackId), body?.lapMs)
    if (!lap) throw createError({ statusCode: 400, statusMessage: 'Invalid lap' })
    return finishNrLap(userId, lap)
})
