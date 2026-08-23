import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debit } from '#server/utils/balance'
import {
    MAX_ROAD_LEVEL, ROAD_NAMES, roadCost, roadResourceCost, roadUpgradeTier
} from '#shared/utils/caravan/config'
import { hasResources, spendResources } from '#shared/utils/caravan/state'

export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ edgeId?: string }>(event)
    const edgeId = String(body?.edgeId ?? '')

    const { ctx } = await withCaravan(userId, async ({ state, world }, tx) => {
        const edge = world.edges.find(e => e.id === edgeId)
        if (!edge) throw createError({ statusCode: 404, statusMessage: 'No such road' })

        const owned = new Set(state.ownedNodes)
        for (const id of state.clearedCamps) owned.add(id)
        if (!owned.has(edge.a) || !owned.has(edge.b)) {
            throw createError({ statusCode: 400, statusMessage: 'You must hold both ends of the road' })
        }

        const level = state.roads[edgeId] ?? 0
        if (level >= MAX_ROAD_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Road is fully paved' })

        const required = roadUpgradeTier(level)
        if (state.tier < required) {
            throw createError({ statusCode: 400, statusMessage: `A ${ROAD_NAMES[level + 1]} needs tier ${required}` })
        }

        const cost = roadResourceCost(level)
        if (!hasResources(state, cost)) throw createError({ statusCode: 400, statusMessage: 'Not enough materials' })

        await debit(userId, roadCost(level).toFixed(4), 'game:caravan', tx)
        spendResources(state, cost)
        state.roads[edgeId] = level + 1
    })

    return caravanResponse(ctx)
})
