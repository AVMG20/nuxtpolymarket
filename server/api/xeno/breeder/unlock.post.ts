import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoBreederSlots } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { breederSlotUnlockCost, XENO_MAX_BREEDER_SLOTS } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const slots = await db.query.xenoBreederSlots.findMany({ where: eq(xenoBreederSlots.userId, userId) })
  const nextIndex = slots.length

  if (nextIndex >= XENO_MAX_BREEDER_SLOTS) {
    throw createError({ statusCode: 400, statusMessage: 'Maximum breeder slots reached' })
  }

  const cost = breederSlotUnlockCost(nextIndex)
  if (cost > 0) {
    await debit(userId, cost.toFixed(4), 'xeno')
  }

  await db.insert(xenoBreederSlots).values({ userId, slotIndex: nextIndex })

  return { slotIndex: nextIndex, cost }
})
