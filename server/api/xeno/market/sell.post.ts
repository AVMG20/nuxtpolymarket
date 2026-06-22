import { db } from '#server/database'
import { auth } from '#server/utils/auth'
import { consumePlantsByStack } from '#server/utils/xeno'
import { credit } from '#server/utils/balance'
import { getPlantDisplay } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string; speed: number; yield: number; quantity: number }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id
  const qty = body.quantity ?? 1
  if (!body.typeId || qty < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Provide typeId and a positive quantity' })
  }

  const plant = getPlantDisplay(body.typeId)
  if (!plant) throw createError({ statusCode: 400, statusMessage: `Unknown plant type: ${body.typeId}` })
  await consumePlantsByStack(userId, body.typeId, body.speed, body.yield, qty)

  const total = plant.value * qty
  await credit(userId, total.toFixed(4), 'xeno')
  return { sold: qty, total }
})
