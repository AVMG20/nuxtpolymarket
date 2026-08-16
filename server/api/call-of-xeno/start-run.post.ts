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
 * A run older than this is a dead tab the game can never finish — there is no
 * mid-run save, so a refresh abandons it for good and it pays nothing. Short,
 * because the only thing a long window buys is locking the account out.
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
            // The game has no mid-run save: a run that never reported back is
            // a dead tab, and it pays nothing. After a grace window it is
            // cleared so it cannot lock the account out forever; an explicit
            // abandon clears it immediately.
            if (!forceAbandon && Date.now() - state.runStartedAt.getTime() < STALE_RUN_MS) {
                throw createError({ statusCode: 400, statusMessage: 'A CALL OF XENO run is already active' })
            }
            await tx.update(callOfXenoState).set({
                runStartedAt: null,
                runDifficultySnapshot: null,
                runPayoutMultSnapshot: null
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
            runPayoutMultSnapshot: effects.payoutMult.toFixed(4)
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
