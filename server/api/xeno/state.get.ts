import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoPlants, xenoPlantsUnlocked, xenoArtifacts, xenoGridSlots, xenoBreederSlots } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { computeGridDuration, computeBreedDuration, getXenoUpgradeLevels } from '#server/utils/xeno'
import {
  getPlant, getPlantDisplay, isHybrid, hybridGemCost,
  hybridTierFromUnlocked, tierUnlockProgress, HYBRID_UNLOCK_TIER, XENO_MAX_TIER,
  gridSlotUnlockCost, breederSlotUnlockCost, XENO_MAX_GRID_SLOTS, XENO_MAX_BREEDER_SLOTS,
} from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const [plants, artifacts, gridSlots, breederSlots, unlockedRows, upgrades] = await Promise.all([
    db.query.xenoPlants.findMany({ where: eq(xenoPlants.userId, userId) }),
    db.query.xenoArtifacts.findMany({ where: eq(xenoArtifacts.userId, userId) }),
    db.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) }),
    db.query.xenoBreederSlots.findMany({ where: eq(xenoBreederSlots.userId, userId) }),
    db.query.xenoPlantsUnlocked.findMany({ where: eq(xenoPlantsUnlocked.userId, userId) }),
    getXenoUpgradeLevels(userId),
  ])

  // Permanent unlock set — drives the market, encyclopedia and hybrid vendor so
  // selling/breeding away every instance never re-locks a discovered plant.
  const unlockedTypeIds = [...new Set(unlockedRows.map(r => r.typeId))]

  const initialized = gridSlots.length > 0

  const attachedArtifactIds = new Set([
    ...gridSlots.map(s => s.artifactId).filter(Boolean),
    ...breederSlots.map(s => s.artifactId).filter(Boolean),
  ])
  const freeArtifacts = artifacts.filter(a => !attachedArtifactIds.has(a.id))

  const plantedIds = new Set(gridSlots.map(s => s.plantId).filter(Boolean))
  const freePlants = plants.filter(p => !plantedIds.has(p.id))

  const grouped = new Map<string, { typeId: string; speed: number; yield: number; quantity: number }>()
  for (const p of freePlants) {
    const key = `${p.typeId}:${p.speed}:${p.yield}`
    const entry = grouped.get(key)
    if (entry) { entry.quantity++ } else { grouped.set(key, { typeId: p.typeId, speed: p.speed, yield: p.yield, quantity: 1 }) }
  }
  const inventory = Array.from(grouped.values())

  const artifactById = new Map(artifacts.map(a => [a.id, a]))
  const plantById = new Map(plants.map(p => [p.id, p]))

  const enrichedGrid = gridSlots.sort((a, b) => a.slotIndex - b.slotIndex).map(slot => {
    const attachedArt = slot.artifactId ? artifactById.get(slot.artifactId) : null
    const plantInstance = slot.plantId ? plantById.get(slot.plantId) : null
    const plantType = plantInstance ? getPlantDisplay(plantInstance.typeId) : null

    let plant = null
    if (plantInstance && plantType && slot.startedAt) {
      const durationSecs = computeGridDuration(
        { typeId: plantInstance.typeId, speed: plantInstance.speed },
        attachedArt?.typeId ?? null,
        attachedArt?.gemCrafted ?? false,
        upgrades.speed,
      )
      plant = {
        id: plantInstance.id,
        typeId: plantInstance.typeId,
        speed: plantInstance.speed,
        yield: plantInstance.yield,
        name: plantType.name,
        emoji: plantType.emoji,
        tier: plantType.tier,
        color: plantType.color,
        value: plantType.value,
        isHybrid: plantType.isHybrid,
        resources: plantType.resources,
        startedAt: slot.startedAt.toISOString(),
        completesAt: new Date(slot.startedAt.getTime() + durationSecs * 1000).toISOString(),
      }
    }

    return {
      id: slot.id,
      slotIndex: slot.slotIndex,
      plant,
      artifact: attachedArt
        ? { id: attachedArt.id, typeId: attachedArt.typeId, chargesRemaining: attachedArt.chargesRemaining, gemCrafted: attachedArt.gemCrafted }
        : null,
    }
  })

  const enrichedBreeders = breederSlots.sort((a, b) => a.slotIndex - b.slotIndex).map(slot => {
    const attachedArt = slot.artifactId ? artifactById.get(slot.artifactId) : null

    let completesAt: string | null = null
    if (slot.startedAt && slot.plant1TypeId && slot.plant1Speed != null && slot.plant2TypeId && slot.plant2Speed != null) {
      const durationSecs = computeBreedDuration(
        { typeId: slot.plant1TypeId, speed: slot.plant1Speed },
        { typeId: slot.plant2TypeId, speed: slot.plant2Speed },
        attachedArt?.typeId ?? null,
        attachedArt?.gemCrafted ?? false,
        upgrades.speed,
      )
      completesAt = new Date(slot.startedAt.getTime() + durationSecs * 1000).toISOString()
    }

    return {
      id: slot.id,
      slotIndex: slot.slotIndex,
      parent1: slot.plant1TypeId ? { typeId: slot.plant1TypeId, speed: slot.plant1Speed, yield: slot.plant1Yield } : null,
      parent2: slot.plant2TypeId ? { typeId: slot.plant2TypeId, speed: slot.plant2Speed, yield: slot.plant2Yield } : null,
      startedAt: slot.startedAt?.toISOString() ?? null,
      completesAt,
      artifact: attachedArt
        ? { id: attachedArt.id, typeId: attachedArt.typeId, chargesRemaining: attachedArt.chargesRemaining, gemCrafted: attachedArt.gemCrafted }
        : null,
      resultTypeId: slot.resultTypeId ?? null,
      resultSpeed: slot.resultSpeed ?? null,
      resultYield: slot.resultYield ?? null,
      resultQuantity: slot.resultQuantity ?? null,
      wasMutation: slot.wasMutation ?? null,
      collected: slot.collected,
    }
  })

  // ── Hybrid vendor ──────────────────────────────────────────────────────────
  // Hybrid tier = highest tier where the player has unlocked EVERY plant.
  const realTypeIds = unlockedTypeIds.filter(id => !isHybrid(id))
  const highestTier = realTypeIds.reduce((max, id) => Math.max(max, getPlant(id)?.tier ?? 0), 0)
  const hybridTier = hybridTierFromUnlocked(realTypeIds)
  const hybridUnlocked = hybridTier >= HYBRID_UNLOCK_TIER
  const hybridCostGems = hybridUnlocked ? hybridGemCost(hybridTier) : 0
  // Next tier to fully unlock: the gate tier when locked, or the tier above the
  // current hybrid tier when unlocked (null once maxed out).
  const nextTier = hybridUnlocked
    ? (hybridTier < XENO_MAX_TIER ? hybridTier + 1 : null)
    : HYBRID_UNLOCK_TIER
  const nextTierProgress = nextTier != null ? tierUnlockProgress(nextTier, realTypeIds) : null

  return {
    initialized,
    inventory,
    highestTier,
    upgrades,
    hybrids: {
      unlocked: hybridUnlocked,
      unlockTier: HYBRID_UNLOCK_TIER,
      tier: hybridTier,
      costGems: hybridCostGems,
      nextTier,
      nextTierProgress,
    },
    unlockedTypeIds,
    freeArtifacts: freeArtifacts.map(a => ({
      id: a.id, typeId: a.typeId, chargesRemaining: a.chargesRemaining, gemCrafted: a.gemCrafted,
    })),
    grid: {
      slots: enrichedGrid,
      unlockedCount: gridSlots.length,
      nextSlotIndex: gridSlots.length,
      nextSlotCost: gridSlotUnlockCost(gridSlots.length),
      maxSlots: XENO_MAX_GRID_SLOTS,
    },
    breeder: {
      slots: enrichedBreeders,
      unlockedCount: breederSlots.length,
      nextSlotIndex: breederSlots.length,
      nextSlotCost: breederSlotUnlockCost(breederSlots.length),
      maxSlots: XENO_MAX_BREEDER_SLOTS,
    },
  }
})
