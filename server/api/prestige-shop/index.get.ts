import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getPrestigePurchases } from '#server/utils/prestige-shop'
import { PRESTIGE_SHOP_ITEMS } from '#shared/utils/prestige-shop'
import { prestigeTokenAllowance } from '#shared/utils/prestige'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const [me, purchases] = await Promise.all([
        db.query.user.findFirst({
            where: eq(user.id, userId),
            columns: { prestige: true, prestigeTokens: true }
        }),
        getPrestigePurchases(userId)
    ])

    const level = me?.prestige ?? 0
    const tokens = me?.prestigeTokens ?? 0

    return {
        level,
        tokens,
        allowance: prestigeTokenAllowance(level),
        // The price of the next unit is owned-count dependent, so the server
        // sends it rather than letting the client re-derive and drift.
        items: PRESTIGE_SHOP_ITEMS.map((item) => {
            const owned = purchases[item.id] ?? 0
            const soldOut = owned >= item.maxOwned
            const nextCost = soldOut ? null : item.cost(owned)
            return {
                id: item.id,
                owned,
                soldOut,
                nextCost,
                affordable: nextCost !== null && tokens >= nextCost
            }
        })
    }
})
