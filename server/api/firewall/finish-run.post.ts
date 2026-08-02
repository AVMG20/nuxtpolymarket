import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { firewallRuns, firewallState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedFirewallState, settleFirewallRun } from '#server/utils/firewall'
import { firewallMaxWaveForElapsedMs } from '#shared/utils/gamelogic/firewall'

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
        const state = await getLockedFirewallState(tx, userId)
        if (!state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active FIREWALL run' })

        // Coins, kills and depth are read off the stored save, never off the
        // request body. The client already had to get them past run.put's
        // validation and its wall-clock wave check, which closes the gap where a
        // forged finish-run could pay out a run that was never played.
        const saved = await tx.query.firewallRuns.findFirst({ where: eq(firewallRuns.userId, userId) })
        const runState = saved?.runState ?? null
        const elapsedMs = Date.now() - state.runStartedAt.getTime()
        const wave = Math.max(0, Math.min(runState?.wave ?? 0, firewallMaxWaveForElapsedMs(elapsedMs) + 2))

        const result = settleFirewallRun(state, {
            reason,
            reportedWave: wave,
            reportedCoins: runState?.coins ?? 0,
            reportedKills: runState?.kills ?? 0
        })

        const now = Date.now()
        // Clearing the active-run lock *is* the claim: a second request in flight
        // finds it already null, throws, and pays nothing.
        const [claimed] = await tx.update(firewallState).set({
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
        }).where(and(eq(firewallState.userId, userId), isNotNull(firewallState.runStartedAt)))
            .returning({ userId: firewallState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'No active FIREWALL run' })

        await tx.delete(firewallRuns).where(eq(firewallRuns.userId, userId))
        if (result.awarded > 0) await credit(userId, result.awarded.toFixed(4), 'firewall', tx)

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
