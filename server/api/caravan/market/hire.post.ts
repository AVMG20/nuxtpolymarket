import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debit } from '#server/utils/balance'
import { generateMarket, marketWindow } from '#shared/utils/caravan/market'
import { bonusesFor } from '#shared/utils/caravan/progression'

/**
 * Take a recruit off the current slate. The recruit is regenerated server-side
 * from the same (seed, window, slot) the client rendered, so the worker hired is
 * exactly the worker shown and the price cannot be argued with.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ slot?: number }>(event)
    const slot = Math.floor(Number(body?.slot))
    if (!Number.isInteger(slot) || slot < 0) throw createError({ statusCode: 400, statusMessage: 'Bad slot' })

    const { ctx, result } = await withCaravan(userId, async ({ state }, tx) => {
        const now = Date.now()
        const window = marketWindow(now)
        const bonuses = bonusesFor(state)

        if (state.workers.length >= bonuses.maxWorkers) {
            throw createError({ statusCode: 400, statusMessage: 'Worker limit reached' })
        }

        // A stale slate means the twelve hours rolled over while the tab was open.
        if (state.market.window !== window) state.market = { window, purchased: [], refreshes: 0 }
        if (state.market.purchased.includes(slot)) {
            throw createError({ statusCode: 400, statusMessage: 'Already hired' })
        }

        const recruit = generateMarket(state, bonuses, now).find(r => r.slot === slot)
        if (!recruit) throw createError({ statusCode: 404, statusMessage: 'No such recruit' })

        await debit(userId, recruit.price.toFixed(4), 'game:caravan', tx)

        // Claim the slot before adding the worker: the claim is the guard, so two
        // concurrent hires of the same recruit cannot both succeed.
        state.market.purchased.push(slot)
        recruit.worker.at = state.capitals[0] ?? 0
        state.workers.push(recruit.worker)
        return recruit.worker
    })

    return { ...caravanResponse(ctx), worker: result }
})
