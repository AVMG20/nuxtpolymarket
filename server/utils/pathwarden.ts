import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import {
    PATHWARDEN_CHECKPOINT_WAVES,
    PATHWARDEN_MAX_WAVE,
    pathwardenAetherCashoutBonus,
    pathwardenCheckpointReward,
    pathwardenMaxAetherAtCheckpoint,
    pathwardenMaxScore,
    pathwardenMaxWaveForElapsedMs,
    type PathwardenBoostLevels
} from '#shared/utils/gamelogic/pathwarden'

export type LockedPathwardenState = typeof pathwardenState.$inferSelect

export function pathwardenLevels(state: LockedPathwardenState): PathwardenBoostLevels {
    return {
        bulwark: state.bulwarkLevel,
        artificer: state.artificerLevel,
        lens: state.lensLevel,
        reservoir: state.reservoirLevel,
        banner: state.bannerLevel,
        bounty: state.bountyLevel,
        arcanist: state.arcanistLevel
    }
}

export async function getLockedPathwardenState(tx: DbExecutor, userId: string) {
    await tx.insert(pathwardenState).values({ userId }).onConflictDoNothing()
    const [state] = await tx.select()
        .from(pathwardenState)
        .where(eq(pathwardenState.userId, userId))
        .for('update')
    if (!state) {
        throw createError({ statusCode: 500, statusMessage: 'Could not initialize Pathwarden state' })
    }
    return state
}

export type PathwardenFinishReason = 'cashout' | 'victory' | 'defeat'

/**
 * What actually happened in the run, read from the persisted game state — never
 * from the request body. The client's finish-run call only chooses the reason;
 * every number here comes from the row the engine saved through run.put, which
 * is itself capped against the clock.
 */
export interface PathwardenRunReport {
    reason: PathwardenFinishReason
    wave: number
    aether: number
    score: number
    flawless: number
}

export interface PathwardenSettlement {
    reason: PathwardenFinishReason
    settled: boolean
    effectiveWave: number
    coins: number
    guaranteedReward: number
    aetherBonus: number
    aetherCounted: number
    aetherCap: number
    score: number
    flawless: number
    completedRealm: number
    maxUnlockedRealm: number
    claimedCheckpointWaves: number[]
    runsPlayed: number
    bestWave: number
    bestScore: number
    bestRealm: number
    bestFlawless: number
}

/**
 * Server-authoritative settlement. The wave that can be paid for is the smallest
 * of what the save reports and what the wall-clock plausibly allows, so a
 * scripted finish is capped down to whatever time it actually spent. A victory
 * (and the realm unlock it grants) requires genuinely reaching the final wave
 * within a plausible time — not a client flag.
 */
export function settlePathwardenRun(
    state: LockedPathwardenState,
    report: PathwardenRunReport,
    now: number
): PathwardenSettlement {
    const realm = Math.max(1, state.runRealmSnapshot ?? 1)
    const levels = pathwardenLevels(state)
    const surged = state.runSurgedSnapshot === true
    const startedAt = state.runStartedAt?.getTime() ?? now
    const elapsedMs = Math.max(0, now - startedAt)

    const reportedWave = Math.max(0, Math.min(PATHWARDEN_MAX_WAVE, Math.floor(Number(report.wave) || 0)))
    const effectiveWave = Math.max(0, Math.min(reportedWave, pathwardenMaxWaveForElapsedMs(elapsedMs)))

    const isVictory = report.reason === 'victory' && effectiveWave >= PATHWARDEN_MAX_WAVE
    const settled = report.reason === 'cashout' || isVictory

    const alreadyClaimed = state.claimedCheckpointWaves ?? []
    const unclaimedCheckpoints = settled
        ? PATHWARDEN_CHECKPOINT_WAVES.filter(cp => cp <= effectiveWave && !alreadyClaimed.includes(cp))
        : []
    const guaranteedReward = unclaimedCheckpoints.reduce(
        (total, cp) => total + pathwardenCheckpointReward(cp, realm),
        0
    )

    const aetherCap = pathwardenMaxAetherAtCheckpoint(effectiveWave, levels, surged)
    const aetherCounted = settled ? Math.max(0, Math.min(aetherCap, Math.floor(Number(report.aether) || 0))) : 0
    const aetherBonus = settled ? pathwardenAetherCashoutBonus(aetherCounted, effectiveWave, realm) : 0
    const coins = guaranteedReward + aetherBonus

    const score = Math.max(0, Math.min(pathwardenMaxScore(effectiveWave, realm), Math.floor(Number(report.score) || 0)))
    const flawless = Math.max(0, Math.min(effectiveWave, Math.floor(Number(report.flawless) || 0)))
    const completedRealm = isVictory ? Math.max(state.highestCompletedRealm, realm) : state.highestCompletedRealm

    return {
        reason: report.reason,
        settled,
        effectiveWave,
        coins,
        guaranteedReward,
        aetherBonus,
        aetherCounted,
        aetherCap,
        score,
        flawless,
        completedRealm,
        maxUnlockedRealm: Math.min(5, completedRealm + 1),
        claimedCheckpointWaves: [...alreadyClaimed, ...unclaimedCheckpoints],
        runsPlayed: state.runsPlayed + 1,
        bestWave: Math.max(state.bestWave, effectiveWave),
        bestScore: Math.max(state.bestScore, score),
        bestRealm: Math.max(state.bestRealm, realm),
        bestFlawless: Math.max(state.bestFlawless, flawless)
    }
}
