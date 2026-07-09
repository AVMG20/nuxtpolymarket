import { eq, and, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyState, colonyBugs, colonyUpgrades, colonyLoot, colonyItems } from '#server/database/schema'
import { debit } from '#server/utils/balance'
import {
  getBug,
  effectiveTickMs,
  effectiveYieldPerTick,
  feedPerHour,
  deriveNutritionMax,
  deriveTrackModifiers,
  type ItemCost,
  type Price
} from '#shared/utils/colony'

export async function ensureColonyState(userId: string) {
  const existing = await db.query.colonyState.findFirst({ where: eq(colonyState.userId, userId) })
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
 * via the loot chest. Nutrition drain is the sum of every bug's own feed
 * consumption, so a bigger or hungrier colony needs feeding more often.
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

  const totalFeedPerHour = bugs.reduce((sum, bug) => sum + feedPerHour(bug) * mods.feedMultiplier, 0)
  const drainPerMs = totalFeedPerHour / 3_600_000
  const activeMs = drainPerMs > 0 && state.nutrition > 0 ? Math.min(elapsedMs, state.nutrition / drainPerMs) : (state.nutrition > 0 ? elapsedMs : 0)
  const newNutrition = drainPerMs > 0 ? Math.max(0, state.nutrition - drainPerMs * elapsedMs) : state.nutrition

  if (activeMs > 0) {
    const sameSpeciesCounts = new Map<string, number>()
    for (const bug of bugs) sameSpeciesCounts.set(bug.typeId, (sameSpeciesCounts.get(bug.typeId) ?? 0) + 1)

    const lootByItem = new Map<string, number>()
    const bugUpdates: Promise<unknown>[] = []

    for (const bug of bugs) {
      const type = getBug(bug.typeId)
      if (!type) continue
      const tickMs = effectiveTickMs(bug) * mods.tickMultiplier
      if (!Number.isFinite(tickMs) || tickMs <= 0) continue

      const totalProgress = bug.tickProgressMs + activeMs
      const ticks = Math.floor(totalProgress / tickMs)
      const remainder = totalProgress - ticks * tickMs

      if (ticks > 0) {
        const sameSpeciesCount = sameSpeciesCounts.get(bug.typeId) ?? 1
        const qty = Math.round(ticks * effectiveYieldPerTick(bug, sameSpeciesCount) * mods.yieldMultiplier)
        lootByItem.set(type.itemId, (lootByItem.get(type.itemId) ?? 0) + qty)
      }

      bugUpdates.push(
        db.update(colonyBugs).set({ tickProgressMs: Math.round(remainder) }).where(eq(colonyBugs.id, bug.id))
      )
    }

    await Promise.all(bugUpdates)
    for (const [itemTypeId, qty] of lootByItem) {
      await addLoot(userId, itemTypeId, qty)
    }
  }

  const [updated] = await db.update(colonyState)
    .set({ nutrition: Math.round(Math.min(nutritionMax, newNutrition)), lastSettledAt: new Date(now) })
    .where(eq(colonyState.userId, userId))
    .returning()

  return updated!
}

/** Insert one bug instance. Defaults to the player's inventory (unplaced); pass inTerrarium to place it directly. */
export async function addBug(userId: string, typeId: string, speed: number, yield_: number, feed: number, inTerrarium = false) {
  const [bug] = await db.insert(colonyBugs).values({ userId, typeId, speed, yield: yield_, feed, inTerrarium }).returning()
  return bug!
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
  if (price.coins > 0) await debit(userId, price.coins.toFixed(4), 'colony:upgrade')
}
