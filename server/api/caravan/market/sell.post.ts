import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { credit } from '#server/utils/balance'
import { RESOURCES, salePrice } from '#shared/utils/caravan/config'
import { bonusesFor } from '#shared/utils/caravan/progression'

/**
 * Sell goods for coins.
 *
 * This is where all the money in the game comes from. Deliveries pay nothing on
 * their own, so every hour of hauling ends with a decision: sell the raw ore at
 * a discount now, or hold it, refine it, and sell the ingots at full value later.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ sales?: Record<string, number> }>(event)
    const sales = body?.sales ?? {}

    const { ctx, result } = await withCaravan(userId, async ({ state }, tx) => {
        let earned = 0

        for (const [id, requested] of Object.entries(sales)) {
            const def = RESOURCES[id]
            if (!def) continue
            // Clamp to what is actually in the storehouse: the amount is the
            // guard, so a stale client cannot sell goods that are already gone.
            const amount = Math.floor(Math.min(Number(requested) || 0, state.resources[id] ?? 0))
            if (amount <= 0) continue
            state.resources[id] = (state.resources[id] ?? 0) - amount
            earned += amount * salePrice(id)
        }

        if (earned <= 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to sell' })
        earned *= 1 + bonusesFor(state).coinYield / 100
        await credit(userId, earned.toFixed(4), 'game:caravan', tx)
        return earned
    })

    return { ...caravanResponse(ctx), earned: result }
})
