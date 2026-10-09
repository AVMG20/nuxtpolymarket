import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { settleHq } from '#server/utils/hero-quest'
import { buyFromShop } from '#server/utils/hero-quest-arena'

/**
 * Buy from the Arena Shop with Medals (`arena.md` §6). Settles first, so Gold, priced in minutes of
 * income, is sized off the run as it stands.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ itemId?: unknown, quantity?: unknown }>(event)
    await settleHq(userId)
    return db.transaction(tx => buyFromShop(tx, userId, body?.itemId, body?.quantity ?? 1))
})
