import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { pirateSlotUnlockCost } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot refit mid-voyage' })

    const cost = pirateSlotUnlockCost(s.cannonSlots)
    if (cost === null) throw createError({ statusCode: 400, statusMessage: 'All gun ports already unlocked' })

    await debit(userId, cost.toFixed(4), 'pirates:slot')
    await db.update(pirateState).set({ cannonSlots: s.cannonSlots + 1 }).where(eq(pirateState.userId, userId))

    return { cannonSlots: s.cannonSlots + 1 }
})
