import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import {
    BASE_REFINERY_LINES,
    RECIPES,
    rescheduleRefineJobs
} from '#shared/utils/caravan/config'
import { bonusesFor } from '#shared/utils/caravan/progression'

/**
 * Cancel a queued batch, or the whole queue.
 *
 * Materials come back in proportion to the work still outstanding: a batch that
 * has not started refunds in full, one halfway through refunds half. That keeps
 * the queue something you can change your mind about without making it free to
 * churn. Whatever is left is re-laid across the lines so the freed time goes to
 * the batches waiting behind it.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ jobId?: string, all?: boolean }>(event)
    const jobId = body?.jobId ? String(body.jobId) : null
    const all = body?.all === true

    const { ctx, result } = await withCaravan(userId, ({ state }) => {
        const now = Date.now()
        const targets = state.refineJobs.filter(job => all || job.id === jobId)
        if (!targets.length) throw createError({ statusCode: 404, statusMessage: 'Nothing to cancel' })

        let refunded = 0
        for (const job of targets) {
            const recipe = RECIPES.find(r => r.id === job.recipeId)
            if (!recipe) continue

            const total = Math.max(1, job.doneAt - job.startedAt)
            const remaining = Math.max(0, Math.min(1, (job.doneAt - Math.max(now, job.startedAt)) / total))
            const batches = Math.floor(job.batches * remaining)
            if (batches <= 0) continue

            for (const [id, count] of Object.entries(recipe.inputs)) {
                state.resources[id] = (state.resources[id] ?? 0) + count * batches
            }
            refunded += batches
        }

        const cancelled = new Set(targets.map(job => job.id))
        const lines = BASE_REFINERY_LINES + bonusesFor(state).refineryLines
        state.refineJobs = rescheduleRefineJobs(
            state.refineJobs.filter(job => !cancelled.has(job.id)),
            lines,
            now
        )
        return refunded
    })

    return { ...caravanResponse(ctx), refunded: result }
})
