import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { voidState } from '#server/database/schema'
import {
    VOID_RESOURCE_IDS, VOID_ROCKS, VOID_ENEMIES, VOID_RUN_DURATION_MS,
    voidBundleUnits, voidMaxCreditsForRun, voidExtractionBonus, voidSector,
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
    reportedCredits: number
    reportedHaul: VoidResourceBundle
    reportedKills: number
    reportedRocksMined: number
}

/**
 * Pure finish-run settlement. Cargo is only ever banked on a successful dock
 * with the mothership — dying or timing out in the storm loses the hold, which
 * is the entire point of the mode.
 */
export function settleVoidRun(s: VoidSettlementState, report: VoidRunReport, now: number) {
    const { abandoned, extracted, reason, reportedElapsedMs, reportedCredits, reportedHaul } = report

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

    // Credits are earned in flight (kills, salvage beacons) and survive a
    // death — it's the ore in the hold you lose.
    const creditCap = abandoned ? 0 : voidMaxCreditsForRun(elapsedMs, tier)
    const runCredits = Math.min(Math.max(0, Math.floor(reportedCredits)), creditCap)

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
    const extractionBonus = banked ? voidExtractionBonus(tier, units) : 0
    const awarded = runCredits + extractionBonus

    const nextResources: Record<string, number> = { ...s.resources }
    for (const id of VOID_RESOURCE_IDS) {
        const gained = haul[id] ?? 0
        if (gained > 0) nextResources[id] = Math.max(0, Math.floor(nextResources[id] ?? 0)) + gained
    }

    const isBestRun = !abandoned && (awarded > s.bestRunCredits)

    return {
        runsPlayed: abandoned ? s.runsPlayed : s.runsPlayed + 1,
        extractions: banked ? s.extractions + 1 : s.extractions,
        totalCreditsEarned: s.totalCreditsEarned + awarded,
        rocksMined: abandoned ? s.rocksMined : s.rocksMined + Math.max(0, Math.min(500, Math.floor(report.reportedRocksMined))),
        kills: abandoned ? s.kills : s.kills + Math.max(0, Math.min(5000, Math.floor(report.reportedKills))),
        highestSectorExtracted: banked ? Math.max(s.highestSectorExtracted, tier) : s.highestSectorExtracted,
        bestRunCredits: isBestRun ? awarded : s.bestRunCredits,
        bestRunUnits: isBestRun ? units : s.bestRunUnits,
        bestRunSector: isBestRun ? tier : s.bestRunSector,
        resources: nextResources,
        haul,
        units,
        awarded,
        runCredits,
        extractionBonus,
        capped: runCredits < Math.max(0, Math.floor(reportedCredits)),
        elapsedMs,
        extracted: banked,
        reason,
        tier,
        power,
        sectorName: sector.name
    }
}
