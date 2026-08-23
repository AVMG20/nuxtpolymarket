import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'

/**
 * Pull everyone off a seam.
 *
 * Sets the node's priority to Off and releases whoever is working it, so they
 * carry what they already have back to a capital, unload it, and get reassigned
 * somewhere else. Without this the only way to clear a node was to raise every
 * other node above it and wait.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ nodeId?: number, silence?: boolean }>(event)
    const nodeId = Number(body?.nodeId)
    if (!Number.isInteger(nodeId)) throw createError({ statusCode: 400, statusMessage: 'Bad node' })

    const { ctx, result } = await withCaravan(userId, ({ state }) => {
        if (!state.ownedNodes.includes(nodeId)) {
            throw createError({ statusCode: 400, statusMessage: 'You do not own that node' })
        }

        // Switching the seam off first means the allocator will not simply send
        // them straight back the moment they are free.
        if (body?.silence !== false) state.nodePriority[nodeId] = 0

        let recalled = 0
        for (const worker of state.workers) {
            if (worker.assignment !== nodeId) continue
            worker.assignment = null
            worker.route = []
            worker.routeIndex = 0
            // Anyone mid-harvest stops where they are; travel and unload finish
            // normally so nothing already in a pack is lost.
            if (worker.activity.type === 'harvest') worker.activity = { type: 'idle' }
            recalled++
        }
        return recalled
    })

    return { ...caravanResponse(ctx), recalled: result }
})
