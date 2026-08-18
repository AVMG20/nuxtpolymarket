import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { callOfXenoState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { callOfXenoBestRounds, callOfXenoLevels, getLockedCallOfXenoState } from '#server/utils/call-of-xeno'
import {
    CALL_OF_XENO_DIFFICULTY_IDS,
    CALL_OF_XENO_DIFFICULTIES,
    callOfXenoDifficultyUnlocked,
    callOfXenoRunCooldownRemainingMs,
    callOfXenoUpgradeEffects,
    type CallOfXenoDifficultyId
} from '#shared/utils/gamelogic/call-of-xeno-meta'

/**
 * A run older than this with no checkpoint is a dead tab the game can
 * never finish — it pays nothing and is cleared so it cannot lock the
 * account out. A run *with* a checkpoint is resumable and is only ever
 * cleared by an explicit abandon or a settle.
 */
const STALE_RUN_MS = 10 * 60 * 1000

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const difficultyId = body?.difficultyId as CallOfXenoDifficultyId
    if (!CALL_OF_XENO_DIFFICULTY_IDS.includes(difficultyId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid difficulty' })
    }
    // The client sets this when the player confirms abandoning a stuck run
    // (a dead tab from a lost connection). The abandoned run pays nothing.
    const forceAbandon = body?.force === true

    return db.transaction(async (tx) => {
        const state = await getLockedCallOfXenoState(tx, userId)
        if (state.runStartedAt) {
            // A run holding a checkpoint is always resumable, no matter its
            // age — abandoning it must be the player's explicit choice. A
            // run with no checkpoint never got past a round boundary, so it
            // is a dead tab: after a grace window it is cleared so it
            // cannot lock the account out forever.
            const resumable = state.runSave !== null
            if (!forceAbandon && (resumable || Date.now() - state.runStartedAt.getTime() < STALE_RUN_MS)) {
                throw createError({ statusCode: 400, statusMessage: 'A CALL OF XENO run is already active' })
            }
            await tx.update(callOfXenoState).set({
                runStartedAt: null,
                runDifficultySnapshot: null,
                runPayoutMultSnapshot: null,
                runSave: null,
                runSaveRevision: 0
            }).where(eq(callOfXenoState.userId, userId))
        }

        if (callOfXenoRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now()) > 0) {
            throw createError({ statusCode: 400, statusMessage: 'Outpost is on cooldown — come back later' })
        }

        const difficulty = CALL_OF_XENO_DIFFICULTIES.find(d => d.id === difficultyId)!
        if (!callOfXenoDifficultyUnlocked(difficulty, callOfXenoBestRounds(state))) {
            throw createError({
                statusCode: 400,
                statusMessage: `${difficulty.name} unlocks at round ${difficulty.requiredBestRound} on ${difficulty.previous}`
            })
        }

        const effects = callOfXenoUpgradeEffects(callOfXenoLevels(state))
        const runStartedAt = new Date()
        await tx.update(callOfXenoState).set({
            runStartedAt,
            runDifficultySnapshot: difficultyId,
            // Snapshotted at deploy so buying Contract levels mid-run cannot
            // inflate the payout a run already earned its way to.
            runPayoutMultSnapshot: effects.payoutMult.toFixed(4),
            // Fresh run, fresh checkpoint slot.
            runSave: null,
            runSaveRevision: 0
        }).where(eq(callOfXenoState.userId, userId))

        return {
            difficulty,
            effects,
            payoutMult: effects.payoutMult,
            // The server-stamped start, so the client's live payout preview
            // runs off the exact clock the settle will use.
            runStartedAt
        }
    })
})
