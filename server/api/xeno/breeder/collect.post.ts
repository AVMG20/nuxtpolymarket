import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoBreederSlots, xenoArtifacts } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { addPlants, consumeArtifactCharge, computeBreedDuration } from '#server/utils/xeno'
import { getArtifact, getPlantOrThrow } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const slot = await db.query.xenoBreederSlots.findFirst({
    where: and(eq(xenoBreederSlots.id, body.slotId), eq(xenoBreederSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Breeder slot not found' })
  if (!slot.startedAt || !slot.plant1TypeId || !slot.plant2TypeId) {
    throw createError({ statusCode: 400, statusMessage: 'No active breed' })
  }
  if (slot.collected) throw createError({ statusCode: 400, statusMessage: 'Already collected' })

  const durationSecs = computeBreedDuration(
    { typeId: slot.plant1TypeId, speed: slot.plant1Speed ?? 1 },
    { typeId: slot.plant2TypeId, speed: slot.plant2Speed ?? 1 },
  )
  const completesAt = slot.startedAt.getTime() + durationSecs * 1000
  if (Date.now() < completesAt) throw createError({ statusCode: 400, statusMessage: 'Breeding not complete yet' })

  if (!slot.resultTypeId || slot.resultSpeed == null || slot.resultYield == null) {
    throw createError({ statusCode: 500, statusMessage: 'No result recorded' })
  }

  let extraYield = 0
  if (slot.artifactId) {
    const art = await db.query.xenoArtifacts.findFirst({ where: eq(xenoArtifacts.id, slot.artifactId) })
    if (art) {
      const artType = getArtifact(art.typeId)
      if (artType?.effect.type === 'breeder_extra_yield') extraYield = artType.effect.value
    }
  }

  const totalQty = (slot.resultQuantity ?? 1) + extraYield
  const plantType = getPlantOrThrow(slot.resultTypeId)

  await addPlants(userId, slot.resultTypeId, slot.resultSpeed, slot.resultYield, totalQty)

  if (slot.artifactId) await consumeArtifactCharge(slot.artifactId, 'breeder', slot.id)

  await db.update(xenoBreederSlots)
    .set({
      plant1TypeId: null, plant1Speed: null, plant1Yield: null,
      plant2TypeId: null, plant2Speed: null, plant2Yield: null,
      startedAt: null,
      resultTypeId: null, resultSpeed: null, resultYield: null, resultQuantity: null, wasMutation: null,
      collected: true,
    })
    .where(eq(xenoBreederSlots.id, slot.id))

  return { collected: totalQty, plantName: plantType.name, wasMutation: slot.wasMutation }
})
