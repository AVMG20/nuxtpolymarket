import { requireUserId } from '#server/utils/auth'
import { buyPrestigeShopItem } from '#server/utils/prestige-shop'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const { itemId } = await readBody(event) as { itemId?: unknown }

    if (typeof itemId !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'Missing item' })
    }

    return buyPrestigeShopItem(userId, itemId)
})
