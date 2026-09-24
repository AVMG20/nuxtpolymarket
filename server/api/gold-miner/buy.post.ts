import { requireUserId } from '#server/utils/auth'
import { goldMinerBuy } from '#server/utils/gold-miner'
import { GM_SHOP_ITEMS, type GmShopItem } from '#shared/utils/gamelogic/gold-miner'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const item = String(body?.item ?? '')
    if (!Object.hasOwn(GM_SHOP_ITEMS, item)) throw createError({ statusCode: 400, statusMessage: 'Unknown item' })
    return goldMinerBuy(userId, item as GmShopItem)
})
