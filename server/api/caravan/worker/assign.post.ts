import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { crewOf, isWorkable, nodeCapacity } from '#shared/utils/caravan/assignment'
import { bonusesFor } from '#shared/utils/caravan/progression'

/**
 * Post workers to a seam, or pull them off one with a null node.
 *
 * This is the only thing that decides where anyone works -- the simulation never
 * picks a node for a worker, it only carries out the posting. The whole batch is
 * validated before anything is written, so a request that would overfill a seam
 * changes nothing rather than assigning half of it.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ workerId?: string, workerIds?: string[], nodeId?: number | null }>(event)
    const ids = Array.isArray(body?.workerIds)
        ? body.workerIds.map(String)
        : body?.workerId
            ? [String(body.workerId)]
            : []
    if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'No workers given' })

    const nodeId = body?.nodeId === null || body?.nodeId === undefined ? null : Number(body.nodeId)
    if (nodeId !== null && !Number.isInteger(nodeId)) {
        throw createError({ statusCode: 400, statusMessage: 'Bad node' })
    }

    const { ctx, result } = await withCaravan(userId, ({ state, world }) => {
        const unique = [...new Set(ids)]
        const party = unique.map((id) => {
            const worker = state.workers.find(w => w.id === id)
            if (!worker) throw createError({ statusCode: 404, statusMessage: 'No such worker' })
            return worker
        })

        if (nodeId !== null) {
            const node = world.nodes[nodeId]
            if (!isWorkable(state, node)) {
                throw createError({ statusCode: 400, statusMessage: 'That is not a seam you hold' })
            }
            // Anyone already posted here keeps their place and does not count
            // against the room the rest of the batch needs.
            const staying = crewOf(state, nodeId).filter(w => !unique.includes(w.id)).length
            if (staying + party.length > nodeCapacity(state, nodeId, bonusesFor(state))) {
                throw createError({ statusCode: 400, statusMessage: 'No room left at that seam' })
            }
        }

        let moved = 0
        for (const worker of party) {
            if (worker.assignment === nodeId) continue
            if (worker.activity.type === 'assault') {
                throw createError({ statusCode: 400, statusMessage: `${worker.name} is on campaign` })
            }
            worker.assignment = nodeId
            worker.route = []
            worker.routeIndex = 0
            // Mid-swing at the old seam: stop there. Travel and unload finish
            // normally, so nothing already in the pack is dropped -- a part-laden
            // worker simply carries it on to the new seam and tops it up there.
            if (worker.activity.type === 'harvest') worker.activity = { type: 'idle' }
            moved++
        }
        return moved
    })

    return { ...caravanResponse(ctx), moved: result }
})
