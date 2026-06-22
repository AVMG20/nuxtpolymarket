import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoPlants, xenoArtifacts } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getPlant, getArtifact, isHybrid } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string; typeId: string; speed: number; yield: number }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id
  if (!body.typeId) throw createError({ statusCode: 400, statusMessage: 'Provide typeId' })

  const hybrid = isHybrid(body.typeId)
  const plantType = hybrid ? null : getPlant(body.typeId)
  if (!hybrid && !plantType) throw createError({ statusCode: 400, statusMessage: `Unknown plant type: ${body.typeId}` })

  const slot = await db.query.xenoGridSlots.findFirst({
    where: and(eq(xenoGridSlots.id, body.slotId), eq(xenoGridSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  if (slot.startedAt) throw createError({ statusCode: 400, statusMessage: 'Slot already has a plant' })

  if (plantType?.voidPlant) {
    const artRecord = slot.artifactId
      ? await db.query.xenoArtifacts.findFirst({ where: eq(xenoArtifacts.id, slot.artifactId) })
      : null
    const artType = artRecord ? getArtifact(artRecord.typeId) : null
    if (!artType || artType.level < 2) {
      throw createError({ statusCode: 400, statusMessage: 'Void plants require a tier II or higher artifact in this slot.' })
    }
  }

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
