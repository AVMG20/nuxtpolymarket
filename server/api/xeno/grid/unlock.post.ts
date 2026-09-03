import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, xenoGridSlots } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { gridSlotUnlockCost, XENO_MAX_GRID_SLOTS } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction(async (tx) => {
    // Serialise unlocks per user: without the lock, N concurrent requests all
    // count the same slot total, all pay, and all insert the same slotIndex.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update')

    const slots = await tx.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) })
    const nextIndex = slots.length

    if (nextIndex >= XENO_MAX_GRID_SLOTS) {
      throw createError({ statusCode: 400, statusMessage: 'Maximum grid slots reached' })
    }

    const cost = gridSlotUnlockCost(nextIndex)
    if (cost > 0) {
      await debit(userId, cost.toFixed(4), 'xeno', tx)
    }

    await tx.insert(xenoGridSlots).values({ userId, slotIndex: nextIndex })

    return { slotIndex: nextIndex, cost }
  })
})
