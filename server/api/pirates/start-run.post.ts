import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, pirateCannons } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
    PIRATE_RUN_DURATION_MS, piratePowerLevel,
    PIRATE_MAX_DIFFICULTY, PIRATE_DIFFICULTY_STEP,
    pirateMaxHp, pirateShipSpeed, pirateDefenseRating, pirateAmmoCapacity, pirateCannonTier, pirateAbility, pirateRegenRate
} from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id
    const body = await readBody(event)
    const difficulty = Number(body?.difficulty)
    if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > PIRATE_MAX_DIFFICULTY || difficulty % PIRATE_DIFFICULTY_STEP !== 0) {
        throw createError({ statusCode: 400, statusMessage: `Difficulty must be a multiple of ${PIRATE_DIFFICULTY_STEP}` })
    }

    const [s, cannons] = await Promise.all([
        db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) }),
        db.query.pirateCannons.findMany({ where: eq(pirateCannons.userId, userId) })
    ])
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'A voyage is already active' })
    if (s.hullRepairUntil && s.hullRepairUntil.getTime() > Date.now()) {
        throw createError({ statusCode: 400, statusMessage: 'Your ship is still in dry dock — repair it or rush the repair first' })
    }
    if (cannons.length < 1) throw createError({ statusCode: 400, statusMessage: 'Equip at least one cannon before setting sail' })
    const levels = {
        hull: s.hullLevel,
        speed: s.speedLevel,
        defense: s.defenseLevel,
        ammoCapacity: s.ammoCapacityLevel,
        regen: s.regenLevel
    }
    const power = piratePowerLevel({ levels, cannonTierIds: cannons.map(c => c.tierId), cannonSlots: s.cannonSlots })
    const startedAt = new Date()

    await db.update(pirateState)
        .set({ runStartedAt: startedAt, runPowerSnapshot: power, runDifficultySnapshot: difficulty })
        .where(eq(pirateState.userId, userId))

    return {
        startedAt,
        power,
        difficulty,
        skinId: s.equippedSkinId,
        abilityId: pirateAbility(s.equippedAbilityId).id,
        runDurationMs: PIRATE_RUN_DURATION_MS,
        stats: {
            maxHp: pirateMaxHp(s.hullLevel),
            speed: pirateShipSpeed(s.speedLevel),
            defenseRating: pirateDefenseRating(s.defenseLevel),
            ammoCapacity: pirateAmmoCapacity(s.ammoCapacityLevel),
            regenRate: pirateRegenRate(s.regenLevel)
        },
        ammo: s.ammoCount,
        gemAmmo: s.gemAmmoCount,
        cannons: cannons
            .sort((a, b) => a.slotIndex - b.slotIndex)
            .map((c) => {
                const tier = pirateCannonTier(c.tierId)
                return {
                    slotIndex: c.slotIndex,
                    tierId: tier.id,
                    attackRating: tier.attackRating,
                    maxDamage: tier.maxDamage,
                    reloadMs: tier.reloadMs,
                    range: tier.range,
                    shotColor: tier.shotColor,
                    shotTrail: tier.shotTrail ?? false
                }
            })
    }
})
