import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debit } from '#server/utils/balance'
import { nodeCost } from '#shared/utils/caravan/config'
import { bonusesFor } from '#shared/utils/caravan/progression'
import { isReachable } from '#shared/utils/caravan/world'

export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ nodeId?: number }>(event)
    const nodeId = Number(body?.nodeId)
    if (!Number.isInteger(nodeId)) throw createError({ statusCode: 400, statusMessage: 'Bad node' })

    const { ctx } = await withCaravan(userId, async ({ state, world }, tx) => {
        const node = world.nodes.find(n => n.id === nodeId)
        if (!node) throw createError({ statusCode: 404, statusMessage: 'No such node' })
        if (state.ownedNodes.includes(nodeId)) throw createError({ statusCode: 400, statusMessage: 'Already owned' })
        if (node.kind === 'camp') throw createError({ statusCode: 400, statusMessage: 'Camps must be cleared, not bought' })
        if (node.tier > state.tier) throw createError({ statusCode: 400, statusMessage: `Requires tier ${node.tier}` })

        const owned = new Set(state.ownedNodes)
        for (const id of state.clearedCamps) owned.add(id)
        if (!isReachable(world, nodeId, owned)) {
            throw createError({ statusCode: 400, statusMessage: 'Not connected to your network' })
        }

        const bonuses = bonusesFor(state)
        if (node.kind === 'capital' && state.capitals.length >= bonuses.maxCapitals) {
            throw createError({ statusCode: 400, statusMessage: 'Capital limit reached' })
        }

        // debit is the guard -- it throws on insufficient funds, so there is no
        // read-then-write window for two purchases to slip through.
        await debit(userId, nodeCost(state.ownedNodes.length - 1).toFixed(4), 'game:caravan', tx)

        state.ownedNodes.push(nodeId)
        if (node.kind === 'capital') state.capitals.push(nodeId)
    })

    return caravanResponse(ctx)
})
