import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzRuns, hackerzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedHackerzState, hackerzLevels, settleHackerzRun } from '#server/utils/hackerz'
import { hackerzDifficulty, hackerzMaxWaveForElapsedMs } from '#shared/utils/gamelogic/hackerz'
import { hackerzAccountBounds } from '#shared/utils/gamelogic/hackerz-sim'

/**
 * Ends a run and settles its coins.
 *
 * Navigating away is deliberately *not* one of these: the save survives and
 * `state.get` hands the run back on the next visit. The only ways out are the
 * wall falling, clearing the last wave, and retiring from the uplink.
 */
const REASONS = ['victory', 'defeat', 'retire'] as const

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const rawReason = String(body?.reason ?? '')
    const reason = (REASONS as readonly string[]).includes(rawReason)
        ? rawReason as typeof REASONS[number]
        : 'defeat'

    return db.transaction(async (tx) => {
        const state = await getLockedHackerzState(tx, userId)
        if (!state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active Hackerz run' })

        // Coins, kills and depth are read off the stored save, never off the
        // request body. The client already had to get them past run.put's
        // validation and its wall-clock wave check, which closes the gap where a
        // forged finish-run could pay out a run that was never played.
        const saved = await tx.query.hackerzRuns.findFirst({ where: eq(hackerzRuns.userId, userId) })
        const runState = saved?.runState ?? null
        const elapsedMs = Date.now() - state.runStartedAt.getTime()
        const wave = Math.max(0, Math.min(runState?.wave ?? 0, hackerzMaxWaveForElapsedMs(elapsedMs) + 2))

        // The save is the client's word: what it may claim is bounded by what this
        // account's own build could have done on this difficulty.
        const bounds = hackerzAccountBounds(hackerzLevels(state), hackerzDifficulty(state.runDifficultySnapshot).id)
        const result = settleHackerzRun(state, {
            reason,
            reportedWave: wave,
            reportedCoins: runState?.coins ?? 0,
            reportedKills: runState?.kills ?? 0
        }, bounds)

        const now = Date.now()
        // Clearing the active-run lock *is* the claim: a second request in flight
        // finds it already null, throws, and pays nothing.
        const [claimed] = await tx.update(hackerzState).set({
            runStartedAt: null,
            runDifficultySnapshot: null,
            runPowerSnapshot: null,
            runCoinMultiplierSnapshot: null,
            lastRunFinishedAt: new Date(now),
            runsPlayed: result.runsPlayed,
            totalCoinsEarned: result.totalCoinsEarned,
            bestWave: result.bestWave,
            bestKills: result.bestKills,
            bestPayout: result.bestPayout,
            victories: result.victories
        }).where(and(eq(hackerzState.userId, userId), isNotNull(hackerzState.runStartedAt)))
            .returning({ userId: hackerzState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'No active Hackerz run' })

        await tx.delete(hackerzRuns).where(eq(hackerzRuns.userId, userId))
        if (result.awarded > 0) await credit(userId, result.awarded.toFixed(4), 'hackerz', tx)

        return {
            reason,
            awarded: result.awarded,
            capped: result.capped,
            wave: result.wave,
            kills: result.kills,
            victory: result.victory,
            bestWave: result.bestWave,
            difficulty: result.difficulty.id
        }
    })
})
