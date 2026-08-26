import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { ASSAULT_SECONDS } from '#shared/utils/caravan/config'
import { partyPower } from '#shared/utils/caravan/sim'

/**
 * Send a party at a camp. The outcome is not decided here -- the party is put on
 * campaign and the simulation resolves it when the clock reaches `resolvesAt`,
 * so the fight plays out the same whether the player watches it or closes the tab.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ nodeId?: number, workerIds?: string[] }>(event)
    const nodeId = Number(body?.nodeId)
    const workerIds = Array.isArray(body?.workerIds) ? body.workerIds.map(String) : []

    if (!workerIds.length) throw createError({ statusCode: 400, statusMessage: 'Send at least one worker' })

    const { ctx } = await withCaravan(userId, ({ state, world }) => {
        const node = world.nodes.find(n => n.id === nodeId)
        if (!node || node.kind !== 'camp') throw createError({ statusCode: 404, statusMessage: 'No such camp' })
        if (state.clearedCamps.includes(nodeId)) throw createError({ statusCode: 400, statusMessage: 'Already cleared' })
        if (node.tier > state.tier) throw createError({ statusCode: 400, statusMessage: `Requires tier ${node.tier}` })

        // The camp has to border something you hold, or there is no way to march on it.
        const owned = new Set([...state.ownedNodes, ...state.clearedCamps])
        const bordered = world.edges.some(e =>
            (e.a === nodeId && owned.has(e.b)) || (e.b === nodeId && owned.has(e.a))
        )
        if (!bordered) throw createError({ statusCode: 400, statusMessage: 'No route to the camp' })

        const party = state.workers.filter(w => workerIds.includes(w.id))
        if (party.length !== workerIds.length) throw createError({ statusCode: 400, statusMessage: 'Unknown worker in party' })
        for (const worker of party) {
            if (worker.activity.type === 'assault') {
                throw createError({ statusCode: 400, statusMessage: `${worker.name} is already on campaign` })
            }
            if (worker.food <= 0) {
                throw createError({ statusCode: 400, statusMessage: `${worker.name} has no rations` })
            }
        }

        const now = Date.now()
        for (const worker of party) {
            worker.activity = { type: 'assault', at: nodeId, startedAt: now, resolvesAt: now + ASSAULT_SECONDS * 1000 }
        }

        return { power: partyPower(state, workerIds), required: node.power ?? 0 }
    })

    return caravanResponse(ctx)
})
