import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoPlants } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { addPlants } from '#server/utils/xeno'
import { debit } from '#server/utils/balance'
import { getPlantOrThrow } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string; quantity: number }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id
  const qty = body.quantity ?? 1
  if (!body.typeId || qty < 1 || qty > 10) {
    throw createError({ statusCode: 400, statusMessage: 'Provide typeId and quantity (1–10)' })
  }

  const plant = getPlantOrThrow(body.typeId)

  const owned = await db.query.xenoPlants.findFirst({
    where: and(eq(xenoPlants.userId, userId), eq(xenoPlants.typeId, body.typeId)),
  })
  if (!owned) throw createError({ statusCode: 403, statusMessage: 'Plant type not unlocked' })

  const unitPrice = Math.round(plant.value * 2 * (1 + plant.yield) * (1 + plant.speed * 0.05))
  const total = unitPrice * qty

  await debit(userId, total.toFixed(4), 'xeno')
  await addPlants(userId, plant.id, plant.speed, plant.yield, qty)

  return { bought: qty, total, unitPrice }
})
