import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debitGems } from '#server/utils/balance'
import { shardsPerGem } from '#shared/utils/caravan/config'

/**
 * Trade gems for salvage shards at the current tier's rate.
 *
 * Shards otherwise only come from salvaging items, which means a run of bad
 * commissions can leave you unable to fix the one good item you have. This is
 * the release valve, priced so it stays a real decision rather than a shortcut.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ gems?: number }>(event)
    const gems = Math.max(1, Math.min(500, Math.floor(Number(body?.gems ?? 0))))
    if (!Number.isFinite(gems)) throw createError({ statusCode: 400, statusMessage: 'Bad amount' })

    const { ctx, result } = await withCaravan(userId, async ({ state }, tx) => {
        // debitGems guards the balance in its own WHERE clause, so two purchases
        // fired at once cannot both spend the same gems.
        await debitGems(userId, gems, tx)
        const shards = gems * shardsPerGem(state.tier)
        state.shards += shards
        return shards
    })

    return { ...caravanResponse(ctx), shards: result }
})
