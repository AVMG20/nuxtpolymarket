import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns, pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import {
    getLockedPathwardenState,
    settlePathwardenRun,
    type PathwardenFinishReason
} from '#server/utils/pathwarden'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ reason?: PathwardenFinishReason }>(event)
    const reason = body.reason
    if (!reason || !['cashout', 'victory', 'defeat'].includes(reason)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid run result' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        if (!state.runStartedAt || !state.runRealmSnapshot) {
            throw createError({ statusCode: 409, statusMessage: 'No active Pathwarden run' })
        }
        // The run's outcome is read from what the engine persisted, never from
        // the request body — the client only chooses cashout/victory/defeat.
        const [run] = await tx.select({ gameState: pathwardenRuns.gameState })
            .from(pathwardenRuns)
            .where(eq(pathwardenRuns.userId, userId))
            .for('update')
        const saved = run?.gameState ?? null

        const result = settlePathwardenRun(state, {
            reason,
            wave: saved?.wave ?? 0,
            aether: saved?.aether ?? 0,
            score: saved?.score ?? 0,
            flawless: saved?.flawlessWaves ?? 0
        }, Date.now())

        await tx.update(pathwardenState)
            .set({
                runsPlayed: result.runsPlayed,
                totalCoinsEarned: sql`${pathwardenState.totalCoinsEarned} + ${result.coins.toFixed(4)}::numeric`,
                bestWave: result.bestWave,
                bestScore: result.bestScore,
                bestRealm: result.bestRealm,
                bestFlawless: result.bestFlawless,
                highestCompletedRealm: result.completedRealm,
                runStartedAt: null,
                runRealmSnapshot: null,
                runPowerSnapshot: null,
                runSurgedSnapshot: null,
                claimedCheckpointWaves: result.claimedCheckpointWaves,
                lastRunFinishedAt: new Date()
            })
            .where(eq(pathwardenState.userId, userId))
        await tx.delete(pathwardenRuns).where(eq(pathwardenRuns.userId, userId))
        if (result.coins > 0) {
            await credit(userId, result.coins.toFixed(4), 'pathwarden:cashout', tx)
        }
        return {
            reason: result.reason,
            wave: result.effectiveWave,
            coins: result.coins,
            guaranteedReward: result.guaranteedReward,
            aetherBonus: result.aetherBonus,
            aetherCounted: result.aetherCounted,
            aetherCap: result.aetherCap,
            maxUnlockedRealm: result.maxUnlockedRealm
        }
    })
})
