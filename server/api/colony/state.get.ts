import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs, colonyItems, colonyLoot } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony, getUpgradeLevels } from '#server/utils/colony'
import {
  getBug,
  getItem,
  BUG_TYPES,
  ITEM_TYPES,
  UPGRADE_TRACKS,
  effectiveTickMs,
  effectiveYieldPerTick,
  feedPerHour,
  deriveCapacity,
  deriveNutritionMax,
  deriveTrackModifiers,
  trackLevelCost,
  trackLevelDurationMs,
  habitatTrackRequirement,
  HABITAT_LEVEL_UP_COST,
  MAX_TIER,
  FEED_COST
} from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const state = await settleColony(userId)

  const [bugs, items, loot, levels] = await Promise.all([
    db.query.colonyBugs.findMany({ where: eq(colonyBugs.userId, userId) }),
    db.query.colonyItems.findMany({ where: eq(colonyItems.userId, userId) }),
    db.query.colonyLoot.findMany({ where: eq(colonyLoot.userId, userId) }),
    getUpgradeLevels(userId)
  ])

  const initialized = bugs.length > 0

  const placedBugs = bugs.filter(b => b.inTerrarium)
  const unplacedBugs = bugs.filter(b => !b.inTerrarium)

  const mods = deriveTrackModifiers(levels)
  const capacity = deriveCapacity(levels)
  const nutritionMax = deriveNutritionMax(levels)
  const nutritionDrainPerHour = placedBugs.reduce((sum, bug) => sum + feedPerHour(bug) * mods.feedMultiplier, 0)

  const sameSpeciesCounts = new Map<string, number>()
  for (const bug of placedBugs) sameSpeciesCounts.set(bug.typeId, (sameSpeciesCounts.get(bug.typeId) ?? 0) + 1)

  const enrichedBugs = placedBugs.map((bug) => {
    const type = getBug(bug.typeId)
    const item = type ? getItem(type.itemId) : undefined
    const sameSpeciesCount = sameSpeciesCounts.get(bug.typeId) ?? 1
    const tickMs = effectiveTickMs(bug) * mods.tickMultiplier
    const itemsPerTick = effectiveYieldPerTick(bug, sameSpeciesCount) * mods.yieldMultiplier
    return {
      id: bug.id,
      typeId: bug.typeId,
      speed: bug.speed,
      yield: bug.yield,
      feed: bug.feed,
      name: type?.name ?? bug.typeId,
      emoji: type?.emoji ?? '🐛',
      color: type?.color ?? 0x888888,
      tier: type?.tier ?? 1,
      social: type?.social ?? true,
      sameSpeciesCount,
      itemTypeId: type?.itemId ?? '',
      itemEmoji: item?.emoji ?? '❓',
      itemName: item?.name ?? 'Item',
      tickMs,
      tickProgressMs: bug.tickProgressMs,
      itemsPerTick,
      itemsPerHour: tickMs > 0 ? (itemsPerTick / tickMs) * 3_600_000 : 0,
      feedPerHour: feedPerHour(bug) * mods.feedMultiplier
    }
  })

  const ownedItemMap = new Map(items.map(i => [i.itemTypeId, i.quantity]))
  const inventory = ITEM_TYPES.map(t => ({ ...t, quantity: ownedItemMap.get(t.id) ?? 0 }))

  // ─── Bug inventory (unplaced, stacked by type+stats) ───────────────────
  const bugStacks = new Map<string, { typeId: string, speed: number, yield: number, feed: number, quantity: number }>()
  for (const bug of unplacedBugs) {
    const key = `${bug.typeId}:${bug.speed}:${bug.yield}:${bug.feed}`
    const existing = bugStacks.get(key)
    if (existing) existing.quantity++
    else bugStacks.set(key, { typeId: bug.typeId, speed: bug.speed, yield: bug.yield, feed: bug.feed, quantity: 1 })
  }
  const bugInventory = Array.from(bugStacks.values()).map((stack) => {
    const type = getBug(stack.typeId)
    const item = type ? getItem(type.itemId) : undefined
    return {
      typeId: stack.typeId,
      speed: stack.speed,
      yield: stack.yield,
      feed: stack.feed,
      quantity: stack.quantity,
      name: type?.name ?? stack.typeId,
      emoji: type?.emoji ?? '🐛',
      color: type?.color ?? 0x888888,
      tier: type?.tier ?? 1,
      social: type?.social ?? true,
      itemEmoji: item?.emoji ?? '❓',
      itemName: item?.name ?? 'Item'
    }
  })

  const lootMap = new Map(loot.map(l => [l.itemTypeId, l.quantity]))
  const pendingLoot = ITEM_TYPES
    .map(t => ({ itemTypeId: t.id, name: t.name, emoji: t.emoji, quantity: lootMap.get(t.id) ?? 0 }))
    .filter(l => l.quantity > 0)

  // ─── Builder / upgrade tracks ──────────────────────────────────────────
  const upgrades = UPGRADE_TRACKS.map((track) => {
    const level = levels[track.id] ?? 0
    const atMax = level >= track.maxLevel
    const requiredLevel = habitatTrackRequirement(track.id, state.habitatLevel)
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

  let builder: { trackId: string, trackName: string, level: number, startedAt: string, completesAt: string } | null = null
  if (state.builderTrackId && state.builderStartedAt) {
    const track = UPGRADE_TRACKS.find(t => t.id === state.builderTrackId)
    const nextLevel = (levels[state.builderTrackId] ?? 0) + 1
    const durationMs = trackLevelDurationMs(nextLevel)
    builder = {
      trackId: state.builderTrackId,
      trackName: track?.name ?? state.builderTrackId,
      level: nextLevel,
      startedAt: state.builderStartedAt.toISOString(),
      completesAt: new Date(state.builderStartedAt.getTime() + durationMs).toISOString()
    }
  }

  return {
    initialized,
    serverNow: Date.now(),
    capacity,
    habitatLevel: state.habitatLevel,
    maxTier: MAX_TIER,
    habitatLevelUpCost: HABITAT_LEVEL_UP_COST,
    nutrition: state.nutrition,
    nutritionMax,
    nutritionDrainPerHour,
    bugs: enrichedBugs,
    speciesCatalog: BUG_TYPES.map(t => ({
      ...t,
      buyable: !!t.isStarter || t.tier <= state.habitatLevel,
      owned: bugs.filter(b => b.typeId === t.id).length
    })),
    inventory,
    bugInventory,
    placedCount: placedBugs.length,
    pendingLoot,
    upgrades,
    builder,
    builderCount: 1,
    feedCost: FEED_COST
  }
})
