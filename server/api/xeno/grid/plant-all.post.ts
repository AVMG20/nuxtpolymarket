import { eq, and, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoPlants, xenoArtifacts } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getPlant, getArtifact, isHybrid } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string; speed: number; yield: number }>(event)
  const userId = await requireUserId(event)

  if (!body.typeId) throw createError({ statusCode: 400, statusMessage: 'Provide typeId' })

  const hybrid = isHybrid(body.typeId)
  const plantType = hybrid ? null : getPlant(body.typeId)
  if (!hybrid && !plantType) throw createError({ statusCode: 400, statusMessage: `Unknown plant type: ${body.typeId}` })

  const planted = await db.transaction(async (tx) => {
    const allSlots = await tx.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) })
    const emptySlots = allSlots
      .filter(s => !s.startedAt)
      .sort((a, b) => a.slotIndex - b.slotIndex)
    if (!emptySlots.length) return []

    const allOfStack = await tx.query.xenoPlants.findMany({
      where: and(
        eq(xenoPlants.userId, userId),
        eq(xenoPlants.typeId, body.typeId),
        eq(xenoPlants.speed, body.speed),
        eq(xenoPlants.yield, body.yield),
      ),
    })
    const plantedIds = new Set(allSlots.map(s => s.plantId).filter(Boolean))
    const freePlants = allOfStack.filter(p => !plantedIds.has(p.id))
    if (!freePlants.length) return []

    const artifactIds = [...new Set(emptySlots.map(s => s.artifactId).filter(Boolean))] as string[]
    const artifacts = artifactIds.length
      ? await tx.query.xenoArtifacts.findMany({ where: inArray(xenoArtifacts.id, artifactIds) })
      : []
    const artifactById = new Map(artifacts.map(a => [a.id, a]))

    const plantedSlotIds: string[] = []
    let plantIdx = 0
    for (const slot of emptySlots) {
      if (plantIdx >= freePlants.length) break

      if (plantType?.voidPlant) {
        const artRecord = slot.artifactId ? artifactById.get(slot.artifactId) : null
        const artType = artRecord ? getArtifact(artRecord.typeId) : null
        if (!artType || artType.level < 2) continue
      }

      const freePlant = freePlants[plantIdx]!
      await tx.update(xenoGridSlots)
        .set({ plantId: freePlant.id, startedAt: new Date() })
        .where(eq(xenoGridSlots.id, slot.id))
      plantedSlotIds.push(slot.id)
      plantIdx++
    }
    return plantedSlotIds
  })

  return { ok: true, planted: planted.length }
})
