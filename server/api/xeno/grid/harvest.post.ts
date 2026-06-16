import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoPlants, xenoArtifacts } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { addPlants, computeGridDuration, consumeArtifactCharge } from '#server/utils/xeno'
import { getPlantOrThrow, getArtifact, rollYield } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const slot = await db.query.xenoGridSlots.findFirst({
    where: and(eq(xenoGridSlots.id, body.slotId), eq(xenoGridSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  if (!slot.startedAt || !slot.plantId) throw createError({ statusCode: 400, statusMessage: 'No plant in this slot' })

  const plantInstance = await db.query.xenoPlants.findFirst({ where: eq(xenoPlants.id, slot.plantId) })
  if (!plantInstance) throw createError({ statusCode: 404, statusMessage: 'Plant instance missing' })

  const attachedArt = slot.artifactId
    ? await db.query.xenoArtifacts.findFirst({ where: eq(xenoArtifacts.id, slot.artifactId) })
    : null

  const durationSecs = computeGridDuration(
    { typeId: plantInstance.typeId, speed: plantInstance.speed },
    attachedArt?.typeId ?? null,
  )
  const completesAt = new Date(slot.startedAt.getTime() + durationSecs * 1000)
  if (Date.now() < completesAt.getTime()) throw createError({ statusCode: 400, statusMessage: 'Plant is still growing' })

  const plantType = getPlantOrThrow(plantInstance.typeId)

  let artifactYieldBonus = 0
  if (attachedArt) {
    const artType = getArtifact(attachedArt.typeId)
    if (artType?.effect.type === 'grid_yield_bonus') artifactYieldBonus = artType.effect.value
  }

  const harvested = rollYield(plantInstance.yield) + artifactYieldBonus
  await db.delete(xenoPlants).where(eq(xenoPlants.id, plantInstance.id))
  await addPlants(userId, plantInstance.typeId, plantInstance.speed, plantInstance.yield, harvested)

  if (slot.artifactId) await consumeArtifactCharge(slot.artifactId, 'grid', slot.id)

  await db.update(xenoGridSlots)
    .set({ plantId: null, startedAt: null })
    .where(eq(xenoGridSlots.id, slot.id))

  return { harvested, plantName: plantType.name }
})
