import { eq, and, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { colonyState, colonyBugs, colonyUpgrades, colonyBugResearch, colonyLoot, colonyItems } from '#server/database/schema'
import { creditGems, debit } from '#server/utils/balance'
import {
  getBug,
  getItem,
  BUG_TYPES,
  UPGRADE_TRACKS,
  effectiveTickMs,
  effectiveEatPerTick,
  effectiveFeedPerHour,
  socialMultiplier,
  socialSpeedBonusPct,
  avgTickYield,
  gemTickMs,
  effectiveGemsPerDay,
  deriveNutritionMax,
  deriveTrackModifiers,
  trackLevelCost,
  trackLevelDurationMs,
  habitatTrackRequirement,
  habitatLevelUpDurationMs,
  HABITAT_BUILDER_JOB_ID,
  GEM_FEED_YIELD_BONUS,
  GEM_FEED_SPEED_BONUS_PCT,
  MAX_RESEARCH_LEVEL,
  researchSpeedRange,
  researchYieldRange,
  researchCost,
  type BugType,
  type ItemCost,
  type Price
} from '#shared/utils/colony'

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

  return db.transaction(async (tx) => {
    const currentLevel = await getResearchLevel(userId, typeId)
    const cost = researchCost(currentLevel, type.spawnCost)
    if (cost === null || currentLevel >= MAX_RESEARCH_LEVEL) {
      throw createError({ statusCode: 400, statusMessage: 'This species is already at max Research level' })
    }

    // The conditional upsert is the mutex: only the request that finds the row
    // still at `currentLevel` bumps it (or inserts the very first level). A
    // concurrent claim matches nothing and rolls back before the debit.
    const [claimed] = await tx.insert(colonyBugResearch)
      .values({ userId, typeId, level: currentLevel + 1 })
      .onConflictDoUpdate({
        target: [colonyBugResearch.userId, colonyBugResearch.typeId],
        set: { level: currentLevel + 1 },
        setWhere: eq(colonyBugResearch.level, currentLevel)
      })
      .returning({ level: colonyBugResearch.level })
    if (!claimed) throw createError({ statusCode: 409, statusMessage: 'Research already advancing, try again' })

    await debit(userId, cost.toFixed(4), 'colony', tx)

    return { level: currentLevel + 1 }
  })
}

/** Add `quantity` of an item straight to unclaimed loot (not yet in the player's spendable inventory). */
async function addLoot(userId: string, itemTypeId: string, quantity: number, tx: DbExecutor = db) {
  if (quantity <= 0) return
  await tx.insert(colonyLoot)
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
  return db.transaction(async (tx) => {
  // Lock the colony_state row for the whole settle: two concurrent settles would
  // otherwise both read the same lastSettledAt and both bank the same elapsed
  // window's loot. The loser now blocks here, then reads the advanced timestamp
  // and returns early with elapsedMs <= 0.
  await tx.insert(colonyState).values({ userId }).onConflictDoNothing()
  const [state] = await tx.select().from(colonyState).where(eq(colonyState.userId, userId)).for('update')
  if (!state) throw createError({ statusCode: 500, statusMessage: 'Could not initialize colony state' })
  const now = Date.now()
  const elapsedMs = now - state.lastSettledAt.getTime()
  if (elapsedMs <= 0) return state

  const [allBugs, levels] = await Promise.all([
    tx.query.colonyBugs.findMany({ where: eq(colonyBugs.userId, userId) }),
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
      tx.update(colonyBugs).set({ tickProgressMs: bugRemainders.get(bug.id) ?? bug.tickProgressMs }).where(eq(colonyBugs.id, bug.id))
    )
    await Promise.all(bugUpdates)
    for (const [itemTypeId, qty] of lootByItem) {
      await addLoot(userId, itemTypeId, qty, tx)
    }
    if (gemsEarned > 0) await creditGems(userId, Math.floor(gemsEarned), tx)
  }

  const [updated] = await tx.update(colonyState)
    .set({
      nutrition: Math.round(Math.min(nutritionMax, newNutrition)),
      gemNutrition: Math.round(Math.max(0, newGemNutrition)),
      lastSettledAt: new Date(now)
    })
    .where(eq(colonyState.userId, userId))
    .returning()

  return updated!
  })
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
export async function creditItems(userId: string, itemTypeId: string, quantity: number, tx: DbExecutor = db) {
  if (quantity <= 0) return
  await tx.insert(colonyItems)
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

// ─── state.get.ts DTO serializers ──────────────────────────────────────────
// Pure shaping only: takes rows and config lookups the endpoint already
// fetched, returns exactly the JSON slices state.get.ts sends to the client.
// No DB access below this point.

type TrackModifiers = ReturnType<typeof deriveTrackModifiers>
type ColonyBugRow = typeof colonyBugs.$inferSelect
type ColonyStateRow = typeof colonyState.$inferSelect

/** Gem-producing species don't forage a real ITEM_TYPES entry (itemId is ''), so display info is special-cased here instead of via getItem(). */
export function foragedDisplay(type: BugType | undefined) {
  if (type?.producesGems) return { emoji: '💎', name: 'Gems', sellValue: 0 }
  const item = type ? getItem(type.itemId) : undefined
  return { emoji: item?.emoji ?? '❓', name: item?.name ?? 'Item', sellValue: item?.sellValue ?? 0 }
}

function buildPlacedBugDto(bug: ColonyBugRow, mods: TrackModifiers, sameSpeciesCount: number, gemBuffActive: boolean, buffSpeedPct: number) {
  const type = getBug(bug.typeId)
  const display = foragedDisplay(type)
  const social = socialMultiplier(bug.typeId, sameSpeciesCount)
  const socialPct = socialSpeedBonusPct(bug.typeId, sameSpeciesCount)

  if (type?.producesGems) {
    // Fixed cycle TIME, but per-cycle output rides the Foraging
    // Yield/Speed tracks, hard-capped — see gemTickMs/effectiveGemsPerDay.
    const tickMs = gemTickMs(bug, sameSpeciesCount)
    const gemsPerCycle = effectiveGemsPerDay(bug, mods.yieldLevelBonus, mods.speedBonusPct)
    return {
      id: bug.id,
      typeId: bug.typeId,
      speed: bug.speed,
      yield: bug.yield,
      eat: bug.eat,
      name: type.name,
      emoji: type.emoji,
      color: type.color,
      tier: type.tier,
      social: type.social,
      sameSpeciesCount,
      socialMultiplier: social,
      itemTypeId: '',
      itemEmoji: display.emoji,
      itemName: display.name,
      itemSellValue: 0,
      tickMs,
      tickProgressMs: bug.tickProgressMs,
      itemsPerTickMin: gemsPerCycle,
      itemsPerTickMax: gemsPerCycle,
      itemsPerHour: tickMs > 0 ? (gemsPerCycle / tickMs) * 3_600_000 : 0,
      gemsPerCycle,
      feedPerHour: effectiveEatPerTick(bug, mods.feedMultiplier) * (3_600_000 / tickMs)
    }
  }

  const tickMs = effectiveTickMs(bug, mods.speedBonusPct + socialPct + buffSpeedPct)
  // Social no longer touches output at all. Every completed cycle rolls
  // 1 + random(0..effectiveYield) items (see rollTickYield) — bug.yield is
  // a fixed per-instance LEVEL that acts as the ceiling, not the output
  // itself, bumped by the Foraging Yield track's flat level bonus and by
  // +1 more while the gem-feed buff is active. min is always 1, max is
  // effectiveYield+1, avg (for rate math) is avgTickYield.
  const effectiveYield = bug.yield + mods.yieldLevelBonus + (gemBuffActive ? GEM_FEED_YIELD_BONUS : 0)
  const itemsPerTickMin = 1
  const itemsPerTickMax = effectiveYield + 1
  const itemsPerTickAvg = avgTickYield(effectiveYield)
  return {
    id: bug.id,
    typeId: bug.typeId,
    speed: bug.speed,
    yield: bug.yield,
    eat: bug.eat,
    name: type?.name ?? bug.typeId,
    emoji: type?.emoji ?? '🐛',
    color: type?.color ?? 0x888888,
    tier: type?.tier ?? 1,
    social: type?.social ?? true,
    sameSpeciesCount,
    socialMultiplier: social,
    itemTypeId: type?.itemId ?? '',
    itemEmoji: display.emoji,
    itemName: display.name,
    itemSellValue: display.sellValue,
    tickMs,
    tickProgressMs: bug.tickProgressMs,
    // Min/max pair drives the terrarium canvas's floating-number popup —
    // it picks a random value in this range client-side to visualize the
    // real per-tick roll. itemsPerHour uses the true expected value.
    itemsPerTickMin,
    itemsPerTickMax,
    itemsPerHour: tickMs > 0 ? (itemsPerTickAvg / tickMs) * 3_600_000 : 0,
    // Eating is tied to completed ticks (see effectiveFeedPerHour) — a
    // faster effective tick from the speed trait, the Foraging Speed
    // track, a Social speed bonus, or the gem-feed buff means more meals
    // per hour, exactly like it means more loot.
    feedPerHour: effectiveFeedPerHour(bug, mods.speedBonusPct + socialPct + buffSpeedPct, mods.feedMultiplier)
  }
}

/**
 * DTOs for every placed (terrarium) bug, plus the colony's total nutrition
 * drain/hr — both ride the same same-species-count and gem-feed-buff state,
 * so they're derived together in one pass over placedBugs.
 */
export function serializePlacedBugs(placedBugs: ColonyBugRow[], mods: TrackModifiers, gemBuffActive: boolean) {
  const buffSpeedPct = gemBuffActive ? GEM_FEED_SPEED_BONUS_PCT : 0
  const sameSpeciesCounts = new Map<string, number>()
  for (const bug of placedBugs) sameSpeciesCounts.set(bug.typeId, (sameSpeciesCounts.get(bug.typeId) ?? 0) + 1)

  const nutritionDrainPerHour = placedBugs.reduce((sum, bug) => {
    const socialPct = socialSpeedBonusPct(bug.typeId, sameSpeciesCounts.get(bug.typeId) ?? 1)
    const type = getBug(bug.typeId)
    if (type?.producesGems) {
      const tickMs = gemTickMs(bug, sameSpeciesCounts.get(bug.typeId) ?? 1)
      return sum + effectiveEatPerTick(bug, mods.feedMultiplier) * (3_600_000 / tickMs)
    }
    return sum + effectiveFeedPerHour(bug, mods.speedBonusPct + socialPct + buffSpeedPct, mods.feedMultiplier)
  }, 0)

  const bugs = placedBugs.map(bug =>
    buildPlacedBugDto(bug, mods, sameSpeciesCounts.get(bug.typeId) ?? 1, gemBuffActive, buffSpeedPct)
  )

  return { bugs, nutritionDrainPerHour }
}

/** Unplaced bugs, stacked by type+traits, with display/feed info for the inventory list. */
export function serializeBugInventory(unplacedBugs: ColonyBugRow[], mods: TrackModifiers) {
  const bugStacks = new Map<string, { typeId: string, speed: number, yield: number, eat: number, quantity: number }>()
  for (const bug of unplacedBugs) {
    const key = `${bug.typeId}:${bug.speed}:${bug.yield}:${bug.eat}`
    const existingStack = bugStacks.get(key)
    if (existingStack) existingStack.quantity++
    else bugStacks.set(key, { typeId: bug.typeId, speed: bug.speed, yield: bug.yield, eat: bug.eat, quantity: 1 })
  }
  return Array.from(bugStacks.values()).map((stack) => {
    const type = getBug(stack.typeId)
    const display = foragedDisplay(type)
    return {
      typeId: stack.typeId,
      speed: stack.speed,
      yield: stack.yield,
      eat: stack.eat,
      quantity: stack.quantity,
      name: type?.name ?? stack.typeId,
      emoji: type?.emoji ?? '🐛',
      color: type?.color ?? 0x888888,
      tier: type?.tier ?? 1,
      social: type?.social ?? true,
      producesGems: type?.producesGems ?? false,
      baseTickMs: type?.baseTickMs ?? 0,
      yieldMin: type?.yieldMin ?? 0,
      yieldMax: type?.yieldMax ?? 0,
      eatMin: type?.eatMin ?? 0,
      eatMax: type?.eatMax ?? 0,
      feedPerHour: type?.producesGems
        ? effectiveEatPerTick(stack, mods.feedMultiplier) * (3_600_000 / gemTickMs(stack, 1))
        : effectiveFeedPerHour(stack, mods.speedBonusPct, mods.feedMultiplier),
      itemEmoji: display.emoji,
      itemName: display.name,
      itemSellValue: display.sellValue
    }
  })
}

/** Every upgrade track's DTO: current/next effect labels, next cost/duration, and whether it meets the current habitat's requirement. */
export function serializeUpgradeTracks(levels: Record<string, number>, habitatLevel: number) {
  return UPGRADE_TRACKS.map((track) => {
    const level = levels[track.id] ?? 0
    const atMax = level >= track.maxLevel
    const requiredLevel = habitatTrackRequirement(track.id, habitatLevel)
    return {
      id: track.id,
      name: track.name,
      icon: track.icon,
      description: track.description,
      level,
      maxLevel: track.maxLevel,
      atMax,
      currentEffect: track.effectLabel(level),
      nextEffect: atMax ? null : track.effectLabel(level + 1),
      nextCost: atMax ? null : trackLevelCost(level + 1),
      nextDurationMs: atMax ? null : trackLevelDurationMs(level + 1),
      requiredLevel,
      meetsHabitatRequirement: level >= requiredLevel
    }
  })
}

/** The single builder's current job (track level-up or habitat level-up), or null if idle. */
export function serializeBuilder(state: ColonyStateRow, levels: Record<string, number>) {
  if (!state.builderTrackId || !state.builderStartedAt) return null

  if (state.builderTrackId === HABITAT_BUILDER_JOB_ID) {
    return {
      kind: 'habitat' as const,
      trackId: state.builderTrackId,
      trackName: 'Habitat',
      level: state.habitatLevel + 1,
      startedAt: state.builderStartedAt.toISOString(),
      completesAt: new Date(state.builderStartedAt.getTime() + habitatLevelUpDurationMs(state.habitatLevel)).toISOString()
    }
  }

  const track = UPGRADE_TRACKS.find(t => t.id === state.builderTrackId)
  const nextLevel = (levels[state.builderTrackId] ?? 0) + 1
  const durationMs = trackLevelDurationMs(nextLevel)
  return {
    kind: 'track' as const,
    trackId: state.builderTrackId,
    trackName: track?.name ?? state.builderTrackId,
    level: nextLevel,
    startedAt: state.builderStartedAt.toISOString(),
    completesAt: new Date(state.builderStartedAt.getTime() + durationMs).toISOString()
  }
}

/** Every species' Research DTO: current roll range, next range, and coin cost to advance. */
export function serializeResearch(researchLevels: Record<string, number>) {
  return BUG_TYPES.map((t) => {
    const researchLevel = researchLevels[t.id] ?? 0
    const atMax = researchLevel >= MAX_RESEARCH_LEVEL
    const [speedMin, speedMax] = researchSpeedRange(researchLevel)
    const [yieldMin, yieldMax] = researchYieldRange(researchLevel)
    const cost = atMax ? null : researchCost(researchLevel, t.spawnCost)
    return {
      typeId: t.id,
      name: t.name,
      emoji: t.emoji,
      tier: t.tier,
      level: researchLevel,
      maxLevel: MAX_RESEARCH_LEVEL,
      atMax,
      speedMin,
      speedMax,
      yieldMin,
      yieldMax,
      nextSpeedRange: atMax ? null : researchSpeedRange(researchLevel + 1),
      nextYieldRange: atMax ? null : researchYieldRange(researchLevel + 1),
      cost
    }
  })
}

/** Every species' catalog entry: current roll range (from Research), buyability, and owned count. */
export function serializeSpeciesCatalog(bugs: ColonyBugRow[], researchLevels: Record<string, number>, habitatLevel: number) {
  return BUG_TYPES.map((t) => {
    const display = foragedDisplay(t)
    const researchLevel = researchLevels[t.id] ?? 0
    const [speedMin, speedMax] = researchSpeedRange(researchLevel)
    const [yieldMin, yieldMax] = researchYieldRange(researchLevel)
    return {
      ...t,
      // Overridden with the species' current Research-level roll range —
      // BUG_TYPES' own yieldMin/yieldMax is just the level-0 base.
      yieldMin,
      yieldMax,
      speedMin,
      speedMax,
      researchLevel,
      buyable: t.tier <= habitatLevel,
      owned: bugs.filter(b => b.typeId === t.id).length,
      itemEmoji: display.emoji,
      itemName: display.name,
      itemSellValue: display.sellValue
    }
  })
}
