import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { buyAttempt } from '#server/utils/hero-quest-arena'
import type { HqArenaAttemptResponse } from '#server/utils/hero-quest-api'

/** Buy one extra attack today, on the doubling Gem ladder that starts over every day (`arena.md` §3). */
export default defineEventHandler(async (event): Promise<HqArenaAttemptResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'arena')
    return db.transaction(tx => buyAttempt(tx, userId, Date.now()))
})
