import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { callOfXenoState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { callOfXenoLevels, getLockedCallOfXenoState } from '#server/utils/call-of-xeno'
import { callOfXenoDifficulty, callOfXenoUpgradeEffects } from '#shared/utils/gamelogic/call-of-xeno-meta'
import {
    callOfXenoMinElapsedMsForRound,
    callOfXenoSavePointsCeiling,
    callOfXenoValidateSave,
    type CallOfXenoRunSave
} from '#shared/utils/gamelogic/call-of-xeno-save'

/**
 * Stores the run at a round boundary — the only point the game is in a
 * state worth freezing. Called once per completed round.
 *
 * Nothing the client says is taken on faith: the run must still be armed
 * (the deploy stamped its clock), the claimed depth must fit the wall
 * clock the server itself measured, and the points are stored clamped to
 * the same honesty ceiling the settle will apply.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ revision?: number, save?: CallOfXenoRunSave }>(event)
    const revision = Math.floor(Number(body?.revision))
    if (!Number.isInteger(revision) || revision < 0 || !callOfXenoValidateSave(body?.save)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid CALL OF XENO save state' })
    }
    const save = body.save

    return db.transaction(async (tx) => {
        const state = await getLockedCallOfXenoState(tx, userId)
        if (!state.runStartedAt) {
            throw createError({ statusCode: 409, statusMessage: 'No active CALL OF XENO run' })
        }

        const difficulty = callOfXenoDifficulty(state.runDifficultySnapshot)
        const elapsedMs = Date.now() - state.runStartedAt.getTime()
        // Rounds cannot complete faster than the spawn pacing allows, so a
        // save deeper than the session's wall clock is a forged one.
        if (callOfXenoMinElapsedMsForRound(save.round, difficulty) > elapsedMs) {
            throw createError({ statusCode: 400, statusMessage: 'Save reports more progress than the run has had time for' })
        }

        // Points ride along for the resume, but clamped to what this much
        // playtime could plausibly have earned — a tampered save cannot
        // bank a payout the clock disallows.
        const ceiling = callOfXenoSavePointsCeiling(elapsedMs, difficulty)
        const startingPoints = callOfXenoUpgradeEffects(callOfXenoLevels(state)).startingPoints
        const clamped: CallOfXenoRunSave = {
            ...save,
            grossEarned: Math.min(save.grossEarned, ceiling),
            score: Math.min(save.score, startingPoints + ceiling)
        }

        // The revision CAS is the claim: a second session saving the same
        // run finds the revision moved and loses instead of overwriting.
        const [saved] = await tx.update(callOfXenoState).set({
            runSave: clamped,
            runSaveRevision: revision + 1
        }).where(and(
            eq(callOfXenoState.userId, userId),
            eq(callOfXenoState.runSaveRevision, revision),
            isNotNull(callOfXenoState.runStartedAt)
        )).returning({ revision: callOfXenoState.runSaveRevision })
        if (!saved) throw createError({ statusCode: 409, statusMessage: 'The CALL OF XENO save changed in another session' })
        return saved
    })
})
