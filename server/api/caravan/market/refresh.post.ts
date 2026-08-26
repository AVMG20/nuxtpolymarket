import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debitGems } from '#server/utils/balance'
import { MARKET_REFRESH_GEMS } from '#shared/utils/caravan/config'
import { marketWindow } from '#shared/utils/caravan/market'

/**
 * Post a new slate immediately instead of waiting out the twelve hours. One of
 * the few things gems buy, and it buys a reroll rather than an outcome -- the
 * new slate can be worse than the one you tore up.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const { ctx } = await withCaravan(userId, async ({ state }, tx) => {
        const window = marketWindow(Date.now())
        // debitGems guards the balance in its own WHERE clause, so two refreshes
        // fired at once cannot both spend the same gems.
        await debitGems(userId, MARKET_REFRESH_GEMS, tx)

        if (state.market.window !== window) {
            state.market = { window, purchased: [], refreshes: 0 }
        }
        state.market.refreshes = (state.market.refreshes ?? 0) + 1
        state.market.purchased = []
    })

    return caravanResponse(ctx)
})
