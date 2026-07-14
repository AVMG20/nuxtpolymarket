import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, pirateCannons } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { piratePowerLevel, pirateRepairRushCost } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const [s, cannons] = await Promise.all([
        db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) }),
        db.query.pirateCannons.findMany({ where: eq(pirateCannons.userId, userId) })
    ])
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })

    const remainingMs = s.hullRepairUntil ? s.hullRepairUntil.getTime() - Date.now() : 0
    if (remainingMs <= 0) throw createError({ statusCode: 400, statusMessage: 'Your ship isn\'t under repair' })

    const levels = {
        hull: s.hullLevel,
        speed: s.speedLevel,
        defense: s.defenseLevel,
        ammoCapacity: s.ammoCapacityLevel,
        regen: s.regenLevel
    }
    const power = piratePowerLevel({ levels, cannonTierIds: cannons.map(c => c.tierId), cannonSlots: s.cannonSlots })
    const cost = pirateRepairRushCost(power, remainingMs)

    await debit(userId, cost.toFixed(4), 'pirates:repair-rush')
    await db.update(pirateState)
        .set({ hullRepairUntil: null, hullRepairTotalMs: 0 })
        .where(eq(pirateState.userId, userId))

    return { cost }
})
