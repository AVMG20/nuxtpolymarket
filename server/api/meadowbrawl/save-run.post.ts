import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { meadowbrawlState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedMeadowbrawlState } from '#server/utils/meadowbrawl'
import {
    meadowbrawlCoinCeiling,
    meadowbrawlMinElapsedMsForWave,
    meadowbrawlValidateSave,
    type MeadowbrawlRunSave
} from '#shared/utils/gamelogic/meadowbrawl-meta'

/**
 * Stores the run at a wave boundary — the only point the game is in a
 * state worth freezing. Called when the boons are rolled and again once
 * one is picked, so a closed tab never rerolls an offer.
 *
 * The run must still be armed, the save must be the shape the game
 * writes, the coins are stored clamped to what the cleared waves could
 * have dropped, and the wall clock must allow the claimed depth: a wave
 * cannot end before its last spawn walks in, and the floor sits well under
 * the fastest honest pace, so a rejection here is a tampered client.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ save?: MeadowbrawlRunSave }>(event)

    return db.transaction(async (tx) => {
        const state = await getLockedMeadowbrawlState(tx, userId)
        if (!state.runStartedAt) throw createError({ statusCode: 409, statusMessage: 'No active Meadowbrawl run' })

        if (!meadowbrawlValidateSave(body?.save)) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid Meadowbrawl save state' })
        }
        const save = body.save
        const elapsedMs = Date.now() - state.runStartedAt.getTime()
        if (elapsedMs < meadowbrawlMinElapsedMsForWave(save.wave)) {
            throw createError({ statusCode: 400, statusMessage: 'That checkpoint is faster than the meadow allows' })
        }
        // Depth only moves forward: a second session cannot bury a deeper
        // checkpoint with a shallower one.
        const stored = state.runSave
        if (stored && save.wave < stored.wave) {
            throw createError({ statusCode: 409, statusMessage: 'The Meadowbrawl save changed in another session' })
        }
        const clamped: MeadowbrawlRunSave = {
            ...save,
            coins: Math.min(save.coins, meadowbrawlCoinCeiling(save.wave))
        }

        const [saved] = await tx.update(meadowbrawlState).set({
            runSave: clamped,
            runSaveRevision: state.runSaveRevision + 1
        }).where(and(
            eq(meadowbrawlState.userId, userId),
            isNotNull(meadowbrawlState.runStartedAt)
        )).returning({ revision: meadowbrawlState.runSaveRevision })
        if (!saved) throw createError({ statusCode: 409, statusMessage: 'No active Meadowbrawl run' })
        return { revision: saved.revision, coins: clamped.coins }
    })
})
