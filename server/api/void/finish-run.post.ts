import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { voidRunHistory, voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedVoidState, settleVoidRun } from '#server/utils/void'
import { VOID_RESOURCE_IDS, type VoidResourceBundle } from '#shared/utils/gamelogic/void'

const REASONS = ['extracted', 'destroyed', 'timeout', 'cancelled']

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const reportedCredits = Math.max(0, Math.floor(Number(body?.credits) || 0))
    const reportedKills = Math.min(5000, Math.max(0, Math.floor(Number(body?.kills) || 0)))
    const reportedRocksMined = Math.min(500, Math.max(0, Math.floor(Number(body?.rocksMined) || 0)))
    // The client's own counter only advances while the run is actually
    // simulating, so a tab left in the background reports its real playtime
    // rather than the wall-clock gap. settleVoidRun still bounds it.
    const reportedElapsedMs = Math.max(0, Math.floor(Number(body?.elapsedMs) || 0))
    const rawReason = String(body?.reason ?? '')
    const reason = REASONS.includes(rawReason) ? rawReason : 'destroyed'
    const extracted = reason === 'extracted'
    const abandoned = Boolean(body?.abandoned)

    const rawHaul = (body?.haul ?? {}) as Record<string, unknown>
    const reportedHaul: VoidResourceBundle = {}
    for (const id of VOID_RESOURCE_IDS) {
        const amount = Math.max(0, Math.floor(Number(rawHaul[id]) || 0))
        if (amount > 0) reportedHaul[id] = Math.min(amount, 100_000)
    }

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        const runStartedAt = s.runStartedAt
        if (!runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active run' })

        const result = settleVoidRun({ ...s, runStartedAt }, {
            abandoned,
            extracted,
            reason,
            reportedElapsedMs,
            reportedCredits,
            reportedHaul,
            reportedKills,
            reportedRocksMined
        }, Date.now())

        // The row lock plus this runStartedAt guard: only the request that
        // clears the lock pays out, so a double-submit can't bank twice.
        const [claimed] = await tx.update(voidState).set({
            runStartedAt: null,
            runSectorSnapshot: null,
            runPowerSnapshot: null,
            runCargoSnapshot: null,
            resources: result.resources,
            runsPlayed: result.runsPlayed,
            extractions: result.extractions,
            totalCreditsEarned: result.totalCreditsEarned,
            rocksMined: result.rocksMined,
            kills: result.kills,
            highestSectorExtracted: result.highestSectorExtracted,
            bestRunCredits: result.bestRunCredits,
            bestRunUnits: result.bestRunUnits,
            bestRunSector: result.bestRunSector
        }).where(and(eq(voidState.userId, userId), isNotNull(voidState.runStartedAt)))
            .returning({ userId: voidState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'No active run' })

        if (!abandoned) {
            await tx.insert(voidRunHistory).values({
                userId,
                sector: result.tier,
                power: result.power,
                durationMs: result.elapsedMs,
                credits: result.awarded,
                units: result.units,
                haul: result.haul as Record<string, number>,
                extracted: result.extracted,
                reason,
                kills: reportedKills,
                rocksMined: reportedRocksMined,
                shipId: s.equippedShipId
            })
        }

        if (result.awarded > 0) await credit(userId, result.awarded.toFixed(4), 'void', tx)

        return {
            awarded: result.awarded,
            runCredits: result.runCredits,
            extractionBonus: result.extractionBonus,
            capped: result.capped,
            elapsedMs: result.elapsedMs,
            extracted: result.extracted,
            reason,
            sector: result.tier,
            sectorName: result.sectorName,
            haul: result.haul,
            units: result.units,
            sectorUnlocked: result.highestSectorExtracted > s.highestSectorExtracted ? result.highestSectorExtracted + 1 : null
        }
    })
})
