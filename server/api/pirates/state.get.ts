import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, pirateCannons, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import {
    PIRATE_SHIP_STAT_IDS, PIRATE_MAX_STAT_LEVEL, PIRATE_RUN_DURATION_MS, PIRATE_MAX_CANNON_SLOTS,
    PIRATE_CANNON_SELL_REFUND_RATE,
    PIRATE_GEM_AMMO_CAPACITY, PIRATE_GEM_AMMO_BUNDLE_SIZE, PIRATE_GEM_AMMO_BUNDLE_PRICE_GEMS,
    pirateUpgradeCost, pirateMaxHp, pirateShipSpeed, pirateDefenseRating, pirateAmmoCapacity,
    pirateSlotUnlockCost, pirateCannonTier, piratePowerLevel, pirateRepairRushCost, pirateAmmoPricePerUnit,
    PIRATE_SHIP_SKINS, PIRATE_ABILITIES, pirateAbility,
    pirateRecommendedDifficulty, pirateDifficultyOptions, pirateAverageRunPayoutEstimate
} from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const [balance, currentUser, existing, cannons] = await Promise.all([
        getBalance(userId),
        db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
        db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) }),
        db.query.pirateCannons.findMany({ where: eq(pirateCannons.userId, userId) })
    ])

    let s = existing
    let cannonRows = cannons
    if (!s) {
        s = (await db.insert(pirateState).values({ userId }).returning())[0]!
        cannonRows = (await db.insert(pirateCannons).values({ userId, slotIndex: 0, tierId: 'swivel', purchasePrice: 0 }).returning())
    }

    const levels = {
        hull: s.hullLevel,
        speed: s.speedLevel,
        defense: s.defenseLevel,
        ammoCapacity: s.ammoCapacityLevel
    }

    const cannonList = cannonRows
        .sort((a, b) => a.slotIndex - b.slotIndex)
        .map((c) => {
            const tier = pirateCannonTier(c.tierId)
            return {
                slotIndex: c.slotIndex,
                tierId: c.tierId,
                name: tier.name,
                attackRating: tier.attackRating,
                maxDamage: tier.maxDamage,
                reloadMs: tier.reloadMs,
                range: tier.range,
                shotColor: tier.shotColor,
                shotTrail: tier.shotTrail ?? false,
                purchasePrice: c.purchasePrice,
                sellValue: Math.round(c.purchasePrice * PIRATE_CANNON_SELL_REFUND_RATE)
            }
        })

    const capacity = pirateAmmoCapacity(s.ammoCapacityLevel)
    const power = piratePowerLevel({ levels, cannonTierIds: cannonList.map(c => c.tierId), cannonSlots: s.cannonSlots })

    const repairRemainingMs = s.hullRepairUntil ? Math.max(0, s.hullRepairUntil.getTime() - Date.now()) : 0
    const ownedSkinIds = Array.from(new Set(['starter', ...(s.ownedSkinIds ?? [])]))
    const ownedAbilityIds = Array.from(new Set(['bomb', ...(s.ownedAbilityIds ?? [])]))
    const equippedAbilityId = pirateAbility(s.equippedAbilityId).id
    const recommendedDifficulty = pirateRecommendedDifficulty(s.highestCompletedDifficulty)
    const difficultyOptions = pirateDifficultyOptions(Math.max(power, recommendedDifficulty))

    return {
        balance,
        gems: currentUser?.gems ?? 0,
        levels,
        maxLevel: PIRATE_MAX_STAT_LEVEL,
        costs: Object.fromEntries(PIRATE_SHIP_STAT_IDS.map(id => [id, pirateUpgradeCost(levels[id])])),
        power,
        stats: {
            maxHp: pirateMaxHp(s.hullLevel),
            speed: pirateShipSpeed(s.speedLevel),
            defenseRating: pirateDefenseRating(s.defenseLevel),
            ammoCapacity: capacity
        },
        cannons: cannonList,
        cannonSlots: s.cannonSlots,
        maxCannonSlots: PIRATE_MAX_CANNON_SLOTS,
        nextSlotCost: pirateSlotUnlockCost(s.cannonSlots),
        ammo: {
            count: s.ammoCount,
            capacity,
            pricePerUnit: pirateAmmoPricePerUnit(power)
        },
        gemAmmo: {
            count: s.gemAmmoCount,
            capacity: PIRATE_GEM_AMMO_CAPACITY,
            bundleSize: PIRATE_GEM_AMMO_BUNDLE_SIZE,
            bundlePriceGems: PIRATE_GEM_AMMO_BUNDLE_PRICE_GEMS
        },
        runsPlayed: s.runsPlayed,
        totalCoinsEarned: s.totalCoinsEarned,
        bestSurvivalMs: s.bestSurvivalMs,
        highestCompletedDifficulty: s.highestCompletedDifficulty,
        recommendedDifficulty,
        difficultyOptions: difficultyOptions.map(difficulty => ({
            difficulty,
            estimatedLoot: pirateAverageRunPayoutEstimate(difficulty),
            completed: difficulty <= s.highestCompletedDifficulty
        })),
        skins: PIRATE_SHIP_SKINS.map(skin => ({ ...skin, owned: ownedSkinIds.includes(skin.id), equipped: skin.id === s.equippedSkinId })),
        equippedSkinId: s.equippedSkinId,
        abilities: PIRATE_ABILITIES.map(ability => ({ ...ability, owned: ownedAbilityIds.includes(ability.id), equipped: ability.id === equippedAbilityId })),
        equippedAbilityId,
        runDurationMs: PIRATE_RUN_DURATION_MS,
        activeRun: s.runStartedAt ? { startedAt: s.runStartedAt } : null,
        repair: {
            until: repairRemainingMs > 0 ? s.hullRepairUntil : null,
            remainingMs: repairRemainingMs,
            totalMs: repairRemainingMs > 0 ? s.hullRepairTotalMs : 0,
            rushCost: repairRemainingMs > 0 ? pirateRepairRushCost(power, repairRemainingMs) : 0
        }
    }
})
