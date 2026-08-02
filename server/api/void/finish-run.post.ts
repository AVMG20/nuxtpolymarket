import { and, eq, isNotNull } from 'drizzle-orm'
import { randomChance } from '#shared/utils/random'
import { db } from '#server/database'
import { voidRunHistory, voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState, settleVoidRun, plausibleBossKills } from '#server/utils/void'
import {
    VOID_RESOURCE_IDS, VOID_BOSS_MODULE_DROP_CHANCE,
    rollVoidWeapon, voidRollBossModuleRarity, voidRarity, voidSpecial, voidAffix,
    type VoidResourceBundle, type VoidAffixId
} from '#shared/utils/gamelogic/void'

const REASONS = ['extracted', 'destroyed', 'timeout', 'cancelled']

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const reportedKills = Math.min(5000, Math.max(0, Math.floor(Number(body?.kills) || 0)))
    const reportedBossKills = Math.min(50, Math.max(0, Math.floor(Number(body?.bossKills) || 0)))
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
                // The history column records what the haul was worth, not a
                // payout — nothing in a run pays coins.
                credits: result.haulValue,
                units: result.units,
                haul: result.haul as Record<string, number>,
                extracted: result.extracted,
                reason,
                kills: reportedKills,
                rocksMined: reportedRocksMined,
                shipId: s.equippedShipId
            })
        }

        // Capital drops are rolled here, not on the client: the client only
        // reports how many capitals it downed, and even that is clamped to what
        // the run's real elapsed time could plausibly have produced. Rarity
        // follows the sector, which is the whole reason to push deeper.
        const bossKills = abandoned ? 0 : plausibleBossKills(reportedBossKills, result.elapsedMs)
        const moduleDrops: {
            id: string, name: string, rarityId: string, rarityName: string, hex: string,
            special: string | null, lines: string[]
        }[] = []
        for (let i = 0; i < bossKills; i++) {
            if (!randomChance(VOID_BOSS_MODULE_DROP_CHANCE)) continue
            const rarityId = voidRollBossModuleRarity(result.tier)
            const rolled = rollVoidWeapon(rarityId)
            const [created] = await tx.insert(voidWeapons).values({
                userId,
                rarityId: rolled.rarityId,
                name: rolled.name,
                affixes: rolled.affixes as Record<string, number>,
                specialId: rolled.specialId,
                slotIndex: null
            }).returning()
            const rarity = voidRarity(rarityId)
            moduleDrops.push({
                id: created!.id,
                name: rolled.name,
                rarityId,
                rarityName: rarity.name,
                hex: rarity.hex,
                special: voidSpecial(rolled.specialId)?.name ?? null,
                lines: (Object.entries(rolled.affixes) as [VoidAffixId, number][])
                    .map(([id, value]) => voidAffix(id).describe(value))
            })
        }

        return {
            moduleDrops,
            haulValue: result.haulValue,
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
