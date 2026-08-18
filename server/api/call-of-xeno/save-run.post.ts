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
 *
 * Writes are ordered by the depth they claim, not by a revision counter,
 * so a checkpoint whose response the client never saw does not wedge the
 * slot for the rest of the run. `revision` is still accepted and returned
 * for the client's progress display; it no longer gates the write.
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

        // Progress, not a counter, is the claim. The row is already held
        // under FOR UPDATE, so reading the stored depth here and writing
        // against it is safe — and it keeps the property the old revision
        // CAS existed for (a second session cannot bury a deeper
        // checkpoint) without the failure mode it came with. A revision
        // CAS only holds while the client's counter tracks the server's,
        // and the client save is fire-and-forget: one response lost to a
        // network blip after the write committed left the client's counter
        // permanently behind, every later save rejected, and the
        // checkpoint frozen at that round for the rest of the run — which
        // the settle then reads as the round the run reached.
        const storedRound = state.runSave?.round ?? 0
        if (save.round < storedRound) {
            throw createError({ statusCode: 409, statusMessage: 'The CALL OF XENO save changed in another session' })
        }

        const [saved] = await tx.update(callOfXenoState).set({
            runSave: clamped,
            // Still monotonic, still reported to the client — it is now a
            // progress marker rather than a gate.
            runSaveRevision: state.runSaveRevision + 1
        }).where(and(
            eq(callOfXenoState.userId, userId),
            isNotNull(callOfXenoState.runStartedAt)
        )).returning({ revision: callOfXenoState.runSaveRevision })
        if (!saved) throw createError({ statusCode: 409, statusMessage: 'The CALL OF XENO save changed in another session' })
        return saved
    })
})
