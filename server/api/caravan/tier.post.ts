import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debit } from '#server/utils/balance'
import { MAX_TIER, tierRequirement } from '#shared/utils/caravan/config'
import { hasResources, spendResources } from '#shared/utils/caravan/state'

/**
 * Advancing a tier is the game's main gate: it opens the next ring of the map,
 * the next set of recipes, and the research that raises your worker and capital
 * caps. Everything else is preparation for it.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const { ctx } = await withCaravan(userId, async ({ state }, tx) => {
        if (state.tier >= MAX_TIER) throw createError({ statusCode: 400, statusMessage: 'Already at the final tier' })

        const req = tierRequirement(state.tier)
        if (!req) throw createError({ statusCode: 400, statusMessage: 'No further tiers' })
        if (state.ownedNodes.length < req.nodes) {
            throw createError({ statusCode: 400, statusMessage: `Requires ${req.nodes} nodes` })
        }
        if (!hasResources(state, req.resources)) throw createError({ statusCode: 400, statusMessage: 'Not enough materials' })

        await debit(userId, req.coins.toFixed(4), 'game:caravan', tx)
        spendResources(state, req.resources)
        state.tier += 1
    })

    return caravanResponse(ctx)
})
