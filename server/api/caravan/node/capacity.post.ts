import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debit } from '#server/utils/balance'
import {
    BASE_NODE_CAPACITY,
    MAX_NODE_CAPACITY,
    capacityCoinCost,
    capacityResourceCost,
    capacityUpgradeTier
} from '#shared/utils/caravan/config'
import { hasResources, spendResources } from '#shared/utils/caravan/state'

/**
 * Widen a seam so more workers can cut it at once. The material cost climbs a
 * tier with every widening, which keeps a tier-1 node worth revisiting with
 * tier-5 goods in hand.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ nodeId?: number }>(event)
    const nodeId = Number(body?.nodeId)

    const { ctx } = await withCaravan(userId, async ({ state, world }, tx) => {
        const node = world.nodes.find(n => n.id === nodeId)
        if (!node || node.kind !== 'resource') throw createError({ statusCode: 400, statusMessage: 'Not a seam' })
        if (!state.ownedNodes.includes(nodeId)) {
            throw createError({ statusCode: 400, statusMessage: 'You do not own that node' })
        }

        const current = state.nodeCapacity[nodeId] ?? BASE_NODE_CAPACITY
        if (current >= MAX_NODE_CAPACITY) throw createError({ statusCode: 400, statusMessage: 'Already fully widened' })

        const required = capacityUpgradeTier(current)
        if (state.tier < required) throw createError({ statusCode: 400, statusMessage: `Requires tier ${required}` })

        const cost = capacityResourceCost(current)
        if (!hasResources(state, cost)) throw createError({ statusCode: 400, statusMessage: 'Not enough materials' })

        await debit(userId, capacityCoinCost(current, node.tier).toFixed(4), 'game:caravan', tx)
        spendResources(state, cost)
        state.nodeCapacity[nodeId] = current + 1
    })

    return caravanResponse(ctx)
})
