import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debitGems } from '#server/utils/balance'
import { MAX_DEEDS, deedGemCost } from '#shared/utils/caravan/config'

/** A permanent extra capital slot. Capitals are the only haul destinations, so
 *  a second one halves the walk for a whole arm of the map. */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const { ctx } = await withCaravan(userId, async ({ state }, tx) => {
        const owned = state.deeds ?? 0
        if (owned >= MAX_DEEDS) throw createError({ statusCode: 400, statusMessage: 'All deeds claimed' })
        await debitGems(userId, deedGemCost(owned), tx)
        state.deeds = owned + 1
    })

    return caravanResponse(ctx)
})
