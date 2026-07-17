import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs, colonyItems, colonyLoot } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
  getColonyState,
  settleColony,
  getUpgradeLevels,
  getResearchLevels,
  serializePlacedBugs,
  serializeBugInventory,
  serializeUpgradeTracks,
  serializeBuilder,
  serializeResearch,
  serializeSpeciesCatalog
} from '#server/utils/colony'
import {
  ITEM_TYPES,
  MAX_TIER,
  MAX_TRAIT_PCT,
  MAX_YIELD_LEVEL,
  deriveCapacity,
  deriveNutritionMax,
  deriveTrackModifiers,
  habitatLevelUpCost,
  habitatLevelUpDurationMs,
  habitatLevelUpGemCost,
  gemFeedCost,
  gemFeedNutritionPerGem,
  FEED_COST_PER_POINT
} from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  // Not founded yet — the client shows the start screen. Don't auto-create,
  // founding is an explicit action (POST /api/colony/init). Same payload
  // shape as the founded case so the client composable stays simple.
  const existing = await getColonyState(userId)
  if (!existing) {
    return {
      initialized: false,
      serverNow: Date.now(),
      capacity: deriveCapacity({}),
      habitatLevel: 1,
      maxTier: MAX_TIER,
      maxTraitPct: MAX_TRAIT_PCT,
      maxYieldLevel: MAX_YIELD_LEVEL,
      habitatLevelUpCost: habitatLevelUpCost(1) as number | null,
      habitatLevelUpDurationMs: habitatLevelUpDurationMs(1) as number | null,
      habitatLevelUpGemCost: habitatLevelUpGemCost(1) as number | null,
      nutrition: 0,
      nutritionMax: deriveNutritionMax({}),
      nutritionDrainPerHour: 0,
      feedCost: 0,
      gemNutrition: 0,
      gemBuffActive: false,
      gemFeedCost: 0,
      gemFeedNutritionPerGem: gemFeedNutritionPerGem(deriveNutritionMax({})),
      bugs: [],
      speciesCatalog: [],
      inventory: [],
      bugInventory: [],
      placedCount: 0,
      pendingLoot: [],
      upgrades: [],
      research: [],
      builder: null,
      builderCount: 1
    }
  }

  const state = await settleColony(userId)

  const [bugs, items, loot, levels, researchLevels] = await Promise.all([
    db.query.colonyBugs.findMany({ where: eq(colonyBugs.userId, userId) }),
    db.query.colonyItems.findMany({ where: eq(colonyItems.userId, userId) }),
    db.query.colonyLoot.findMany({ where: eq(colonyLoot.userId, userId) }),
    getUpgradeLevels(userId),
    getResearchLevels(userId)
  ])

  const placedBugs = bugs.filter(b => b.inTerrarium)
  const unplacedBugs = bugs.filter(b => !b.inTerrarium)

  const mods = deriveTrackModifiers(levels)
  const capacity = deriveCapacity(levels)
  const nutritionMax = deriveNutritionMax(levels)

  // Gem-fed nutrition always drains first and buffs every non-gem bug
  // (+1 yield, +20% speed) for as long as any remains — see settleColony.
  // Reflect whichever rate is CURRENTLY in effect in every display number
  // below, so the UI matches what's actually happening right now.
  const gemBuffActive = state.gemNutrition > 0
  const { bugs: enrichedBugs, nutritionDrainPerHour } = serializePlacedBugs(placedBugs, mods, gemBuffActive)

  const ownedItemMap = new Map(items.map(i => [i.itemTypeId, i.quantity]))
  const inventory = ITEM_TYPES.map(t => ({ ...t, quantity: ownedItemMap.get(t.id) ?? 0 }))
  const bugInventory = serializeBugInventory(unplacedBugs, mods)

  const lootMap = new Map(loot.map(l => [l.itemTypeId, l.quantity]))
  const pendingLoot = ITEM_TYPES
    .map(t => ({ itemTypeId: t.id, name: t.name, emoji: t.emoji, quantity: lootMap.get(t.id) ?? 0 }))
    .filter(l => l.quantity > 0)

  return {
    initialized: true as const,
    serverNow: Date.now(),
    capacity,
    habitatLevel: state.habitatLevel,
    maxTier: MAX_TIER,
    maxTraitPct: MAX_TRAIT_PCT,
    maxYieldLevel: MAX_YIELD_LEVEL,
    habitatLevelUpCost: state.habitatLevel < MAX_TIER ? habitatLevelUpCost(state.habitatLevel) : null,
    habitatLevelUpDurationMs: state.habitatLevel < MAX_TIER ? habitatLevelUpDurationMs(state.habitatLevel) : null,
    habitatLevelUpGemCost: state.habitatLevel < MAX_TIER ? habitatLevelUpGemCost(state.habitatLevel) : null,
    nutrition: state.nutrition,
    nutritionMax,
    nutritionDrainPerHour,
    // Coin and gem feed share the same tank — "missing" is whatever's left
    // after BOTH pools, so feeding with either one never overflows it.
    feedCost: Math.max(0, (nutritionMax - state.nutrition - state.gemNutrition) * FEED_COST_PER_POINT),
    gemNutrition: state.gemNutrition,
    gemBuffActive,
    gemFeedCost: gemFeedCost(Math.max(0, nutritionMax - state.nutrition - state.gemNutrition), nutritionMax),
    gemFeedNutritionPerGem: gemFeedNutritionPerGem(nutritionMax),
    bugs: enrichedBugs,
    speciesCatalog: serializeSpeciesCatalog(bugs, researchLevels, state.habitatLevel),
    inventory,
    bugInventory,
    placedCount: placedBugs.length,
    pendingLoot,
    upgrades: serializeUpgradeTracks(levels, state.habitatLevel),
    research: serializeResearch(researchLevels),
    builder: serializeBuilder(state, levels),
    builderCount: 1
  }
})
