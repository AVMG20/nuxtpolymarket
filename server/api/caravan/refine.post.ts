import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import {
    BASE_REFINERY_LINES,
    MAX_REFINERY_QUEUE,
    RECIPES,
    effectiveRefineSeconds,
    scheduleRefineJob
} from '#shared/utils/caravan/config'
import { bonusesFor } from '#shared/utils/caravan/progression'
import { hasResources, spendResources } from '#shared/utils/caravan/state'

/**
 * Queue a refining batch.
 *
 * Refining used to be instant, which made it a button you mashed rather than a
 * decision. Now every batch occupies a line for real time: materials are taken
 * up front and the goods land when the clock runs out. The queue itself is never
 * closed -- extra batches simply stack up behind the ones already running, and
 * more lines is what research buys.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ recipeId?: string, batches?: number }>(event)
    const recipeId = String(body?.recipeId ?? '')
    const batches = Math.max(1, Math.min(500, Math.floor(Number(body?.batches ?? 1))))

    const { ctx } = await withCaravan(userId, ({ state }) => {
        const recipe = RECIPES.find(r => r.id === recipeId)
        if (!recipe) throw createError({ statusCode: 404, statusMessage: 'No such recipe' })
        if (recipe.tier > state.tier) throw createError({ statusCode: 400, statusMessage: `Requires tier ${recipe.tier}` })

        const bonuses = bonusesFor(state)
        const lines = BASE_REFINERY_LINES + bonuses.refineryLines

        const now = Date.now()
        const seconds = effectiveRefineSeconds(recipe.tier, bonuses.refineSpeed) * batches
        const slot = scheduleRefineJob(state.refineJobs, lines, now, seconds)

        // Asking for more of what is already on the line is more of that batch,
        // not a second card in the queue -- otherwise tapping bread five times
        // reads as five separate orders that all land at the same moment. Only
        // merge when the batch would have had to wait anyway: with a line
        // standing idle a separate job runs in parallel and lands sooner.
        const mergeInto = slot.startedAt > now
            ? state.refineJobs
                .filter(job => job.recipeId === recipeId
                    // Extending a job with something queued behind it on the same
                    // line would run the two on top of each other.
                    && state.refineJobs.every(other => other.line !== job.line || other.doneAt <= job.doneAt))
                .sort((a, b) => a.doneAt - b.doneAt)[0] ?? null
            : null

        // Lines govern how fast the backlog clears, never whether you may add to
        // it -- a full queue just means the last batch lands later.
        if (!mergeInto && state.refineJobs.length >= MAX_REFINERY_QUEUE) {
            throw createError({ statusCode: 400, statusMessage: 'The queue is full' })
        }

        const cost = Object.fromEntries(
            Object.entries(recipe.inputs).map(([id, count]) => [id, count * batches])
        )
        if (!hasResources(state, cost)) throw createError({ statusCode: 400, statusMessage: 'Not enough materials' })

        // Materials are taken now. A queued batch is a commitment, which is what
        // makes choosing between two recipes actually cost something.
        spendResources(state, cost)

        if (mergeInto) {
            mergeInto.batches += batches
            mergeInto.doneAt += seconds * 1000
        } else {
            state.refineJobs.push({
                id: `rf_${now.toString(36)}_${state.refineJobs.length}`,
                recipeId,
                batches,
                ...slot
            })
        }
    })

    return caravanResponse(ctx)
})
