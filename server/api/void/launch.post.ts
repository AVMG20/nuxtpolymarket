import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState } from '#server/utils/void'
import {
    VOID_RUN_DURATION_MS, VOID_STORM_START_MS, VOID_STORM_FULL_MS, VOID_MAX_SECTOR,
    voidNormalizeLevels, voidDerivedStats, voidPowerLevel, voidSectorUnlocked, voidSector,
    voidTurretRuntime, voidShip,
    type VoidWeaponInstance, type VoidAffixId, type VoidSpecialId, type VoidRarityId
} from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const tier = Number(body?.sector)
    if (!Number.isInteger(tier) || tier < 1 || tier > VOID_MAX_SECTOR) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid sector' })
    }

    return db.transaction(async (tx) => {
        // Lock first: the runStartedAt guard below is what stops two parallel
        // launch calls from both authorising a run against the same state.
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'A run is already in progress' })
        if (!voidSectorUnlocked(tier, s.highestSectorExtracted)) {
            throw createError({ statusCode: 400, statusMessage: 'Extract from the previous sector before flying this one' })
        }

        const rows = await tx.query.voidWeapons.findMany({ where: eq(voidWeapons.userId, userId) })
        const weapons: VoidWeaponInstance[] = rows.map(row => ({
            id: row.id,
            rarityId: row.rarityId as VoidRarityId,
            name: row.name,
            affixes: row.affixes as Partial<Record<VoidAffixId, number>>,
            specialId: (row.specialId ?? null) as VoidSpecialId | null,
            slotIndex: row.slotIndex
        }))

        const levels = voidNormalizeLevels(s.upgradeLevels)
        const loadout = { levels, shipId: s.equippedShipId, weapons }
        const stats = voidDerivedStats(loadout)
        const power = voidPowerLevel(loadout)
        const ship = voidShip(s.equippedShipId)

        const equipped = weapons
            .filter(w => w.slotIndex !== null && w.slotIndex < ship.turretSlots)
            .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0))

        const startedAt = new Date()
        const [claimed] = await tx.update(voidState)
            .set({ runStartedAt: startedAt, runSectorSnapshot: tier, runPowerSnapshot: power, runCargoSnapshot: stats.cargoCapacity })
            .where(and(eq(voidState.userId, userId), isNull(voidState.runStartedAt)))
            .returning({ userId: voidState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'A run is already in progress' })

        return {
            startedAt,
            sector: tier,
            sectorConfig: voidSector(tier),
            power,
            stats,
            shipId: ship.id,
            turrets: equipped.map(w => voidTurretRuntime(w, stats.damage)),
            timings: {
                runDurationMs: VOID_RUN_DURATION_MS,
                stormStartMs: VOID_STORM_START_MS,
                stormFullMs: VOID_STORM_FULL_MS
            }
        }
    })
})
