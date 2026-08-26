import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'

export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ workerId?: string }>(event)
    const workerId = String(body?.workerId ?? '')

    const { ctx } = await withCaravan(userId, ({ state }) => {
        const index = state.workers.findIndex(w => w.id === workerId)
        if (index === -1) throw createError({ statusCode: 404, statusMessage: 'No such worker' })
        // Gear goes back to the vault; only the worker is let go.
        state.workers.splice(index, 1)
    })

    return caravanResponse(ctx)
})
