import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import {
    VOID_UPGRADES, VOID_SHIPS, VOID_RARITIES, VOID_SECTORS, VOID_RESOURCES, VOID_SPECIALS, VOID_AFFIXES,
    VOID_RUN_DURATION_MS, VOID_STORM_START_MS, VOID_STORM_FULL_MS,
    voidNormalizeLevels, voidUpgradeCost, voidDerivedStats, voidPowerLevel, voidRecommendedSector,
    voidSectorUnlocked, voidWeaponSellValue, voidAffix, voidCanAfford, voidShip,
    type VoidWeaponInstance, type VoidAffixId, type VoidSpecialId, type VoidRarityId
} from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const [balance, existing, weaponRows] = await Promise.all([
        getBalance(userId),
        db.query.voidState.findFirst({ where: eq(voidState.userId, userId) }),
        db.query.voidWeapons.findMany({ where: eq(voidWeapons.userId, userId) })
    ])

    let s = existing
    let rows = weaponRows
    if (!s) {
        s = (await db.insert(voidState).values({ userId }).returning())[0]!
        // Nobody undocks unarmed — the loaner skiff comes with a common turret
        // already in its single hardpoint.
        rows = await db.insert(voidWeapons).values({
            userId,
            rarityId: 'common',
            name: 'Halcyon Repeater',
            affixes: { damage: 2.5 },
            slotIndex: 0
        }).returning()
    }

    const levels = voidNormalizeLevels(s.upgradeLevels)
    const ownedShipIds = Array.from(new Set(['skiff', ...(s.ownedShipIds ?? [])]))
    const weapons: VoidWeaponInstance[] = rows.map(row => ({
        id: row.id,
        rarityId: row.rarityId as VoidRarityId,
        name: row.name,
        affixes: row.affixes as Partial<Record<VoidAffixId, number>>,
        specialId: (row.specialId ?? null) as VoidSpecialId | null,
        slotIndex: row.slotIndex
    }))

    const loadout = { levels, shipId: s.equippedShipId, weapons }
    const stats = voidDerivedStats(loadout)
    const power = voidPowerLevel(loadout)
    const resources = s.resources ?? {}
    const balanceNumber = Number(balance)

    return {
        balance,
        resources,
        levels,
        power,
        stats,
        upgrades: VOID_UPGRADES.map((upgrade) => {
            const level = levels[upgrade.id]
            const cost = voidUpgradeCost(upgrade.id, level)
            return {
                id: upgrade.id,
                name: upgrade.name,
                description: upgrade.description,
                icon: upgrade.icon,
                funding: upgrade.funding,
                group: upgrade.group,
                level,
                maxLevel: upgrade.maxLevel,
                current: upgrade.format(level),
                next: level < upgrade.maxLevel ? upgrade.format(level + 1) : null,
                cost,
                affordable: cost ? balanceNumber >= cost.credits && voidCanAfford(resources, cost.resources) : false
            }
        }),
        ships: VOID_SHIPS.map(ship => ({
            ...ship,
            owned: ownedShipIds.includes(ship.id),
            equipped: ship.id === s.equippedShipId,
            unlocked: s.highestSectorExtracted >= ship.requiresSector,
            affordable: balanceNumber >= ship.cost.credits && voidCanAfford(resources, ship.cost.resources)
        })),
        equippedShipId: s.equippedShipId,
        turretSlots: voidShip(s.equippedShipId).turretSlots,
        weapons: weapons.map(weapon => ({
            ...weapon,
            rarity: VOID_RARITIES.find(r => r.id === weapon.rarityId) ?? VOID_RARITIES[0],
            special: VOID_SPECIALS.find(sp => sp.id === weapon.specialId) ?? null,
            affixLines: (Object.entries(weapon.affixes) as [VoidAffixId, number][])
                .map(([id, value]) => ({ id, name: voidAffix(id).name, text: voidAffix(id).describe(value), value })),
            sellValue: voidWeaponSellValue(weapon.rarityId)
        })),
        rarities: VOID_RARITIES.map(rarity => ({
            ...rarity,
            affordable: balanceNumber >= rarity.cost.credits && voidCanAfford(resources, rarity.cost.resources)
        })),
        affixPool: VOID_AFFIXES.map(a => ({ id: a.id, name: a.name, minRarity: a.minRarity })),
        specials: VOID_SPECIALS,
        resourceCatalog: VOID_RESOURCES,
        sectors: VOID_SECTORS.map(sector => ({
            ...sector,
            unlocked: voidSectorUnlocked(sector.tier, s.highestSectorExtracted),
            cleared: s.highestSectorExtracted >= sector.tier
        })),
        recommendedSector: voidRecommendedSector(power, s.highestSectorExtracted),
        highestSectorExtracted: s.highestSectorExtracted,
        runsPlayed: s.runsPlayed,
        extractions: s.extractions,
        totalCreditsEarned: s.totalCreditsEarned,
        rocksMined: s.rocksMined,
        kills: s.kills,
        bestRunCredits: s.bestRunCredits,
        bestRunUnits: s.bestRunUnits,
        bestRunSector: s.bestRunSector,
        activeRun: s.runStartedAt ? { startedAt: s.runStartedAt, sector: s.runSectorSnapshot ?? 1 } : null,
        timings: {
            runDurationMs: VOID_RUN_DURATION_MS,
            stormStartMs: VOID_STORM_START_MS,
            stormFullMs: VOID_STORM_FULL_MS
        }
    }
})
