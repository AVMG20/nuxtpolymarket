import { eq, and, isNull, notExists } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoPlants, xenoArtifacts } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { lockUserGrid } from '#server/utils/xeno'
import { getPlant, getArtifact, isHybrid } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string; typeId: string; speed: number; yield: number }>(event)
  const userId = await requireUserId(event)

  if (!body.typeId) throw createError({ statusCode: 400, statusMessage: 'Provide typeId' })

  const hybrid = isHybrid(body.typeId)
  const plantType = hybrid ? null : getPlant(body.typeId)
  if (!hybrid && !plantType) throw createError({ statusCode: 400, statusMessage: `Unknown plant type: ${body.typeId}` })

  const slot = await db.query.xenoGridSlots.findFirst({
    where: and(eq(xenoGridSlots.id, body.slotId), eq(xenoGridSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  // plantId is the source of truth for "occupied". A slot whose plant row was
  // deleted (FK ON DELETE SET NULL) may still carry a stale startedAt; it is
  // empty and can be replanted.
  if (slot.plantId) throw createError({ statusCode: 400, statusMessage: 'Slot already has a plant' })

  if (plantType?.voidPlant) {
    const artRecord = slot.artifactId
      ? await db.query.xenoArtifacts.findFirst({ where: eq(xenoArtifacts.id, slot.artifactId) })
      : null
    const artType = artRecord ? getArtifact(artRecord.typeId) : null
    if (!artType || artType.level < 2) {
      throw createError({ statusCode: 400, statusMessage: 'Void plants require a tier II or higher artifact in this slot.' })
    }
  }

  await db.transaction(async (tx) => {
    // Serialise against other plant / sell / craft / breed requests for this
    // user — see lockUserGrid. Without it, N concurrent plant requests (Harvest
    // All with auto-replant) all read the same free list and put one plant row
    // in N slots.
    await lockUserGrid(userId, tx)
    const [freePlant] = await tx.select({ id: xenoPlants.id })
      .from(xenoPlants)
      .where(and(
        eq(xenoPlants.userId, userId),
        eq(xenoPlants.typeId, body.typeId),
        eq(xenoPlants.speed, body.speed),
        eq(xenoPlants.yield, body.yield),
        notExists(tx.select({ id: xenoGridSlots.id }).from(xenoGridSlots).where(eq(xenoGridSlots.plantId, xenoPlants.id))),
      ))
      .limit(1)
    if (!freePlant) throw createError({ statusCode: 400, statusMessage: 'No free plant of that type available' })

    // The empty-slot check lives in the WHERE so two concurrent plants on the same
    // slot can't both "win" and orphan one of the instances.
    const [planted] = await tx.update(xenoGridSlots)
      .set({ plantId: freePlant.id, startedAt: new Date() })
      .where(and(eq(xenoGridSlots.id, slot.id), isNull(xenoGridSlots.plantId)))
      .returning({ id: xenoGridSlots.id })
    if (!planted) throw createError({ statusCode: 400, statusMessage: 'Slot already has a plant' })
  })

  return { ok: true }
})
