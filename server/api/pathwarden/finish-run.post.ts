import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedPathwardenState, pathwardenLevels } from '#server/utils/pathwarden'
import {
    PATHWARDEN_CHECKPOINT_WAVES,
    pathwardenCashoutCoins,
    pathwardenMaxAetherAtCheckpoint
} from '#shared/utils/gamelogic/pathwarden'

type FinishReason = 'cashout' | 'victory' | 'defeat' | 'abandoned'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{
        reason?: FinishReason
        wave?: number
        aether?: number
        score?: number
        flawless?: number
    }>(event)
    const reason = body.reason
    if (!reason || !['cashout', 'victory', 'defeat', 'abandoned'].includes(reason)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid run result' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        if (!state.runStartedAt || !state.runRealmSnapshot) {
            throw createError({ statusCode: 409, statusMessage: 'No active Pathwarden run' })
        }
        const wave = Math.max(0, Math.min(12, Math.floor(Number(body.wave) || 0)))
        if (reason === 'cashout' && !PATHWARDEN_CHECKPOINT_WAVES.includes(wave as 4 | 8 | 12)) {
            throw createError({ statusCode: 400, statusMessage: 'You may only cash out at a checkpoint' })
        }
        if (reason === 'victory' && wave !== 12) {
            throw createError({ statusCode: 400, statusMessage: 'The final wave has not been completed' })
        }
        const elapsedSeconds = (Date.now() - state.runStartedAt.getTime()) / 1000
        if ((reason === 'cashout' || reason === 'victory') && elapsedSeconds < wave * 3) {
            throw createError({ statusCode: 400, statusMessage: 'That many waves could not have elapsed yet' })
        }

        const settled = reason === 'cashout' || reason === 'victory'
        const levels = pathwardenLevels(state)
        const maxAether = pathwardenMaxAetherAtCheckpoint(wave, levels, state.runSurgedSnapshot === true)
        const reportedAether = Math.floor(Number(body.aether) || 0)
        const aether = settled ? Math.max(0, Math.min(maxAether, reportedAether)) : 0
        const coins = settled
            ? pathwardenCashoutCoins(aether, wave, state.runRealmSnapshot)
            : 0
        const maxScore = 50_000_000 * state.runRealmSnapshot
        const score = Math.max(0, Math.min(maxScore, Math.floor(Number(body.score) || 0)))
        const flawless = Math.max(0, Math.min(wave, Math.floor(Number(body.flawless) || 0)))
        const ranked = reason !== 'abandoned'
        const completedRealm = reason === 'victory'
            ? Math.max(state.highestCompletedRealm, state.runRealmSnapshot)
            : state.highestCompletedRealm

        await tx.update(pathwardenState)
            .set({
                runsPlayed: sql`${pathwardenState.runsPlayed} + 1`,
                totalCoinsEarned: sql`${pathwardenState.totalCoinsEarned} + ${coins.toFixed(4)}::numeric`,
                bestWave: ranked ? Math.max(state.bestWave, wave) : state.bestWave,
                bestScore: ranked ? Math.max(state.bestScore, score) : state.bestScore,
                bestRealm: ranked ? Math.max(state.bestRealm, state.runRealmSnapshot) : state.bestRealm,
                bestFlawless: ranked ? Math.max(state.bestFlawless, flawless) : state.bestFlawless,
                highestCompletedRealm: completedRealm,
                runStartedAt: null,
                runRealmSnapshot: null,
                runPowerSnapshot: null,
                runSurgedSnapshot: null,
                ...(reason === 'abandoned' ? {} : { lastRunFinishedAt: new Date() })
            })
            .where(eq(pathwardenState.userId, userId))
        if (coins > 0) {
            await credit(userId, coins.toFixed(4), 'pathwarden:cashout', tx)
        }
        return {
            reason,
            wave,
            coins,
            aetherCounted: aether,
            aetherCap: maxAether,
            maxUnlockedRealm: Math.min(5, completedRealm + 1)
        }
    })
})
