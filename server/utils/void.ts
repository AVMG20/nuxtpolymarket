import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { voidState } from '#server/database/schema'
import {
    VOID_RESOURCE_IDS, VOID_ROCKS, VOID_ENEMIES, VOID_RUN_DURATION_MS,
    voidBundleUnits, voidBundleValue, voidSector,
    type VoidResourceBundle, type VoidResourceId
} from '#shared/utils/gamelogic/void'

export async function getLockedVoidState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(voidState).where(eq(voidState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Void state not initialized' })
    return state
}

/**
 * Which resources can physically enter the hold in a given sector. A finish-run
 * payload claiming xenite out of Halcyon Drift is simply dropped — the client
 * had no way to mine it there.
 */
export function voidSectorResourceSet(tier: number): Set<VoidResourceId> {
    const index = Math.max(0, Math.min(3, tier - 1))
    const allowed = new Set<VoidResourceId>()
    for (const rock of VOID_ROCKS) {
        if (rock.weights[index]! > 0) allowed.add(rock.resource)
    }
    for (const enemy of VOID_ENEMIES) {
        if (!enemy.boss && enemy.weights[index]! <= 0) continue
        for (const drop of enemy.drops) allowed.add(drop.resource)
    }
    return allowed
}

/**
 * Caps how many capitals a run could honestly have downed. The mid-boss lands
 * at minute three and the sector capital cycles roughly every two minutes after
 * that, so anything beyond one per ninety seconds of real elapsed time is a
 * forged payload and gets trimmed.
 */
export function plausibleBossKills(reported: number, elapsedMs: number) {
    const ceiling = Math.floor(Math.max(0, elapsedMs) / 90_000)
    return Math.max(0, Math.min(Math.floor(reported), ceiling))
}

export interface VoidSettlementState {
    runStartedAt: Date
    runSectorSnapshot: number | null
    runPowerSnapshot: number | null
    runCargoSnapshot: number | null
    resources: Record<string, number>
    runsPlayed: number
    extractions: number
    totalCreditsEarned: number
    rocksMined: number
    kills: number
    highestSectorExtracted: number
    bestRunCredits: number
    bestRunUnits: number
    bestRunSector: number
}

export interface VoidRunReport {
    /** Clearing a stale lock left by a closed tab — never counts as a run. */
    abandoned: boolean
    extracted: boolean
    reason: string
    reportedElapsedMs: number
    reportedHaul: VoidResourceBundle
    reportedKills: number
    reportedRocksMined: number
}

/**
 * Pure finish-run settlement. Nothing here pays coins — the sector only yields
 * material, and material only becomes money at the market. Cargo is banked
 * solely on a successful dock; dying or timing out in the storm loses the whole
 * hold, which is the entire point of the mode.
 */
export function settleVoidRun(s: VoidSettlementState, report: VoidRunReport, now: number) {
    const { abandoned, extracted, reason, reportedElapsedMs, reportedHaul } = report

    const rawElapsedMs = now - s.runStartedAt.getTime()
    const wallClampedMs = Math.max(0, Math.min(rawElapsedMs, VOID_RUN_DURATION_MS + 5000))
    // The client's counter is frozen while the tab is hidden, so it reports
    // real playtime; the wall clock above bounds how much of it is plausible.
    const elapsedMs = abandoned ? 0 : Math.max(0, Math.min(reportedElapsedMs, wallClampedMs))
    const tier = s.runSectorSnapshot ?? 1
    const sector = voidSector(tier)
    const power = s.runPowerSnapshot ?? 0
    const cargoCapacity = Math.max(0, s.runCargoSnapshot ?? 0)

    const banked = extracted && !abandoned

    const allowed = voidSectorResourceSet(tier)
    const haul: VoidResourceBundle = {}
    if (banked) {
        // Trim the reported hold down to what the ship could actually hold,
        // largest stacks first so a legitimate overflow loses the cheap ore.
        let remaining = cargoCapacity
        const entries = VOID_RESOURCE_IDS
            .filter(id => allowed.has(id))
            .map(id => [id, Math.max(0, Math.floor(reportedHaul[id] ?? 0))] as const)
            .filter(([, amount]) => amount > 0)
            .sort((a, b) => a[1] - b[1])
        for (const [id, amount] of entries) {
            const take = Math.min(amount, remaining)
            if (take > 0) haul[id] = take
            remaining -= take
            if (remaining <= 0) break
        }
    }

    const units = voidBundleUnits(haul)
    // Recorded for the run log so the history reads in money terms even though
    // nothing was paid out here.
    const haulValue = voidBundleValue(haul)

    const nextResources: Record<string, number> = { ...s.resources }
    for (const id of VOID_RESOURCE_IDS) {
        const gained = haul[id] ?? 0
        if (gained > 0) nextResources[id] = Math.max(0, Math.floor(nextResources[id] ?? 0)) + gained
    }

    const isBestRun = !abandoned && (haulValue > s.bestRunCredits)

    return {
        runsPlayed: abandoned ? s.runsPlayed : s.runsPlayed + 1,
        extractions: banked ? s.extractions + 1 : s.extractions,
        totalCreditsEarned: s.totalCreditsEarned,
        rocksMined: abandoned ? s.rocksMined : s.rocksMined + Math.max(0, Math.min(500, Math.floor(report.reportedRocksMined))),
        kills: abandoned ? s.kills : s.kills + Math.max(0, Math.min(5000, Math.floor(report.reportedKills))),
        highestSectorExtracted: banked ? Math.max(s.highestSectorExtracted, tier) : s.highestSectorExtracted,
        bestRunCredits: isBestRun ? haulValue : s.bestRunCredits,
        bestRunUnits: isBestRun ? units : s.bestRunUnits,
        bestRunSector: isBestRun ? tier : s.bestRunSector,
        resources: nextResources,
        haul,
        units,
        haulValue,
        elapsedMs,
        extracted: banked,
        reason,
        tier,
        power,
        sectorName: sector.name
    }
}
