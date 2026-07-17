import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, pirateCannons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit, debitGems } from '#server/utils/balance'
import {
    pirateAmmoCapacity, pirateAmmoPricePerUnit, piratePowerLevel,
    PIRATE_GEM_AMMO_CAPACITY, PIRATE_GEM_AMMO_BUNDLE_SIZE, PIRATE_GEM_AMMO_BUNDLE_PRICE_GEMS
} from '#shared/utils/gamelogic/pirates'

// Buys either premium shots (coins, `amount`) or gem powder (gems, `bundles`,
// with `currency: 'gems'`). One endpoint for both keeps the armory simple.
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const [s, cannons] = await Promise.all([
        db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) }),
        db.query.pirateCannons.findMany({ where: eq(pirateCannons.userId, userId) })
    ])
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })

    if (body?.currency === 'gems') {
        const bundles = Math.floor(Number(body?.bundles) || 0)
        if (bundles < 1) throw createError({ statusCode: 400, statusMessage: 'Buy at least one bundle' })

        // Only charge for bundles that actually fit in the magazine.
        const room = Math.max(0, PIRATE_GEM_AMMO_CAPACITY - s.gemAmmoCount)
        const affordableBundles = Math.min(bundles, Math.ceil(room / PIRATE_GEM_AMMO_BUNDLE_SIZE))
        if (affordableBundles < 1) throw createError({ statusCode: 400, statusMessage: 'Gem magazine is already full' })

        const shots = Math.min(room, affordableBundles * PIRATE_GEM_AMMO_BUNDLE_SIZE)
        const gemCost = affordableBundles * PIRATE_GEM_AMMO_BUNDLE_PRICE_GEMS

        await debitGems(userId, gemCost)
        await db.update(pirateState).set({ gemAmmoCount: s.gemAmmoCount + shots }).where(eq(pirateState.userId, userId))

        return { bought: shots, cost: gemCost, currency: 'gems' as const, ammoCount: s.gemAmmoCount + shots }
    }

    const requested = Math.floor(Number(body?.amount) || 0)
    if (requested < 1) throw createError({ statusCode: 400, statusMessage: 'Amount must be at least 1' })

    const capacity = pirateAmmoCapacity(s.ammoCapacityLevel)
    const amount = Math.min(requested, Math.max(0, capacity - s.ammoCount))
    if (amount < 1) throw createError({ statusCode: 400, statusMessage: 'Ammo hold is already full' })

    const power = piratePowerLevel({
        levels: {
            hull: s.hullLevel,
            speed: s.speedLevel,
            defense: s.defenseLevel,
            ammoCapacity: s.ammoCapacityLevel,
            regen: s.regenLevel
        },
        cannonTierIds: cannons.map(cannon => cannon.tierId),
        cannonSlots: s.cannonSlots
    })
    const pricePerUnit = pirateAmmoPricePerUnit(power)
    const cost = amount * pricePerUnit

    await debit(userId, cost.toFixed(4), 'pirates')
    await db.update(pirateState).set({ ammoCount: s.ammoCount + amount }).where(eq(pirateState.userId, userId))

    return { bought: amount, cost, pricePerUnit, currency: 'coins' as const, ammoCount: s.ammoCount + amount }
})
