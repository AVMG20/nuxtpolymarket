import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { fillOrder, isWorkable, roomAt } from '#shared/utils/caravan/assignment'
import { bonusesFor } from '#shared/utils/caravan/progression'

/**
 * Post as many idle workers to a seam as it has room for, specialists first.
 *
 * This is a bulk version of clicking assign a few times, not automation: it
 * touches only workers standing around with no posting, only the seam the player
 * asked about, and only when they ask. Nothing runs it on its own.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ nodeId?: number }>(event)
    const nodeId = Number(body?.nodeId)
    if (!Number.isInteger(nodeId)) throw createError({ statusCode: 400, statusMessage: 'Bad node' })

    const { ctx, result } = await withCaravan(userId, ({ state, world }) => {
        const node = world.nodes[nodeId]
        if (!isWorkable(state, node)) {
            throw createError({ statusCode: 400, statusMessage: 'That is not a seam you hold' })
        }

        const room = roomAt(state, nodeId, bonusesFor(state))
        if (room <= 0) throw createError({ statusCode: 400, statusMessage: 'No room left at that seam' })

        const posted = fillOrder(state, node)
            .filter(worker => worker.activity.type !== 'assault')
            .slice(0, room)
        for (const worker of posted) {
            worker.assignment = nodeId
            worker.route = []
            worker.routeIndex = 0
        }
        if (!posted.length) throw createError({ statusCode: 400, statusMessage: 'Nobody is free to send' })
        return posted.length
    })

    return { ...caravanResponse(ctx), moved: result }
})
