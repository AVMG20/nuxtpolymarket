import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { credit } from '#server/utils/balance'
import { RESEARCH_BY_ID } from '#shared/utils/caravan/config'

/**
 * Abandon the project on the bench.
 *
 * Refunds in proportion to the work still outstanding, the same rule the
 * refinery uses: stopping something you have barely started costs you almost
 * nothing, stopping something nearly finished costs almost everything. Without
 * this, picking the wrong project locked the laboratory for hours.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const { ctx, result } = await withCaravan(userId, async ({ state }, tx) => {
        const job = state.researchJob
        if (!job) throw createError({ statusCode: 400, statusMessage: 'Nothing is being researched' })

        const def = RESEARCH_BY_ID[job.id]
        state.researchJob = null
        if (!def) return 0

        const now = Date.now()
        const total = Math.max(1, job.doneAt - job.startedAt)
        const remaining = Math.max(0, Math.min(1, (job.doneAt - Math.max(now, job.startedAt)) / total))

        for (const [id, count] of Object.entries(def.resources)) {
            state.resources[id] = (state.resources[id] ?? 0) + Math.floor(count * remaining)
        }

        const coins = Math.floor(def.coins * remaining)
        if (coins > 0) await credit(userId, coins.toFixed(4), 'game:caravan', tx)
        return coins
    })

    return { ...caravanResponse(ctx), refunded: result }
})
