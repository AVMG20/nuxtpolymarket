import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoPlantsUnlocked } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { addPlants } from '#server/utils/xeno'
import { debit } from '#server/utils/balance'
import { getPlantOrThrow, plantBuyPrice } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string; quantity: number }>(event)
  const userId = await requireUserId(event)

  const qty = body.quantity ?? 1
  if (!body.typeId || qty < 1 || qty > 10) {
    throw createError({ statusCode: 400, statusMessage: 'Provide typeId and quantity (1–10)' })
  }

  const plant = getPlantOrThrow(body.typeId)

  const unlocked = await db.query.xenoPlantsUnlocked.findFirst({
    where: and(eq(xenoPlantsUnlocked.userId, userId), eq(xenoPlantsUnlocked.typeId, body.typeId)),
  })
  if (!unlocked) throw createError({ statusCode: 403, statusMessage: 'Plant type not unlocked' })

  const unitPrice = plantBuyPrice(plant)
  const total = unitPrice * qty

  await debit(userId, total.toFixed(4), 'xeno')
  await addPlants(userId, plant.id, plant.speed, plant.yield, qty)

  return { bought: qty, total, unitPrice }
})
