import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoPlants, xenoArtifacts } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { computeGridDuration } from '#server/utils/xeno'
import { getPlantOrThrow } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string; typeId: string; speed: number; yield: number }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id
  if (!body.typeId) throw createError({ statusCode: 400, statusMessage: 'Provide typeId' })

  getPlantOrThrow(body.typeId)

  const slot = await db.query.xenoGridSlots.findFirst({
    where: and(eq(xenoGridSlots.id, body.slotId), eq(xenoGridSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  if (slot.startedAt) throw createError({ statusCode: 400, statusMessage: 'Slot already has a plant' })

  const allOfStack = await db.query.xenoPlants.findMany({
    where: and(
      eq(xenoPlants.userId, userId),
      eq(xenoPlants.typeId, body.typeId),
      eq(xenoPlants.speed, body.speed),
      eq(xenoPlants.yield, body.yield),
    ),
  })
  const plantedIds = new Set(
    (await db.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) }))
      .map(s => s.plantId).filter(Boolean),
  )
  const freePlant = allOfStack.find(p => !plantedIds.has(p.id))
  if (!freePlant) throw createError({ statusCode: 400, statusMessage: 'No free plant of that type available' })

  await db.update(xenoGridSlots)
    .set({ plantId: freePlant.id, startedAt: new Date() })
    .where(eq(xenoGridSlots.id, slot.id))

  return { ok: true }
})
