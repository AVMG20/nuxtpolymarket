import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoPlants, xenoArtifacts } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { addPlants, computeGridDuration, consumeArtifactCharge } from '#server/utils/xeno'
import {
  getArtifact, getEffectValueFor, rollYield,
  isHybrid, parseHybridResources, getPlant, getPlantDisplay,
} from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string }>(event)
  const userId = await requireUserId(event)

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
    attachedArt?.gemCrafted ?? false,
  )
  const completesAt = new Date(slot.startedAt.getTime() + durationSecs * 1000)
  if (Date.now() < completesAt.getTime()) throw createError({ statusCode: 400, statusMessage: 'Plant is still growing' })

  const display = getPlantDisplay(plantInstance.typeId)
  if (!display) throw createError({ statusCode: 400, statusMessage: 'Unknown plant type' })

  let artifactYieldBonus = 0
  if (attachedArt) {
    const artType = getArtifact(attachedArt.typeId)
    if (artType) artifactYieldBonus = getEffectValueFor(artType, 'grid_yield_bonus', attachedArt.gemCrafted)
  }

  // Consume the planted instance, then produce the harvest.
  await db.delete(xenoPlants).where(eq(xenoPlants.id, plantInstance.id))

  const drops: { id: string; emoji: string; name: string; count: number; isHybrid?: boolean }[] = []
  let harvested: number
  if (isHybrid(plantInstance.typeId)) {
    // A hybrid produces every resource at its OWN speed/yield, each in
    // rollYield(resourceYield) quantity, then regrows itself to match the
    // SINGLE BIGGEST resource harvest (not the sum) so the farm scales steadily.
    harvested = 0
    let regrow = 0
    for (const r of parseHybridResources(plantInstance.typeId)) {
      const base = getPlant(r.id)
      if (!base) continue
      const qty = rollYield(r.yield) + artifactYieldBonus
      await addPlants(userId, base.id, r.speed, r.yield, qty)
      drops.push({ id: base.id, emoji: base.emoji, name: base.name, count: qty })
      harvested += qty
      if (qty > regrow) regrow = qty
    }
    // Regrow the hybrid (same composition/stats) to match the largest resource yield.
    await addPlants(userId, plantInstance.typeId, plantInstance.speed, plantInstance.yield, regrow)
    drops.push({ id: plantInstance.typeId, emoji: '🧬', name: 'Hybrid', count: regrow, isHybrid: true })
  } else {
    harvested = rollYield(plantInstance.yield) + artifactYieldBonus
    await addPlants(userId, plantInstance.typeId, plantInstance.speed, plantInstance.yield, harvested)
    drops.push({ id: plantInstance.typeId, emoji: display.emoji, name: display.name, count: harvested })
  }

  if (slot.artifactId) await consumeArtifactCharge(slot.artifactId, 'grid', slot.id)

  await db.update(xenoGridSlots)
    .set({ plantId: null, startedAt: null })
    .where(eq(xenoGridSlots.id, slot.id))

  return { harvested, plantName: display.name, drops }
})
