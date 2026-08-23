import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { MAX_PRIORITY } from '#shared/utils/caravan/config'

/**
 * Set a node's work priority. This is the only lever the player has over where
 * workers go -- there is no per-worker assignment -- so it takes effect at each
 * worker's next delivery rather than yanking anyone mid-trip.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ nodeId?: number, priority?: number }>(event)
    const nodeId = Number(body?.nodeId)
    const priority = Math.max(0, Math.min(MAX_PRIORITY, Math.floor(Number(body?.priority))))
    if (!Number.isInteger(nodeId) || !Number.isFinite(priority)) {
        throw createError({ statusCode: 400, statusMessage: 'Bad priority' })
    }

    const { ctx } = await withCaravan(userId, ({ state, world }) => {
        const node = world.nodes.find(n => n.id === nodeId)
        if (!node || node.kind !== 'resource') {
            throw createError({ statusCode: 400, statusMessage: 'Only resource nodes carry a priority' })
        }
        if (!state.ownedNodes.includes(nodeId)) {
            throw createError({ statusCode: 400, statusMessage: 'You do not own that node' })
        }
        state.nodePriority[nodeId] = priority
    })

    return caravanResponse(ctx)
})
