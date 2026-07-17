import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { lootboxSlotCost, LOOTBOX_MAX_SLOTS } from '#shared/utils/miner-config'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const s = await db.query.minerState.findFirst({ where: eq(minerState.userId, userId) })
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

  if (s.lootboxSlots >= LOOTBOX_MAX_SLOTS)
    throw createError({ statusCode: 400, statusMessage: 'Maximum lootbox slots reached' })

  const cost = lootboxSlotCost(s.lootboxSlots)
  await debit(userId, cost.toFixed(4), 'lootbox')

  const [updated] = await db
    .update(minerState)
    .set({ lootboxSlots: s.lootboxSlots + 1 })
    .where(eq(minerState.userId, userId))
    .returning({ lootboxSlots: minerState.lootboxSlots })

  return { newSlots: updated!.lootboxSlots }
})
