import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debitGems } from '#server/utils/balance'
import { MAX_CHARTERS, charterGemCost } from '#shared/utils/caravan/config'

/** A permanent extra worker slot, bought with gems instead of waiting on research. */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const { ctx } = await withCaravan(userId, async ({ state }, tx) => {
        const owned = state.charters ?? 0
        if (owned >= MAX_CHARTERS) throw createError({ statusCode: 400, statusMessage: 'All charters claimed' })
        // debitGems guards the balance in its own WHERE clause, so two charters
        // bought at once cannot both pass on the same gems.
        await debitGems(userId, charterGemCost(owned), tx)
        state.charters = owned + 1
    })

    return caravanResponse(ctx)
})
