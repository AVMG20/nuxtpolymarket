import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { buyAttempt } from '#server/utils/hero-quest-arena'

/** Buy one extra attack today, on the doubling Gem ladder that starts over every day (`arena.md` §3). */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return db.transaction(tx => buyAttempt(tx, userId, Date.now()))
})
