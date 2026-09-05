import { eq, and, inArray, notExists, sql } from 'drizzle-orm'
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

/** Create plant instances in inventory. Pass `tx` when called inside a transaction. */
export async function addPlants(
  userId: string,
  typeId: string,
  speed: number,
  yield_: number,
  quantity: number,
  tx: DbExecutor = db,
) {
  if (quantity < 1) return
  await tx.insert(xenoPlants).values(
    Array.from({ length: quantity }, () => ({ userId, typeId, speed, yield: yield_ })),
  )
  // This table has no compound unique constraint, so onConflictDoNothing()
  // would only handle duplicate row IDs. Check the permanent unlock first to
  // keep repeated harvests or purchases from creating duplicate unlock rows.
  const existingUnlock = await tx.query.xenoPlantsUnlocked.findFirst({
    where: and(eq(xenoPlantsUnlocked.userId, userId), eq(xenoPlantsUnlocked.typeId, typeId))
  })
  if (!existingUnlock) await tx.insert(xenoPlantsUnlocked).values({ userId, typeId })
}

/**
 * Serialise every operation that claims or consumes a user's plant instances.
 *
 * Planting picks a free `xenoPlants` row and points a grid slot at it; selling,
 * crafting and breeding delete free rows. Both decide "free" by reading the
 * grid, and under READ COMMITTED two concurrent requests read the same
 * pre-state — so Harvest All with auto-replant planted one row in three slots,
 * and harvesting one of them deleted the row under the other two (FK SET NULL),
 * leaving phantom plots. A `FOR UPDATE` lock on the plant row alone does not
 * close that: Postgres only re-evaluates the WHERE for rows the lock holder
 * *changed*, and a claim changes the slot, not the plant.
 *
 * So take the user's grid slot rows `FOR UPDATE` first, then read. Every read
 * after this statement runs on a fresh snapshot that includes whatever the
 * previous holder committed. Call inside a transaction and pass the same `tx`
 * to every subsequent read and write.
 */
export async function lockUserGrid(userId: string, tx: DbExecutor) {
  await tx.select({ id: xenoGridSlots.id })
    .from(xenoGridSlots)
    .where(eq(xenoGridSlots.userId, userId))
    .orderBy(xenoGridSlots.slotIndex)
    .for('update')
}

/**
 * `xenoPlants` row is not referenced by any grid slot. Put this in the WHERE of
 * every DELETE that consumes inventory: the free-list read above it can go
 * stale when a plant request lands in between, and deleting a planted row
 * fires the FK's ON DELETE SET NULL — leaving a slot with `startedAt` set,
 * `plantId` null and no plant to show, harvest or remove.
 */
function notPlanted(tx: DbExecutor) {
  return notExists(tx.select({ id: xenoGridSlots.id }).from(xenoGridSlots).where(eq(xenoGridSlots.plantId, xenoPlants.id)))
}

/**
 * Find and delete `quantity` free plant instances matching typeId (any speed/yield).
 * Used for artifact crafting costs where quality doesn't matter.
 * Throws 400 if insufficient.
 */
export async function consumePlantsByType(userId: string, typeId: string, quantity: number, tx: DbExecutor = db) {
  await lockUserGrid(userId, tx)
  // Get plants not currently planted in a grid slot
  const allOfType = await tx.query.xenoPlants.findMany({
    where: and(eq(xenoPlants.userId, userId), eq(xenoPlants.typeId, typeId)),
  })
  // Exclude ones currently in a grid slot
  const gridPlantIds = new Set(
    (await tx.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) }))
      .map(s => s.plantId)
      .filter(Boolean),
  )
  const free = allOfType.filter(p => !gridPlantIds.has(p.id))
  if (free.length < quantity) {
    throw createError({ statusCode: 400, statusMessage: `Not enough ${typeId} plants (need ${quantity}, have ${free.length})` })
  }
  // One DELETE ... RETURNING is the mutex (same as consumePlantsByStack): a
  // concurrent craft claiming the same rows deletes fewer than asked and throws
  // instead of spending a plant twice. Also ~50x fewer round trips than the
  // old per-row loop for a 50× craft.
  const deleted = await tx.delete(xenoPlants)
    .where(and(
      eq(xenoPlants.userId, userId),
      inArray(xenoPlants.id, free.slice(0, quantity).map(p => p.id)),
      notPlanted(tx),
    ))
    .returning({ id: xenoPlants.id })
  if (deleted.length < quantity) {
    throw createError({ statusCode: 400, statusMessage: `Not enough ${typeId} plants (need ${quantity}, have ${deleted.length})` })
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
  await lockUserGrid(userId, tx)
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
      notPlanted(tx),
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
  tx: DbExecutor = db,
) {
  // The decrement happens in the UPDATE itself rather than read → write, so two
  // harvests racing on the same artifact can't both compute the same "remaining".
  const [art] = await tx.update(xenoArtifacts)
    .set({ chargesRemaining: sql`${xenoArtifacts.chargesRemaining} - 1` })
    .where(eq(xenoArtifacts.id, artifactId))
    .returning({ chargesRemaining: xenoArtifacts.chargesRemaining })
  if (!art) return
  if (art.chargesRemaining <= 0) {
    // The FK is ON DELETE SET NULL, so removing the artifact also clears the
    // slot reference — the explicit update just keeps intent obvious.
    await tx.delete(xenoArtifacts).where(eq(xenoArtifacts.id, artifactId))
    if (slotType === 'grid') {
      await tx.update(xenoGridSlots).set({ artifactId: null }).where(eq(xenoGridSlots.id, slotId))
    } else {
      await tx.update(xenoBreederSlots).set({ artifactId: null }).where(eq(xenoBreederSlots.id, slotId))
    }
  }
}
