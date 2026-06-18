import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { gridSlotUnlockCost, XENO_MAX_GRID_SLOTS } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id
  const slots = await db.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) })
  const nextIndex = slots.length

  if (nextIndex >= XENO_MAX_GRID_SLOTS) {
    throw createError({ statusCode: 400, statusMessage: 'Maximum grid slots reached' })
  }

  const cost = gridSlotUnlockCost(nextIndex)
  if (cost > 0) {
    await debit(userId, cost.toFixed(4), 'xeno')
  }

  await db.insert(xenoGridSlots).values({ userId, slotIndex: nextIndex })

  return { slotIndex: nextIndex, cost }
})
