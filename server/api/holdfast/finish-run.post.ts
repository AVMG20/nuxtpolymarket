import { requireUserId } from '#server/utils/auth'
import { finishHoldfastRun } from '#server/utils/holdfast'
import { holdfastSanitizeStats } from '#shared/utils/holdfast/meta'

/**
 * Records a finished Holdfast run for the leaderboard. Pays nothing.
 * The survival is clamped to what the time since start-run allows; see
 * finishHoldfastRun for the claim.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const runId = body?.runId
    const survivedMs = body?.survivedMs
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 64) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid run' })
    }
    if (typeof survivedMs !== 'number' || !Number.isFinite(survivedMs) || survivedMs < 0) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid run report' })
    }
    return finishHoldfastRun(userId, {
        runId,
        survivedMs,
        won: body?.won === true,
        stats: holdfastSanitizeStats(body?.stats)
    })
})
