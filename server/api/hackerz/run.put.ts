import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzRuns, hackerzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    HACKERZ_SAVE_VERSION,
    hackerzMaxWaveForElapsedMs,
    hackerzValidateSave,
    type HackerzRunSave
} from '#shared/utils/gamelogic/hackerz'

/**
 * Stores the run between waves. Called once per uplink, which is the only point
 * the game is in a state worth freezing.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ revision?: number, save?: HackerzRunSave }>(event)
    const revision = Math.floor(Number(body?.revision))
    if (!Number.isInteger(revision) || revision < 0 || !hackerzValidateSave(body?.save)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Hackerz save state' })
    }
    const save = body.save as HackerzRunSave

    const [progress] = await db.select({
        runStartedAt: hackerzState.runStartedAt,
        difficulty: hackerzState.runDifficultySnapshot
    }).from(hackerzState).where(eq(hackerzState.userId, userId))
    if (!progress?.runStartedAt) {
        throw createError({ statusCode: 409, statusMessage: 'No active Hackerz run' })
    }
    // The difficulty is stamped at deploy and is what the payout ceiling is
    // computed from, so a save may never change it out from under the run.
    if (save.difficulty !== progress.difficulty) {
        throw createError({ statusCode: 400, statusMessage: 'Save difficulty does not match the active run' })
    }
    // A wave takes a fixed time, so a save can never claim more waves than the
    // clock allows. Two waves of grace absorb the uplink and the boundary moment
    // a wave completes.
    const elapsedMs = Date.now() - progress.runStartedAt.getTime()
    if (save.wave > hackerzMaxWaveForElapsedMs(elapsedMs) + 2) {
        throw createError({ statusCode: 400, statusMessage: 'Save reports more progress than the run has had time for' })
    }

    const [saved] = await db.update(hackerzRuns)
        .set({
            revision: revision + 1,
            saveVersion: HACKERZ_SAVE_VERSION,
            runState: save,
            updatedAt: new Date()
        })
        .where(and(
            eq(hackerzRuns.userId, userId),
            eq(hackerzRuns.revision, revision)
        ))
        .returning({ revision: hackerzRuns.revision, updatedAt: hackerzRuns.updatedAt })
    if (!saved) {
        throw createError({ statusCode: 409, statusMessage: 'The Hackerz save changed in another session' })
    }
    return saved
})
