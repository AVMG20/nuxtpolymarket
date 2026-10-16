import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { buyFromShop } from '#server/utils/hero-quest-arena'
import { ARENA_SHOP_BUY_BODY, readHqBody, type HqArenaShopBuyResponse } from '#server/utils/hero-quest-api'

/**
 * Buy from the Arena Shop with Medals (`arena.md` §6). Settles first, so Gold, priced in minutes of
 * income, is sized off the run as it stands.
 */
export default defineEventHandler(async (event): Promise<HqArenaShopBuyResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'arena')
    const { itemId, quantity = 1 } = await readHqBody(event, ARENA_SHOP_BUY_BODY)
    await settleHq(userId)
    return db.transaction(tx => buyFromShop(tx, userId, itemId, quantity))
})
