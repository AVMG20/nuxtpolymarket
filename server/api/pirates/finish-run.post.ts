import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateRunHistory, pirateState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedPirateState, settlePirateRun } from '#server/utils/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const reportedCoins = Math.max(0, Math.floor(Number(body?.coins) || 0))
    const reportedAmmoUsed = Math.max(0, Math.floor(Number(body?.ammoUsed) || 0))
    const reportedGemAmmoUsed = Math.max(0, Math.floor(Number(body?.gemAmmoUsed) || 0))
    const reportedKills = Math.min(10_000, Math.max(0, Math.floor(Number(body?.kills) || 0)))
    const reportedShotsFired = Math.min(100_000, Math.max(0, Math.floor(Number(body?.shotsFired) || 0)))
    // The client's own elapsed-time counter only advances while the voyage is
    // actively simulating (it's frozen whenever the tab is paused/navigated
    // away), unlike wall-clock time below — this is what lets a paused-and-
    // resumed voyage report its real playtime instead of however long the
    // player spent browsing the armory.
    const reportedElapsedMs = Math.max(0, Math.floor(Number(body?.elapsedMs) || 0))
    const survived = Boolean(body?.survived)
    const reportedReason = String(body?.reason ?? '')
    const reason = ['timeout', 'defeat', 'cancelled'].includes(reportedReason) ? reportedReason : 'defeat'
    // The client reports how banged-up the hull ended up (0 = pristine, 1 =
    // sunk) so we know how long the repair should take. A 'defeat' finish
    // means hp hit zero by definition, so that one is forced to full damage
    // server-side regardless of what's reported — no reason to trust the
    // client on the one case that's unambiguous.
    const reportedHullDamageFraction = Math.min(1, Math.max(0, Number(body?.hullDamageFraction) || 0))
    // Set when the client is just clearing a stale lock left by a closed tab on
    // page load, not reporting a real voyage — its wall-clock "elapsed" time is
    // dead browser-closed time, not gameplay, so it must never count toward
    // stats (bestSurvivalMs, runsPlayed) even though the lock still needs clearing.
    const abandoned = Boolean(body?.abandoned)

    return db.transaction(async (tx) => {
        const s = await getLockedPirateState(tx, userId)
        const runStartedAt = s.runStartedAt
        if (!runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active voyage' })

        const result = settlePirateRun({ ...s, runStartedAt }, {
            abandoned,
            survived,
            reason,
            reportedElapsedMs,
            reportedCoins,
            reportedKills,
            reportedShotsFired,
            reportedAmmoUsed,
            reportedGemAmmoUsed,
            reportedHullDamageFraction
        }, Date.now())

        // Row lock above plus this runStartedAt guard: only the request that clears it pays out.
        const [claimed] = await tx.update(pirateState).set({
            runStartedAt: null,
            runPowerSnapshot: null,
            runDifficultySnapshot: null,
            runsPlayed: result.runsPlayed,
            totalCoinsEarned: result.totalCoinsEarned,
            ammoCount: result.ammoCount,
            gemAmmoCount: result.gemAmmoCount,
            bestSurvivalMs: result.bestSurvivalMs,
            bestRunPower: result.bestRunPower,
            bestRunLoot: result.bestRunLoot,
            highestCompletedDifficulty: result.highestCompletedDifficulty,
            bestCompletedLoot: result.bestCompletedLoot,
            bestCompletedPower: result.bestCompletedPower,
            bestCompletedSkinId: result.bestCompletedSkinId,
            hullRepairUntil: result.hullRepairUntil,
            hullRepairTotalMs: result.hullRepairTotalMs
        }).where(and(eq(pirateState.userId, userId), isNotNull(pirateState.runStartedAt)))
            .returning({ userId: pirateState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'No active voyage' })

        if (!abandoned) {
            await tx.insert(pirateRunHistory).values({
                userId,
                loot: result.awarded,
                durationMs: result.elapsedMs,
                power: result.power,
                difficulty: result.difficulty,
                survived,
                reason,
                kills: reportedKills,
                shotsFired: reportedShotsFired,
                skinId: s.equippedSkinId
            })
        }

        if (result.awarded > 0) await credit(userId, result.awarded.toFixed(4), 'pirates', tx)

        return {
            awarded: result.awarded,
            completionBonus: result.completionBonus,
            capped: result.capped,
            elapsedMs: result.elapsedMs,
            survived,
            completed: result.completed,
            difficulty: result.difficulty,
            ammoRemaining: result.ammoCount,
            gemAmmoRemaining: result.gemAmmoCount,
            repairUntil: result.hullRepairUntil,
            repairTotalMs: result.hullRepairTotalMs
        }
    })
})
