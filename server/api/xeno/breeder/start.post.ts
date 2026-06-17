import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoBreederSlots, xenoArtifacts } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { computeBreedResult, consumePlantsByStack } from '#server/utils/xeno'
import { getPlantOrThrow, getArtifact, getEffectValue } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    slotId: string
    plant1TypeId: string; plant1Speed: number; plant1Yield: number
    plant2TypeId: string; plant2Speed: number; plant2Yield: number
  }>(event)

  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id
  if (!body.plant1TypeId || !body.plant2TypeId) {
    throw createError({ statusCode: 400, statusMessage: 'Provide both plant types' })
  }

  const slot = await db.query.xenoBreederSlots.findFirst({
    where: and(eq(xenoBreederSlots.id, body.slotId), eq(xenoBreederSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Breeder slot not found' })
  if (slot.startedAt && !slot.collected) throw createError({ statusCode: 400, statusMessage: 'Breeding already in progress' })

  getPlantOrThrow(body.plant1TypeId)
  getPlantOrThrow(body.plant2TypeId)

  await consumePlantsByStack(userId, body.plant1TypeId, body.plant1Speed, body.plant1Yield, 1)
  await consumePlantsByStack(userId, body.plant2TypeId, body.plant2Speed, body.plant2Yield, 1)

  let mutationBoost = 0
  let extraYield = 0
  if (slot.artifactId) {
    const art = await db.query.xenoArtifacts.findFirst({ where: eq(xenoArtifacts.id, slot.artifactId) })
    if (art) {
      const artType = getArtifact(art.typeId)
      if (artType) {
        mutationBoost = getEffectValue(artType, 'breeder_mutation_boost')
        extraYield = getEffectValue(artType, 'breeder_extra_yield')
      }
    }
  }

  const result = computeBreedResult(
    { typeId: body.plant1TypeId, speed: body.plant1Speed, yield: body.plant1Yield },
    { typeId: body.plant2TypeId, speed: body.plant2Speed, yield: body.plant2Yield },
    { mutationBoost, extraYield },
  )

  await db.update(xenoBreederSlots)
    .set({
      plant1TypeId: body.plant1TypeId, plant1Speed: body.plant1Speed, plant1Yield: body.plant1Yield,
      plant2TypeId: body.plant2TypeId, plant2Speed: body.plant2Speed, plant2Yield: body.plant2Yield,
      startedAt: new Date(),
      resultTypeId: result.resultTypeId,
      resultSpeed: result.resultSpeed,
      resultYield: result.resultYield,
      resultQuantity: result.resultQuantity,
      wasMutation: result.wasMutation,
      collected: false,
    })
    .where(eq(xenoBreederSlots.id, slot.id))

  return { ok: true, wasMutation: result.wasMutation }
})
