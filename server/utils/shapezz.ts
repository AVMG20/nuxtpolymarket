import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { shapezzState } from '#server/database/schema'
import {
    SHAPEZZ_CHECKPOINT_MS,
    shapezzCheckpointCount,
    shapezzDifficulty,
    shapezzPayoutForRun,
    type ShapezzDifficultyId,
    type ShapezzWeaponType
} from '#shared/utils/gamelogic/shapezz'

export async function getLockedShapezzState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(shapezzState).where(eq(shapezzState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'SHAPEZZ state not initialized' })
    return state
}

export interface ShapezzArsenalState {
    weaponType: string
    blasterRarity: string
    blasterPurchasePrice: number
    launcherRarity: string | null
    launcherPurchasePrice: number
    shotgunRarity: string | null
    shotgunPurchasePrice: number
}

/** Owned rarity and stored purchase price per weapon type. `rarity: null` means the type is not owned. */
export function shapezzArsenal(state: ShapezzArsenalState): Record<ShapezzWeaponType, { rarity: string | null, purchasePrice: number }> {
    return {
        blaster: { rarity: state.blasterRarity, purchasePrice: state.blasterPurchasePrice },
        launcher: { rarity: state.launcherRarity, purchasePrice: state.launcherPurchasePrice },
        shotgun: { rarity: state.shotgunRarity, purchasePrice: state.shotgunPurchasePrice }
    }
}

export const SHAPEZZ_WEAPON_COLUMNS: Record<ShapezzWeaponType, { rarity: 'blasterRarity' | 'launcherRarity' | 'shotgunRarity', price: 'blasterPurchasePrice' | 'launcherPurchasePrice' | 'shotgunPurchasePrice' }> = {
    blaster: { rarity: 'blasterRarity', price: 'blasterPurchasePrice' },
    launcher: { rarity: 'launcherRarity', price: 'launcherPurchasePrice' },
    shotgun: { rarity: 'shotgunRarity', price: 'shotgunPurchasePrice' }
}

export interface ShapezzSettlementState {
    runStartedAt: Date
    runDifficultySnapshot: string | null
    runPowerSnapshot: number | null
    runsPlayed: number
    totalCoinsEarned: number
    bestSurvivalMs: number
    bestKills: number
    bestCheckpoint: number
}

export interface ShapezzRunReport {
    reason: 'cashout' | 'defeat' | 'abandoned'
    reportedElapsedMs: number
    reportedCoins: number
    reportedKills: number
}

export function settleShapezzRun(state: ShapezzSettlementState, report: ShapezzRunReport, now: number) {
    const rawWallElapsedMs = Math.max(0, now - state.runStartedAt.getTime())
    const elapsedMs = report.reason === 'abandoned'
        ? 0
        : Math.max(0, Math.min(report.reportedElapsedMs, rawWallElapsedMs + 3000, 24 * 60 * 60 * 1000))
    const difficulty = shapezzDifficulty(state.runDifficultySnapshot).id
    const checkpoint = shapezzCheckpointCount(elapsedMs + 1000)
    const validCashout = report.reason === 'cashout' && checkpoint >= 1
    const awarded = validCashout
        ? shapezzPayoutForRun(report.reportedCoins, elapsedMs, difficulty)
        : 0
    const abandoned = report.reason === 'abandoned'

    return {
        runsPlayed: abandoned ? state.runsPlayed : state.runsPlayed + 1,
        totalCoinsEarned: state.totalCoinsEarned + awarded,
        bestSurvivalMs: abandoned ? state.bestSurvivalMs : Math.max(state.bestSurvivalMs, elapsedMs),
        bestKills: abandoned ? state.bestKills : Math.max(state.bestKills, report.reportedKills),
        bestCheckpoint: abandoned ? state.bestCheckpoint : Math.max(state.bestCheckpoint, checkpoint),
        difficulty: difficulty as ShapezzDifficultyId,
        power: state.runPowerSnapshot ?? 10,
        elapsedMs,
        checkpoint,
        awarded,
        capped: awarded < report.reportedCoins,
        cashout: validCashout,
        nextCheckpointMs: Math.max(SHAPEZZ_CHECKPOINT_MS, (checkpoint + 1) * SHAPEZZ_CHECKPOINT_MS)
    }
}
