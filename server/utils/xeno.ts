import { eq, and, inArray } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { xenoPlants, xenoPlantsUnlocked, xenoArtifacts, xenoGridSlots, xenoBreederSlots, xenoUpgrades } from '#server/database/schema'
import { randomChance } from '#shared/utils/random'
import {
  getArtifact, getEffectValueFor, getPlant, getPlantDisplay,
  effectiveGrowTime, breedDuration, getMutationPair,
  xenoSpeedBoost, type XenoUpgradeLevels,
} from '#shared/utils/xeno'

export async function getXenoUpgradeLevels(userId: string, tx: DbExecutor = db): Promise<XenoUpgradeLevels> {
  const row = await tx.query.xenoUpgrades.findFirst({ where: eq(xenoUpgrades.userId, userId) })
  return {
    mutation: row?.mutationLevel ?? 0,
    yield: row?.yieldLevel ?? 0,
    speed: row?.speedLevel ?? 0
  }
}

/** When DEV_MODE=true, all grow/breed durations are capped to 1 second for testing */
export function xenoDuration(rawSecs: number): number {
  return useRuntimeConfig().devMode ? 1 : rawSecs
}

/** Effective grow time for a plant instance including artifact speed boost and dev mode */
export function computeGridDuration(
  plant: { typeId: string; speed: number },
  artifactTypeId: string | null | undefined,
  gemCrafted = false,
  globalSpeedLevel = 0,
): number {
  const base = getPlantDisplay(plant.typeId)
  if (!base) throw createError({ statusCode: 400, statusMessage: `Unknown plant type: ${plant.typeId}` })
  let secs = effectiveGrowTime({ baseTime: base.baseTime, speed: plant.speed })
  if (artifactTypeId) {
    const art = getArtifact(artifactTypeId)
    if (art) {
      const speedBoost = getEffectValueFor(art, 'grid_speed_boost', gemCrafted)
      if (speedBoost > 0) secs = Math.round(secs * (1 - speedBoost))
    }
  }
  secs = Math.round(secs * (1 - xenoSpeedBoost(globalSpeedLevel)))
  return xenoDuration(secs)
}

/** Breed duration from stored parent stats, optionally reduced by a breeder speed artifact */
export function computeBreedDuration(
  p1: { typeId: string; speed: number },
  p2: { typeId: string; speed: number },
  artifactTypeId?: string | null,
  gemCrafted = false,
  globalSpeedLevel = 0,
): number {
  const t1 = getPlant(p1.typeId)
  const t2 = getPlant(p2.typeId)
  if (!t1 || !t2) return xenoDuration(3600)
  let secs = xenoDuration(breedDuration(
    { baseTime: t1.baseTime },
    { baseTime: t2.baseTime},
  ))
  if (artifactTypeId) {
    const art = getArtifact(artifactTypeId)
    if (art) {
      const speedBoost = getEffectValueFor(art, 'breeder_speed_boost', gemCrafted)
      if (speedBoost > 0) secs = Math.round(secs * (1 - speedBoost))
    }
  }
  secs = Math.round(secs * (1 - xenoSpeedBoost(globalSpeedLevel)))
  return secs
}

/**
 * Compute breed result. Parents are consumed before calling this.
 * Returns the typeId/speed/yield for the result plant instance(s).
 */
export function computeBreedResult(
  p1: { typeId: string; speed: number; yield: number },
  p2: { typeId: string; speed: number; yield: number },
  options: { mutationBoost: number; extraYield: number },
): {
  resultTypeId: string
  resultSpeed: number
  resultYield: number
  resultQuantity: number
  wasMutation: boolean
} {
  let resultTypeId: string
  let resultSpeed: number
  let resultYield: number
  let wasMutation = false

  // Check for mutation first — mutation produces the new plant at its base stats.
  const possibleMutations = getMutationPair(p1.typeId, p2.typeId)
  for (const mutation of possibleMutations) {
    const effectiveChance = Math.max(0, Math.min(1, mutation.chance + options.mutationBoost))
    if (randomChance(effectiveChance)) {
      const offspring = getPlant(mutation.offspring)!
      resultTypeId = mutation.offspring
      resultSpeed = offspring.speed
      resultYield = offspring.yield
      wasMutation = true
      break
    }
  }

  if (!wasMutation) {
    // No mutation: type, speed, and yield are each independently random from either parent.
    resultTypeId = randomChance(0.5) ? p1.typeId : p2.typeId
    resultSpeed = randomChance(0.5) ? p1.speed : p2.speed
    resultYield = randomChance(0.5) ? p1.yield : p2.yield
  }

  return {
    resultTypeId: resultTypeId!,
    resultSpeed: resultSpeed!,
    resultYield: resultYield!,
    resultQuantity: 1 + options.extraYield,
    wasMutation,
  }
}

/** Create plant instances in inventory */
export async function addPlants(
  userId: string,
  typeId: string,
  speed: number,
  yield_: number,
  quantity: number,
) {
  if (quantity < 1) return
  await db.insert(xenoPlants).values(
    Array.from({ length: quantity }, () => ({ userId, typeId, speed, yield: yield_ })),
  )
  // Permanently mark this plant type as unlocked for the user (idempotent).
  await db.insert(xenoPlantsUnlocked)
    .values({ userId, typeId })
    .onConflictDoNothing()
}

/**
 * Find and delete `quantity` free plant instances matching typeId (any speed/yield).
 * Used for artifact crafting costs where quality doesn't matter.
 * Throws 400 if insufficient.
 */
export async function consumePlantsByType(userId: string, typeId: string, quantity: number) {
  // Get plants not currently planted in a grid slot
  const allOfType = await db.query.xenoPlants.findMany({
    where: and(eq(xenoPlants.userId, userId), eq(xenoPlants.typeId, typeId)),
  })
  // Exclude ones currently in a grid slot
  const gridPlantIds = new Set(
    (await db.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) }))
      .map(s => s.plantId)
      .filter(Boolean),
  )
  const free = allOfType.filter(p => !gridPlantIds.has(p.id))
  if (free.length < quantity) {
    throw createError({ statusCode: 400, statusMessage: `Not enough ${typeId} plants (need ${quantity}, have ${free.length})` })
  }
  const toDelete = free.slice(0, quantity).map(p => p.id)
  for (const id of toDelete) {
    await db.delete(xenoPlants).where(eq(xenoPlants.id, id))
  }
}

/**
 * Find and delete `quantity` free plant instances matching typeId + speed + yield.
 * Used for selling/consuming a specific quality stack.
 * Throws 400 if insufficient.
 */
export async function consumePlantsByStack(
  userId: string,
  typeId: string,
  speed: number,
  yield_: number,
  quantity: number,
  tx: DbExecutor = db,
) {
  const allOfStack = await tx.query.xenoPlants.findMany({
    where: and(
      eq(xenoPlants.userId, userId),
      eq(xenoPlants.typeId, typeId),
      eq(xenoPlants.speed, speed),
      eq(xenoPlants.yield, yield_),
    ),
  })
  const gridPlantIds = new Set(
    (await tx.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) }))
      .map(s => s.plantId)
      .filter(Boolean),
  )
  const free = allOfStack.filter(p => !gridPlantIds.has(p.id))
  if (free.length < quantity) {
    throw createError({ statusCode: 400, statusMessage: `Not enough plants to consume (need ${quantity}, have ${free.length})` })
  }

  // The delete is the mutex: a concurrent claim on the same rows deletes fewer
  // than asked, so the loser throws instead of consuming a plant twice.
  const deleted = await tx.delete(xenoPlants)
    .where(and(
      eq(xenoPlants.userId, userId),
      inArray(xenoPlants.id, free.slice(0, quantity).map(p => p.id)),
    ))
    .returning({ id: xenoPlants.id })
  if (deleted.length < quantity) {
    throw createError({ statusCode: 400, statusMessage: `Not enough plants to consume (need ${quantity}, have ${deleted.length})` })
  }
}

/** Decrement artifact charge; delete artifact and clear slot reference if exhausted */
export async function consumeArtifactCharge(
  artifactId: string,
  slotType: 'grid' | 'breeder',
  slotId: string,
) {
  const art = await db.query.xenoArtifacts.findFirst({ where: eq(xenoArtifacts.id, artifactId) })
  if (!art) return
  const remaining = art.chargesRemaining - 1
  if (remaining <= 0) {
    await db.delete(xenoArtifacts).where(eq(xenoArtifacts.id, artifactId))
    if (slotType === 'grid') {
      await db.update(xenoGridSlots).set({ artifactId: null }).where(eq(xenoGridSlots.id, slotId))
    } else {
      await db.update(xenoBreederSlots).set({ artifactId: null }).where(eq(xenoBreederSlots.id, slotId))
    }
  } else {
    await db.update(xenoArtifacts).set({ chargesRemaining: remaining }).where(eq(xenoArtifacts.id, artifactId))
  }
}
