import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs, colonyItems, colonyLoot } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getColonyState, settleColony, getUpgradeLevels, getResearchLevels } from '#server/utils/colony'
import {
  getBug,
  getItem,
  BUG_TYPES,
  ITEM_TYPES,
  UPGRADE_TRACKS,
  effectiveTickMs,
  effectiveEatPerTick,
  effectiveFeedPerHour,
  socialMultiplier,
  socialSpeedBonusPct,
  avgTickYield,
  gemTickMs,
  effectiveGemsPerDay,
  deriveCapacity,
  deriveNutritionMax,
  deriveTrackModifiers,
  trackLevelCost,
  trackLevelDurationMs,
  habitatTrackRequirement,
  habitatLevelUpCost,
  habitatLevelUpDurationMs,
  habitatLevelUpGemCost,
  HABITAT_BUILDER_JOB_ID,
  MAX_TIER,
  MAX_TRAIT_PCT,
  MAX_YIELD_LEVEL,
  MAX_RESEARCH_LEVEL,
  researchSpeedRange,
  researchYieldRange,
  researchCost,
  FEED_COST_PER_POINT,
  GEM_FEED_YIELD_BONUS,
  GEM_FEED_SPEED_BONUS_PCT,
  gemFeedCost,
  gemFeedNutritionPerGem,
  type BugType
} from '#shared/utils/colony'

/** Gem-producing species don't forage a real ITEM_TYPES entry (itemId is ''), so display info is special-cased here instead of via getItem(). */
function foragedDisplay(type: BugType | undefined) {
  if (type?.producesGems) return { emoji: '💎', name: 'Gems', sellValue: 0 }
  const item = type ? getItem(type.itemId) : undefined
  return { emoji: item?.emoji ?? '❓', name: item?.name ?? 'Item', sellValue: item?.sellValue ?? 0 }
}

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

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

  const sameSpeciesCounts = new Map<string, number>()
  for (const bug of placedBugs) sameSpeciesCounts.set(bug.typeId, (sameSpeciesCounts.get(bug.typeId) ?? 0) + 1)

  // Gem-fed nutrition always drains first and buffs every non-gem bug
  // (+1 yield, +20% speed) for as long as any remains — see settleColony.
  // Reflect whichever rate is CURRENTLY in effect in every display number
  // below, so the UI matches what's actually happening right now.
  const gemBuffActive = state.gemNutrition > 0
  const buffSpeedPct = gemBuffActive ? GEM_FEED_SPEED_BONUS_PCT : 0

  const nutritionDrainPerHour = placedBugs.reduce((sum, bug) => {
    const socialPct = socialSpeedBonusPct(bug.typeId, sameSpeciesCounts.get(bug.typeId) ?? 1)
    const type = getBug(bug.typeId)
    if (type?.producesGems) {
      const tickMs = gemTickMs(bug, sameSpeciesCounts.get(bug.typeId) ?? 1)
      return sum + effectiveEatPerTick(bug, mods.feedMultiplier) * (3_600_000 / tickMs)
    }
    return sum + effectiveFeedPerHour(bug, mods.speedBonusPct + socialPct + buffSpeedPct, mods.feedMultiplier)
  }, 0)

  const enrichedBugs = placedBugs.map((bug) => {
    const type = getBug(bug.typeId)
    const display = foragedDisplay(type)
    const sameSpeciesCount = sameSpeciesCounts.get(bug.typeId) ?? 1
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
  })

  const ownedItemMap = new Map(items.map(i => [i.itemTypeId, i.quantity]))
  const inventory = ITEM_TYPES.map(t => ({ ...t, quantity: ownedItemMap.get(t.id) ?? 0 }))

  // ─── Bug inventory (unplaced, stacked by type+traits) ────────────────────
  const bugStacks = new Map<string, { typeId: string, speed: number, yield: number, eat: number, quantity: number }>()
  for (const bug of unplacedBugs) {
    const key = `${bug.typeId}:${bug.speed}:${bug.yield}:${bug.eat}`
    const existingStack = bugStacks.get(key)
    if (existingStack) existingStack.quantity++
    else bugStacks.set(key, { typeId: bug.typeId, speed: bug.speed, yield: bug.yield, eat: bug.eat, quantity: 1 })
  }
  const bugInventory = Array.from(bugStacks.values()).map((stack) => {
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

  let builder: { kind: 'track' | 'habitat', trackId: string, trackName: string, level: number, startedAt: string, completesAt: string } | null = null
  if (state.builderTrackId && state.builderStartedAt) {
    if (state.builderTrackId === HABITAT_BUILDER_JOB_ID) {
      builder = {
        kind: 'habitat',
        trackId: state.builderTrackId,
        trackName: 'Habitat',
        level: state.habitatLevel + 1,
        startedAt: state.builderStartedAt.toISOString(),
        completesAt: new Date(state.builderStartedAt.getTime() + habitatLevelUpDurationMs(state.habitatLevel)).toISOString()
      }
    } else {
      const track = UPGRADE_TRACKS.find(t => t.id === state.builderTrackId)
      const nextLevel = (levels[state.builderTrackId] ?? 0) + 1
      const durationMs = trackLevelDurationMs(nextLevel)
      builder = {
        kind: 'track',
        trackId: state.builderTrackId,
        trackName: track?.name ?? state.builderTrackId,
        level: nextLevel,
        startedAt: state.builderStartedAt.toISOString(),
        completesAt: new Date(state.builderStartedAt.getTime() + durationMs).toISOString()
      }
    }
  }

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
    speciesCatalog: BUG_TYPES.map((t) => {
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
        buyable: t.tier <= state.habitatLevel,
        owned: bugs.filter(b => b.typeId === t.id).length,
        itemEmoji: display.emoji,
        itemName: display.name,
        itemSellValue: display.sellValue
      }
    }),
    inventory,
    bugInventory,
    placedCount: placedBugs.length,
    pendingLoot,
    upgrades,
    research: BUG_TYPES.map((t) => {
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
    }),
    builder,
    builderCount: 1
  }
})
