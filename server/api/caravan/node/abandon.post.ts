import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { abandonNode } from '#shared/utils/caravan/assignment'

/**
 * Give a node back.
 *
 * There is no refund -- coins spent on a claim are gone, and that is the point:
 * abandoning is how you free a capped capital slot or drop a seam you regret,
 * not a way to move money around.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ nodeId?: number }>(event)
    const nodeId = Number(body?.nodeId)
    if (!Number.isInteger(nodeId)) throw createError({ statusCode: 400, statusMessage: 'Bad node' })

    const { ctx, result } = await withCaravan(userId, ({ state }) => {
        if (!state.ownedNodes.includes(nodeId)) {
            throw createError({ statusCode: 400, statusMessage: 'You do not own that node' })
        }
        if (state.capitals.includes(nodeId) && state.capitals.length <= 1) {
            throw createError({ statusCode: 400, statusMessage: 'Your last capital is where everything is delivered' })
        }
        return abandonNode(state, nodeId)
    })

    return { ...caravanResponse(ctx), ...result }
})
