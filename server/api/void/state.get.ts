import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import {
    VOID_UPGRADES, VOID_SHIPS, VOID_RARITIES, VOID_SECTORS, VOID_RESOURCES, VOID_SPECIALS, VOID_AFFIXES,
    VOID_RUN_DURATION_MS, VOID_STORM_START_MS, VOID_STORM_FULL_MS, VOID_MIDBOSS_SPAWN_MS, VOID_SALVAGE_RATE,
    VOID_MARKET_PRICES,
    voidNormalizeLevels, voidUpgradeCost, voidDerivedStats, voidPowerLevel, voidRecommendedSector,
    voidSectorUnlocked, voidSalvageValue, voidAffix, voidCanAfford, voidShip, voidModuleScore,
    type VoidWeaponInstance, type VoidAffixId, type VoidSpecialId, type VoidRarityId
} from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const [balance, currentUser, existing, weaponRows] = await Promise.all([
        getBalance(userId),
        db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
        db.query.voidState.findFirst({ where: eq(voidState.userId, userId) }),
        db.query.voidWeapons.findMany({ where: eq(voidWeapons.userId, userId) })
    ])
    const gems = currentUser?.gems ?? 0

    let s = existing
    let rows = weaponRows
    if (!s) {
        s = (await db.insert(voidState).values({ userId }).returning())[0]!
        // Nobody undocks unarmed — the loaner skiff comes with a common module
        // already in its single hardpoint.
        rows = await db.insert(voidWeapons).values({
            userId,
            rarityId: 'common',
            name: 'Halcyon Cutter',
            affixes: { damage: 2.2, miningSpeed: 6 },
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

    /** Shared shape for the hangar and the inventory, so both render identically. */
    const describe = (weapon: VoidWeaponInstance) => ({
        ...weapon,
        rarity: VOID_RARITIES.find(r => r.id === weapon.rarityId) ?? VOID_RARITIES[0],
        special: VOID_SPECIALS.find(sp => sp.id === weapon.specialId) ?? null,
        score: voidModuleScore(weapon),
        affixLines: (Object.entries(weapon.affixes) as [VoidAffixId, number][])
            .map(([id, value]) => {
                const def = voidAffix(id)
                return { id, name: def.name, group: def.group, text: def.describe(value), value }
            })
            .sort((a, b) => a.group.localeCompare(b.group)),
        salvageValue: voidSalvageValue(weapon.rarityId)
    })

    return {
        balance,
        gems,
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
            gemCost: ship.cost.gems ?? 0,
            owned: ownedShipIds.includes(ship.id),
            equipped: ship.id === s.equippedShipId,
            unlocked: s.highestSectorExtracted >= ship.requiresSector,
            affordable: balanceNumber >= ship.cost.credits
                && gems >= (ship.cost.gems ?? 0)
                && voidCanAfford(resources, ship.cost.resources)
        })),
        equippedShipId: s.equippedShipId,
        turretSlots: voidShip(s.equippedShipId).turretSlots,
        weapons: weapons.map(describe),
        rarities: VOID_RARITIES.map(rarity => ({
            ...rarity,
            affordable: balanceNumber >= rarity.cost.credits && voidCanAfford(resources, rarity.cost.resources)
        })),
        affixPool: VOID_AFFIXES.map(a => ({ id: a.id, name: a.name, group: a.group, minRarity: a.minRarity })),
        specials: VOID_SPECIALS,
        resourceCatalog: VOID_RESOURCES.map(resource => ({
            ...resource,
            // Base rate and the rate this loadout actually gets, so the market
            // can show the player what their Profiteering rolls are worth.
            basePrice: VOID_MARKET_PRICES[resource.id],
            price: Math.round(VOID_MARKET_PRICES[resource.id] * stats.marketPriceMult),
            held: Math.max(0, Math.floor((resources as Record<string, number>)[resource.id] ?? 0))
        })),
        marketPriceMult: stats.marketPriceMult,
        salvageRate: VOID_SALVAGE_RATE,
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
            stormFullMs: VOID_STORM_FULL_MS,
            midBossMs: VOID_MIDBOSS_SPAWN_MS
        }
    }
})
