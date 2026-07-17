import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoBreederSlots } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { addPlants } from '#server/utils/xeno'

export default defineEventHandler(async (event) => {
  const { slotId } = await readBody<{ slotId: string }>(event)
  const userId = await requireUserId(event)

  const slot = await db.query.xenoBreederSlots.findFirst({
    where: and(eq(xenoBreederSlots.id, slotId), eq(xenoBreederSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Breeder slot not found' })
  if (!slot.startedAt || !slot.plant1TypeId || !slot.plant2TypeId) {
    throw createError({ statusCode: 400, statusMessage: 'No active breed to cancel' })
  }
  if (slot.collected) throw createError({ statusCode: 400, statusMessage: 'Already collected' })

  // Return both parents to inventory
  await addPlants(userId, slot.plant1TypeId, slot.plant1Speed ?? 0, slot.plant1Yield ?? 0, 1)
  await addPlants(userId, slot.plant2TypeId, slot.plant2Speed ?? 0, slot.plant2Yield ?? 0, 1)

  await db.update(xenoBreederSlots)
    .set({
      plant1TypeId: null, plant1Speed: null, plant1Yield: null,
      plant2TypeId: null, plant2Speed: null, plant2Yield: null,
      startedAt: null,
      resultTypeId: null, resultSpeed: null, resultYield: null, resultQuantity: null, wasMutation: null,
      collected: false,
    })
    .where(eq(xenoBreederSlots.id, slotId))

  return { cancelled: true }
})
