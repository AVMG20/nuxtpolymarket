import { eq, and, or, isNull } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoBreederSlots, xenoArtifacts } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { computeBreedResult, consumePlantsByStack } from '#server/utils/xeno'
import { getPlantOrThrow, getArtifact, getEffectValueFor, isHybrid } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    slotId: string
    plant1TypeId: string; plant1Speed: number; plant1Yield: number
    plant2TypeId: string; plant2Speed: number; plant2Yield: number
  }>(event)

  const userId = await requireUserId(event)

  if (!body.plant1TypeId || !body.plant2TypeId) {
    throw createError({ statusCode: 400, statusMessage: 'Provide both plant types' })
  }
  if (isHybrid(body.plant1TypeId) || isHybrid(body.plant2TypeId)) {
    throw createError({ statusCode: 400, statusMessage: 'Hybrids cannot be bred' })
  }

  const slot = await db.query.xenoBreederSlots.findFirst({
    where: and(eq(xenoBreederSlots.id, body.slotId), eq(xenoBreederSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Breeder slot not found' })
  if (slot.startedAt && !slot.collected) throw createError({ statusCode: 400, statusMessage: 'Breeding already in progress' })

  getPlantOrThrow(body.plant1TypeId)
  getPlantOrThrow(body.plant2TypeId)

  let mutationBoost = 0
  let extraYield = 0
  if (slot.artifactId) {
    const art = await db.query.xenoArtifacts.findFirst({ where: eq(xenoArtifacts.id, slot.artifactId) })
    if (art) {
      const artType = getArtifact(art.typeId)
      if (artType) {
        mutationBoost = getEffectValueFor(artType, 'breeder_mutation_boost', art.gemCrafted)
        extraYield = getEffectValueFor(artType, 'breeder_extra_yield', art.gemCrafted)
      }
    }
  }

  const result = computeBreedResult(
    { typeId: body.plant1TypeId, speed: body.plant1Speed, yield: body.plant1Yield },
    { typeId: body.plant2TypeId, speed: body.plant2Speed, yield: body.plant2Yield },
    { mutationBoost, extraYield },
  )

  await db.transaction(async (tx) => {
    // Claiming the idle slot is the mutex — the plants are only consumed by the
    // request that won it, and an insufficient stack rolls the claim back.
    const [claimed] = await tx.update(xenoBreederSlots)
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
      .where(and(
        eq(xenoBreederSlots.id, slot.id),
        eq(xenoBreederSlots.userId, userId),
        or(isNull(xenoBreederSlots.startedAt), eq(xenoBreederSlots.collected, true)),
      ))
      .returning({ id: xenoBreederSlots.id })
    if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Breeding already in progress' })

    await consumePlantsByStack(userId, body.plant1TypeId, body.plant1Speed, body.plant1Yield, 1, tx)
    await consumePlantsByStack(userId, body.plant2TypeId, body.plant2Speed, body.plant2Yield, 1, tx)
  })

  return { ok: true, wasMutation: result.wasMutation }
})
