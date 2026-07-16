import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, pirateCannons } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { PIRATE_CANNON_TIERS } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const body = await readBody(event)
    const slotIndex = Number(body?.slotIndex)
    const tierId = String(body?.tierId ?? '')
    const tier = PIRATE_CANNON_TIERS.find(t => t.id === tierId)
    if (!tier) throw createError({ statusCode: 400, statusMessage: 'Invalid cannon tier' })

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot refit mid-voyage' })
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= s.cannonSlots) {
        throw createError({ statusCode: 400, statusMessage: 'Gun port not unlocked' })
    }

    const existing = await db.query.pirateCannons.findFirst({
        where: and(eq(pirateCannons.userId, userId), eq(pirateCannons.slotIndex, slotIndex))
    })
    if (existing) throw createError({ statusCode: 400, statusMessage: 'Slot occupied — sell the current cannon first' })

    await debit(userId, tier.cost.toFixed(4), 'pirates')
    await db.insert(pirateCannons).values({ userId, slotIndex, tierId: tier.id, purchasePrice: tier.cost })

    return { slotIndex, tierId: tier.id }
})
