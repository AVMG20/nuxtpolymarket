import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { PIRATE_AMMO_PRICE_PER_UNIT, pirateAmmoCapacity } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const body = await readBody(event)
    const requested = Math.floor(Number(body?.amount) || 0)
    if (requested < 1) throw createError({ statusCode: 400, statusMessage: 'Amount must be at least 1' })

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })

    const capacity = pirateAmmoCapacity(s.ammoCapacityLevel)
    const amount = Math.min(requested, Math.max(0, capacity - s.ammoCount))
    if (amount < 1) throw createError({ statusCode: 400, statusMessage: 'Ammo hold is already full' })

    const cost = amount * PIRATE_AMMO_PRICE_PER_UNIT

    await debit(userId, cost.toFixed(4), 'pirates:ammo')
    await db.update(pirateState).set({ ammoCount: s.ammoCount + amount }).where(eq(pirateState.userId, userId))

    return { bought: amount, cost, ammoCount: s.ammoCount + amount }
})
