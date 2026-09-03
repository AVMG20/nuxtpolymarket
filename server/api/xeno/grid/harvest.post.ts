import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoPlants, xenoArtifacts } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { addPlants, computeGridDuration, consumeArtifactCharge, getXenoUpgradeLevels } from '#server/utils/xeno'
import {
  getArtifact, getEffectValueFor, rollYield,
  isHybrid, parseHybridResources, getPlant, getPlantDisplay,
  xenoYieldBonus,
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
  const upgrades = await getXenoUpgradeLevels(userId)

  const durationSecs = computeGridDuration(
    { typeId: plantInstance.typeId, speed: plantInstance.speed },
    attachedArt?.typeId ?? null,
    attachedArt?.gemCrafted ?? false,
    upgrades.speed,
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

  return db.transaction(async (tx) => {
    // Deleting the planted instance is the claim: two harvests racing on the
    // same slot both read the plant above, but only one DELETE returns a row,
    // so only one of them rolls and credits the harvest.
    const [claimed] = await tx.delete(xenoPlants)
      .where(and(eq(xenoPlants.id, plantInstance.id), eq(xenoPlants.userId, userId)))
      .returning({ id: xenoPlants.id })
    if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Already harvested' })

    const drops: { id: string; emoji: string; name: string; count: number; isHybrid?: boolean }[] = []
    let harvested: number
    if (isHybrid(plantInstance.typeId)) {
      // A hybrid produces every resource at its OWN speed/yield, each in
      // rollYield(resourceYield) quantity, then regrows itself to match the
      // SINGLE BIGGEST resource harvest (not the sum) so the farm scales steadily.
      //
      // The flat bonuses (grid artifact + global yield upgrade) are added ONCE,
      // to the largest resource only — they are a bonus per HARVEST, not per
      // resource. Adding them inside the loop paid a 4-resource hybrid four
      // times the bonus a normal plant gets, and then regrew the vessel off that
      // inflated number too.
      const flatBonus = artifactYieldBonus + xenoYieldBonus(upgrades.yield)
      const rolled = parseHybridResources(plantInstance.typeId)
        .flatMap((r) => {
          const base = getPlant(r.id)
          return base ? [{ r, base, qty: rollYield(r.yield) }] : []
        })
      let bonusIndex = 0
      for (let i = 1; i < rolled.length; i++) {
        if (rolled[i]!.qty > rolled[bonusIndex]!.qty) bonusIndex = i
      }
      if (rolled.length) rolled[bonusIndex]!.qty += flatBonus

      harvested = 0
      let regrow = 0
      for (const { r, base, qty } of rolled) {
        await addPlants(userId, base.id, r.speed, r.yield, qty, tx)
        drops.push({ id: base.id, emoji: base.emoji, name: base.name, count: qty })
        harvested += qty
        if (qty > regrow) regrow = qty
      }
      // Regrow the hybrid (same composition/stats) to match the largest resource yield.
      await addPlants(userId, plantInstance.typeId, plantInstance.speed, plantInstance.yield, regrow, tx)
      drops.push({ id: plantInstance.typeId, emoji: '🧬', name: 'Hybrid', count: regrow, isHybrid: true })
    } else {
      harvested = rollYield(plantInstance.yield) + artifactYieldBonus + xenoYieldBonus(upgrades.yield)
      await addPlants(userId, plantInstance.typeId, plantInstance.speed, plantInstance.yield, harvested, tx)
      drops.push({ id: plantInstance.typeId, emoji: display.emoji, name: display.name, count: harvested })
    }

    if (slot.artifactId) await consumeArtifactCharge(slot.artifactId, 'grid', slot.id, tx)

    await tx.update(xenoGridSlots)
      .set({ plantId: null, startedAt: null })
      .where(eq(xenoGridSlots.id, slot.id))

    return { harvested, plantName: display.name, drops }
  })
})
