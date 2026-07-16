import { eq, and, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyState, colonyBugs, colonyUpgrades, colonyBugResearch, colonyLoot, colonyItems, user } from '#server/database/schema'
import { debit } from '#server/utils/balance'
import {
  getBug,
  effectiveTickMs,
  effectiveEatPerTick,
  socialSpeedBonusPct,
  avgTickYield,
  gemTickMs,
  effectiveGemsPerDay,
  deriveNutritionMax,
  deriveTrackModifiers,
  GEM_FEED_YIELD_BONUS,
  GEM_FEED_SPEED_BONUS_PCT,
  MAX_RESEARCH_LEVEL,
  researchCost,
  type ItemCost,
  type Price
} from '#shared/utils/colony'

/** Credit gems straight to the user's spendable balance — gems aren't a colony inventory item, they're the same currency the rest of the site uses (see server/api/miner/collect-gems.post.ts for the same pattern). */
async function creditGems(userId: string, quantity: number) {
  if (quantity <= 0) return
  await db.update(user).set({ gems: sql`${user.gems} + ${quantity}` }).where(eq(user.id, userId))
}

export async function getColonyState(userId: string) {
  return db.query.colonyState.findFirst({ where: eq(colonyState.userId, userId) })
}

export async function ensureColonyState(userId: string) {
  const existing = await getColonyState(userId)
  if (existing) return existing
  const [created] = await db.insert(colonyState).values({ userId }).returning()
  return created!
}

/** Every upgrade track's current level, keyed by trackId (0 if never started). */
export async function getUpgradeLevels(userId: string): Promise<Record<string, number>> {
  const rows = await db.query.colonyUpgrades.findMany({ where: eq(colonyUpgrades.userId, userId) })
  const levels: Record<string, number> = {}
  for (const row of rows) levels[row.trackId] = row.level
  return levels
}

/** Every species' current Research level, keyed by typeId (0 if never researched). */
export async function getResearchLevels(userId: string): Promise<Record<string, number>> {
  const rows = await db.query.colonyBugResearch.findMany({ where: eq(colonyBugResearch.userId, userId) })
  const levels: Record<string, number> = {}
  for (const row of rows) levels[row.typeId] = row.level
  return levels
}

/** A single species' current Research level (0 if never researched). */
export async function getResearchLevel(userId: string, typeId: string): Promise<number> {
  const row = await db.query.colonyBugResearch.findFirst({ where: and(eq(colonyBugResearch.userId, userId), eq(colonyBugResearch.typeId, typeId)) })
  return row?.level ?? 0
}

/**
 * Pay coins to advance a species' Research level by one — raising the roll
 * range every FUTURE purchase of that species uses. Existing owned bugs keep
 * whatever they already rolled. The cost is a multiple of the species' own
 * spawn cost (see researchCost). Throws 400 if already maxed or short on
 * coins (debit handles the balance check).
 */
export async function upgradeResearch(userId: string, typeId: string): Promise<{ level: number }> {
  const type = getBug(typeId)
  if (!type) throw createError({ statusCode: 400, statusMessage: `Unknown bug type: ${typeId}` })

  const currentLevel = await getResearchLevel(userId, typeId)
  const cost = researchCost(currentLevel, type.spawnCost)
  if (cost === null || currentLevel >= MAX_RESEARCH_LEVEL) {
    throw createError({ statusCode: 400, statusMessage: 'This species is already at max Research level' })
  }

  await debit(userId, cost.toFixed(4), 'colony')

  await db.insert(colonyBugResearch)
    .values({ userId, typeId, level: currentLevel + 1 })
    .onConflictDoUpdate({
      target: [colonyBugResearch.userId, colonyBugResearch.typeId],
      set: { level: currentLevel + 1 }
    })

  return { level: currentLevel + 1 }
}

/** Add `quantity` of an item straight to unclaimed loot (not yet in the player's spendable inventory). */
async function addLoot(userId: string, itemTypeId: string, quantity: number) {
  if (quantity <= 0) return
  await db.insert(colonyLoot)
    .values({ userId, itemTypeId, quantity })
    .onConflictDoUpdate({
      target: [colonyLoot.userId, colonyLoot.itemTypeId],
      set: { quantity: sql`${colonyLoot.quantity} + ${quantity}` }
    })
}

/**
 * Settle nutrition decay and per-bug production ticks for elapsed real time
 * since lastSettledAt. Called at the top of every colony endpoint so "how
 * much did my bugs forage while I was away" is always computed analytically
 * on read — no server-side interval/loop needed. Production is only ever
 * written into colonyLoot (unclaimed); the player must collect it manually
 * via the loot chest. Nutrition drain is the sum of every placed bug's feed
 * rate, so a bigger or rarer colony needs feeding more often — and once the
 * tank hits 0 all foraging stops until the player comes back to feed.
 *
 * Runs in up to two phases because of gem-fed nutrition: it always drains
 * FIRST and grants a colony-wide +1 yield / +20% speed buff while any is
 * left, so a settle window that starts buffed and runs the gem pool dry
 * partway through needs to split cleanly into a buffed phase (draining
 * gemNutrition, boosted rates) followed by a normal phase (draining regular
 * nutrition, base rates) rather than applying one rate to the whole window.
 */
export async function settleColony(userId: string) {
  const state = await ensureColonyState(userId)
  const now = Date.now()
  const elapsedMs = now - state.lastSettledAt.getTime()
  if (elapsedMs <= 0) return state

  const [allBugs, levels] = await Promise.all([
    db.query.colonyBugs.findMany({ where: eq(colonyBugs.userId, userId) }),
    getUpgradeLevels(userId)
  ])
  // only bugs placed in the terrarium forage and eat — inventory bugs are dormant
  const bugs = allBugs.filter(b => b.inTerrarium)

  const mods = deriveTrackModifiers(levels)
  const nutritionMax = deriveNutritionMax(levels)

  // Same-species-in-terrarium counts drive the Social trait's speed bonus/
  // penalty (see socialSpeedBonusPct) — needed up front since it affects
  // both eating (feed ties to completed ticks) and production below.
  const sameSpeciesCounts = new Map<string, number>()
  for (const bug of bugs) sameSpeciesCounts.set(bug.typeId, (sameSpeciesCounts.get(bug.typeId) ?? 0) + 1)

  const lootByItem = new Map<string, number>()
  const bugRemainders = new Map<string, number>(bugs.map(b => [b.id, b.tickProgressMs]))
  let gemsEarned = 0
  let totalActiveMs = 0

  /** Advance every placed bug's progress by `activeMs` of wall-clock time under a given buff state, accumulating loot/gems and updating bugRemainders in place. */
  function runPhase(activeMs: number, buffed: boolean) {
    if (activeMs <= 0) return
    totalActiveMs += activeMs
    for (const bug of bugs) {
      const type = getBug(bug.typeId)
      if (!type) continue
      const sameSpeciesCount = sameSpeciesCounts.get(bug.typeId) ?? 1

      // Gem-producing bugs run on a completely separate, fixed-scale cycle
      // TIME — never sped up by the bug's own roll, the Foraging Speed
      // track, a social bonus, or the gem-feed buff. Their per-cycle GEM
      // OUTPUT does scale with the Foraging Yield/Speed tracks though (not
      // the gem-feed buff), hard-capped at MAX_GEMS_PER_DAY. See
      // gemTickMs/effectiveGemsPerDay.
      const buffPct = buffed ? GEM_FEED_SPEED_BONUS_PCT : 0
      const tickMs = type.producesGems
        ? gemTickMs(bug, sameSpeciesCount)
        : effectiveTickMs(bug, mods.speedBonusPct + socialSpeedBonusPct(bug.typeId, sameSpeciesCount) + buffPct)
      if (!Number.isFinite(tickMs) || tickMs <= 0) continue

      const startProgress = bugRemainders.get(bug.id) ?? bug.tickProgressMs
      const totalProgress = startProgress + activeMs
      const ticks = Math.floor(totalProgress / tickMs)
      const remainder = totalProgress - ticks * tickMs
      bugRemainders.set(bug.id, Math.round(remainder))

      if (ticks > 0) {
        if (type.producesGems) {
          gemsEarned += effectiveGemsPerDay(bug, mods.yieldLevelBonus, mods.speedBonusPct) * ticks
        } else {
          // Each completed cycle actually rolls 1 + random(0..effectiveYield)
          // items (see rollTickYield) — for a bulk offline catch-up
          // spanning many ticks we settle on the expected value
          // (avgTickYield) rather than rolling every individual tick.
          // The gem-feed buff and the Foraging Yield track both raise the
          // effective yield LEVEL by a flat amount before that roll.
          const effectiveYield = bug.yield + mods.yieldLevelBonus + (buffed ? GEM_FEED_YIELD_BONUS : 0)
          const qty = Math.round(avgTickYield(effectiveYield) * ticks)
          lootByItem.set(type.itemId, (lootByItem.get(type.itemId) ?? 0) + qty)
        }
      }
    }
  }

  function phaseFoodCost(activeMs: number, buffed: boolean): number {
    if (activeMs <= 0) return 0
    let food = 0
    for (const bug of bugs) {
      const type = getBug(bug.typeId)
      if (!type) continue
      const sameSpeciesCount = sameSpeciesCounts.get(bug.typeId) ?? 1
      const buffPct = buffed ? GEM_FEED_SPEED_BONUS_PCT : 0
      const tickMs = type.producesGems
        ? gemTickMs(bug, sameSpeciesCount)
        : effectiveTickMs(bug, mods.speedBonusPct + socialSpeedBonusPct(bug.typeId, sameSpeciesCount) + buffPct)
      if (!Number.isFinite(tickMs) || tickMs <= 0) continue
      const startProgress = bugRemainders.get(bug.id) ?? bug.tickProgressMs
      const ticks = Math.floor((startProgress + activeMs) / tickMs)
      food += ticks * effectiveEatPerTick(bug, mods.feedMultiplier)
    }
    return food
  }

  /** Largest whole millisecond interval whose completed cycles can all be fed. */
  function affordablePhaseMs(maxMs: number, buffed: boolean, foodAvailable: number): number {
    if (maxMs <= 0 || foodAvailable <= 0) return 0
    if (phaseFoodCost(maxMs, buffed) <= foodAvailable) return maxMs
    let low = 0
    let high = Math.floor(maxMs)
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (phaseFoodCost(mid, buffed) <= foodAvailable) low = mid
      else high = mid - 1
    }
    return low
  }

  function nextCycleMs(buffed: boolean): number {
    return Math.min(...bugs.map((bug) => {
      const type = getBug(bug.typeId)
      if (!type) return Infinity
      const sameSpeciesCount = sameSpeciesCounts.get(bug.typeId) ?? 1
      const buffPct = buffed ? GEM_FEED_SPEED_BONUS_PCT : 0
      const tickMs = type.producesGems
        ? gemTickMs(bug, sameSpeciesCount)
        : effectiveTickMs(bug, mods.speedBonusPct + socialSpeedBonusPct(bug.typeId, sameSpeciesCount) + buffPct)
      const progress = bugRemainders.get(bug.id) ?? bug.tickProgressMs
      return Number.isFinite(tickMs) ? Math.max(1, tickMs - progress) : Infinity
    }))
  }

  let remainingMs = elapsedMs
  let newGemNutrition = state.gemNutrition
  let newNutrition = state.nutrition

  // Phase 1 — gem-fed nutrition, buffed rates. Drains first, always.
  if (newGemNutrition > 0 && remainingMs > 0) {
    const phaseMs = affordablePhaseMs(remainingMs, true, newGemNutrition)
    if (phaseMs > 0) {
      const foodSpent = phaseFoodCost(phaseMs, true)
      runPhase(phaseMs, true)
      newGemNutrition -= foodSpent
      remainingMs -= phaseMs
    }

    // A cycle may spend the premium remainder and draw the rest of its meal
    // from regular nutrition. It stays buffed because premium food was active
    // when that cycle completed.
    const boundaryMs = nextCycleMs(true)
    if (remainingMs > 0 && newGemNutrition > 0 && boundaryMs <= remainingMs) {
      const boundaryCost = phaseFoodCost(boundaryMs, true)
      if (boundaryCost <= newGemNutrition + newNutrition) {
        runPhase(boundaryMs, true)
        const premiumSpent = Math.min(newGemNutrition, boundaryCost)
        newGemNutrition -= premiumSpent
        newNutrition -= boundaryCost - premiumSpent
        remainingMs -= boundaryMs
      }
    }
  }

  // Phase 2 — regular nutrition, base rates, for whatever time is left.
  if (remainingMs > 0 && newGemNutrition <= 0 && newNutrition > 0) {
    const phaseMs = affordablePhaseMs(remainingMs, false, newNutrition)
    if (phaseMs > 0) {
      const foodSpent = phaseFoodCost(phaseMs, false)
      runPhase(phaseMs, false)
      newNutrition -= foodSpent
    }
  }

  if (totalActiveMs > 0) {
    const bugUpdates = bugs.map(bug =>
      db.update(colonyBugs).set({ tickProgressMs: bugRemainders.get(bug.id) ?? bug.tickProgressMs }).where(eq(colonyBugs.id, bug.id))
    )
    await Promise.all(bugUpdates)
    for (const [itemTypeId, qty] of lootByItem) {
      await addLoot(userId, itemTypeId, qty)
    }
    if (gemsEarned > 0) await creditGems(userId, Math.floor(gemsEarned))
  }

  const [updated] = await db.update(colonyState)
    .set({
      nutrition: Math.round(Math.min(nutritionMax, newNutrition)),
      gemNutrition: Math.round(Math.max(0, newGemNutrition)),
      lastSettledAt: new Date(now)
    })
    .where(eq(colonyState.userId, userId))
    .returning()

  return updated!
}

/** Insert one bug instance. Defaults to the player's inventory (unplaced); pass inTerrarium to place it directly. */
export async function addBug(userId: string, typeId: string, speed: number, yield_: number, eat: number, inTerrarium = false) {
  const [bug] = await db.insert(colonyBugs).values({ userId, typeId, speed, yield: yield_, eat, inTerrarium }).returning()
  return bug!
}

/** Count of bugs of a given species currently placed in the terrarium (includes the bug itself, if placed). */
async function countSameSpeciesPlaced(userId: string, typeId: string): Promise<number> {
  const rows = await db.query.colonyBugs.findMany({
    where: and(eq(colonyBugs.userId, userId), eq(colonyBugs.typeId, typeId), eq(colonyBugs.inTerrarium, true))
  })
  return rows.length
}

/**
 * Credit partial progress toward a bug's current, unfinished tick as loot —
 * called right before a placed bug is deleted (release/remove) so stopping
 * it mid-cycle doesn't just throw away the progress it already made. Prorated
 * by how far through the cycle it got: 55s into a 60s cycle that drops 10
 * items credits ~9. No-op for bugs that were never placed (dormant bugs
 * never accumulate tick progress) or that just started a fresh cycle.
 * Caller must run settleColony() first so tickProgressMs is up to date, and
 * must call this before deleting the bug row.
 */
export async function creditPartialTick(userId: string, bug: { typeId: string, yield: number, speed: number, tickProgressMs: number, inTerrarium: boolean }) {
  if (!bug.inTerrarium) return
  const type = getBug(bug.typeId)
  if (!type) return

  const levels = await getUpgradeLevels(userId)
  const mods = deriveTrackModifiers(levels)
  const sameSpeciesCount = await countSameSpeciesPlaced(userId, bug.typeId)
  const tickMs = type.producesGems
    ? gemTickMs(bug, sameSpeciesCount)
    : effectiveTickMs(bug, mods.speedBonusPct + socialSpeedBonusPct(bug.typeId, sameSpeciesCount))
  if (!Number.isFinite(tickMs) || tickMs <= 0) return

  const fraction = Math.min(1, bug.tickProgressMs / tickMs)
  if (fraction <= 0) return

  if (type.producesGems) {
    await creditGems(userId, Math.floor(effectiveGemsPerDay(bug, mods.yieldLevelBonus, mods.speedBonusPct) * fraction))
  } else {
    const qty = Math.round(avgTickYield(bug.yield + mods.yieldLevelBonus) * fraction)
    await addLoot(userId, type.itemId, qty)
  }
}

/** Count of bugs currently placed in the terrarium. */
export async function countPlacedBugs(userId: string): Promise<number> {
  const rows = await db.query.colonyBugs.findMany({ where: and(eq(colonyBugs.userId, userId), eq(colonyBugs.inTerrarium, true)) })
  return rows.length
}

/** Add `quantity` of an item directly to the player's claimed, spendable inventory. */
export async function creditItems(userId: string, itemTypeId: string, quantity: number) {
  if (quantity <= 0) return
  await db.insert(colonyItems)
    .values({ userId, itemTypeId, quantity })
    .onConflictDoUpdate({
      target: [colonyItems.userId, colonyItems.itemTypeId],
      set: { quantity: sql`${colonyItems.quantity} + ${quantity}` }
    })
}

/** Whether the user's claimed item inventory covers every line of a cost. */
export async function hasItems(userId: string, items: ItemCost[]): Promise<boolean> {
  if (items.length === 0) return true
  const owned = await db.query.colonyItems.findMany({ where: eq(colonyItems.userId, userId) })
  const ownedMap = new Map(owned.map(o => [o.itemTypeId, o.quantity]))
  return items.every(need => (ownedMap.get(need.itemTypeId) ?? 0) >= need.quantity)
}

/** Deduct item quantities from the claimed inventory. Throws 400 if anything is short. */
export async function consumeItems(userId: string, items: ItemCost[]) {
  for (const need of items) {
    const res = await db.update(colonyItems)
      .set({ quantity: sql`${colonyItems.quantity} - ${need.quantity}` })
      .where(and(
        eq(colonyItems.userId, userId),
        eq(colonyItems.itemTypeId, need.itemTypeId),
        sql`${colonyItems.quantity} >= ${need.quantity}`
      ))
      .returning({ id: colonyItems.id })
    if (res.length === 0) {
      throw createError({ statusCode: 400, statusMessage: `Not enough ${need.itemTypeId} (need ${need.quantity})` })
    }
  }
}

/** Pay a {coins, items} price: checks + deducts items first, then debits coins. Throws 400 if short on either. */
export async function payPrice(userId: string, price: Price) {
  if (!(await hasItems(userId, price.items))) {
    throw createError({ statusCode: 400, statusMessage: 'Not enough items for this upgrade' })
  }
  if (price.items.length > 0) await consumeItems(userId, price.items)
  if (price.coins > 0) await debit(userId, price.coins.toFixed(4), 'colony')
}
