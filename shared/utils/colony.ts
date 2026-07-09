// Colony — shared game-balance config, used by both client and server.
// Static species/item/tier data lives here, only instance data (which bug,
// what stats it rolled, how much of each item is owned) is persisted.
//
// Pacing note: tick times, yields and habitat-level costs below are tuned so
// a regularly-engaged player (checking in and collecting loot several times
// a day) reaches Habitat Level 6 in roughly 90 days. Early tiers snowball
// fast (minutes to hours); tier 4-6 upgrades are deliberately brutal and
// dominate the timeline. These are tunable — not a precise simulation.

export interface ItemType {
  id: string
  name: string
  emoji: string
  tier: number
  /** Coins per unit when sold on the market */
  sellValue: number
}

export const ITEM_TYPES: ItemType[] = [
  { id: 'silk', name: 'Silk Scrap', emoji: '🧵', tier: 1, sellValue: 2 },
  { id: 'loam', name: 'Rich Loam', emoji: '🧱', tier: 1, sellValue: 2 },
  { id: 'chitin', name: 'Chitin Shard', emoji: '🦴', tier: 2, sellValue: 25 },
  { id: 'shell_fragment', name: 'Shell Fragment', emoji: '🐚', tier: 2, sellValue: 25 },
  { id: 'resin', name: 'Amber Resin', emoji: '🟠', tier: 3, sellValue: 200 },
  { id: 'pheromone', name: 'Pheromone Vial', emoji: '🧪', tier: 3, sellValue: 200 },
  { id: 'venom', name: 'Venom Sac', emoji: '☠️', tier: 4, sellValue: 2000 },
  { id: 'carapace', name: 'Hardened Carapace', emoji: '🛡️', tier: 4, sellValue: 2000 },
  { id: 'ember_dust', name: 'Ember Dust', emoji: '🔥', tier: 5, sellValue: 30000 },
  { id: 'royal_jelly', name: 'Royal Jelly', emoji: '🍯', tier: 6, sellValue: 200000 }
]

export function getItem(id: string): ItemType | undefined {
  return ITEM_TYPES.find(i => i.id === id)
}

export function itemsByTier(tier: number): ItemType[] {
  return ITEM_TYPES.filter(i => i.tier === tier)
}

export interface BugType {
  id: string
  name: string
  tier: number
  emoji: string
  /** Pixi fill color (hex number) for the terrarium canvas */
  color: number
  /** Base ms between production ticks at speed level 0 */
  baseTickMs: number
  /** Base item quantity produced per tick at yield level 0 */
  yieldBase: number
  /** Base nutrition consumed per hour at feed level 0 */
  feedBase: number
  /** The item species this bug forages */
  itemId: string
  /** Coin cost to buy one egg of this species on the market, once habitat level allows it */
  spawnCost: number
  description: string
  /** Social bugs get a small yield boost from same-species peers; solitary bugs thrive alone and are penalized when crowded */
  social: boolean
  /** Buyable from the start, no habitat upgrade required */
  isStarter?: boolean
}

export const TIER_NAMES: Record<number, string> = {
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Epic',
  5: 'Legendary',
  6: 'Mythic'
}

export const MAX_TIER = 6

export const BUG_TYPES: BugType[] = [
  { id: 'larva', name: 'Larva', tier: 1, emoji: '🐛', color: 0x8ecae6, baseTickMs: 1 * 60_000, yieldBase: 1, feedBase: 7, itemId: 'silk', spawnCost: 40, description: 'Hardy and quick to mature. Every colony starts here.', social: true, isStarter: true },
  { id: 'grub', name: 'Grub', tier: 1, emoji: '🪱', color: 0xa3b18a, baseTickMs: 3 * 60_000, yieldBase: 3, feedBase: 9, itemId: 'loam', spawnCost: 60, description: 'Slower than a larva but forages more per cycle.', social: false, isStarter: true },
  { id: 'beetle', name: 'Beetle', tier: 2, emoji: '🪲', color: 0xffb703, baseTickMs: 15 * 60_000, yieldBase: 5, feedBase: 18, itemId: 'chitin', spawnCost: 350, description: 'A sturdy, armored forager that does fine in a crowd.', social: true },
  { id: 'ladybug', name: 'Ladybug', tier: 2, emoji: '🐞', color: 0xe63946, baseTickMs: 25 * 60_000, yieldBase: 8, feedBase: 22, itemId: 'shell_fragment', spawnCost: 400, description: 'Spotted and independent — prefers to forage alone.', social: false },
  { id: 'cricket', name: 'Cricket', tier: 3, emoji: '🦗', color: 0x90be6d, baseTickMs: 2 * 3600_000, yieldBase: 30, feedBase: 40, itemId: 'resin', spawnCost: 2200, description: 'Chirps happily in a chorus of its own kind.', social: true },
  { id: 'ant', name: 'Ant', tier: 3, emoji: '🐜', color: 0x6f4e37, baseTickMs: 4 * 3600_000, yieldBase: 60, feedBase: 48, itemId: 'pheromone', spawnCost: 2500, description: 'Tireless colonial workers — thrive together.', social: true },
  { id: 'spider', name: 'Spider', tier: 4, emoji: '🕷️', color: 0x9d4edd, baseTickMs: 10 * 3600_000, yieldBase: 100, feedBase: 85, itemId: 'venom', spawnCost: 15000, description: 'A patient, territorial predator. Does not share well.', social: false },
  { id: 'scorpion', name: 'Scorpion', tier: 4, emoji: '🦂', color: 0xf77f00, baseTickMs: 16 * 3600_000, yieldBase: 160, feedBase: 100, itemId: 'carapace', spawnCost: 16000, description: 'Armored, dangerous, and fiercely solitary.', social: false },
  { id: 'ember_roach', name: 'Ember Roach', tier: 5, emoji: '🪳', color: 0xff006e, baseTickMs: 30 * 3600_000, yieldBase: 120, feedBase: 150, itemId: 'ember_dust', spawnCost: 120000, description: 'Legendary and nearly indestructible.', social: true },
  { id: 'hive_empress', name: 'Hive Empress', tier: 6, emoji: '🐝', color: 0xffd60a, baseTickMs: 72 * 3600_000, yieldBase: 288, feedBase: 260, itemId: 'royal_jelly', spawnCost: 1_000_000, description: 'A mythic queen. The absolute pinnacle of the colony.', social: true }
]

export function getBug(id: string): BugType | undefined {
  return BUG_TYPES.find(b => b.id === id)
}

export function bugsByTier(tier: number): BugType[] {
  return BUG_TYPES.filter(b => b.tier === tier)
}

// ─── Stat levels ────────────────────────────────────────────────────────────
// Every bug instance rolls speed/yield/feed levels (0-5), matching XENO's
// discrete "level" convention rather than free-floating decimals.

export const MAX_STAT_LEVEL = 5
export const SPEED_REDUCTION_PER_LEVEL = 0.12
export const MAX_SPEED_REDUCTION = 0.6
export const YIELD_BONUS_PER_LEVEL = 0.15
/** Higher feed level = a hungrier, costlier bug — this is a downside stat. */
export const FEED_DRAIN_PER_LEVEL = 0.15

export function effectiveTickMs(bug: { typeId: string, speed: number }): number {
  const type = getBug(bug.typeId)
  if (!type) return Infinity
  const reduction = Math.min(MAX_SPEED_REDUCTION, bug.speed * SPEED_REDUCTION_PER_LEVEL)
  return Math.round(type.baseTickMs * (1 - reduction))
}

export function baseYieldPerTick(bug: { typeId: string, yield: number }): number {
  const type = getBug(bug.typeId)
  if (!type) return 0
  return type.yieldBase * (1 + bug.yield * YIELD_BONUS_PER_LEVEL)
}

export function feedPerHour(bug: { typeId: string, feed: number }): number {
  const type = getBug(bug.typeId)
  if (!type) return 0
  return type.feedBase * (1 + bug.feed * FEED_DRAIN_PER_LEVEL)
}

// ─── Social trait ───────────────────────────────────────────────────────────
// Social species get a small yield boost from same-species peers. Solitary
// species thrive alone and lose output as their own kind crowds in.

export const SOCIAL_BONUS_PER_PEER = 0.03
export const SOCIAL_MAX_BONUS = 0.3
export const SOLITARY_BONUS_ALONE = 0.2
export const SOLITARY_PENALTY_PER_PEER = 0.08
export const SOLITARY_MIN_MULTIPLIER = 0.4

/** sameSpeciesCount includes the bug itself. */
export function socialMultiplier(typeId: string, sameSpeciesCount: number): number {
  const type = getBug(typeId)
  if (!type) return 1
  const peers = Math.max(0, sameSpeciesCount - 1)
  if (type.social) {
    return 1 + Math.min(SOCIAL_MAX_BONUS, peers * SOCIAL_BONUS_PER_PEER)
  }
  return Math.max(SOLITARY_MIN_MULTIPLIER, 1 + SOLITARY_BONUS_ALONE - peers * SOLITARY_PENALTY_PER_PEER)
}

/** Effective items-per-tick including yield level and the social/solitary modifier. */
export function effectiveYieldPerTick(bug: { typeId: string, yield: number }, sameSpeciesCount: number): number {
  return baseYieldPerTick(bug) * socialMultiplier(bug.typeId, sameSpeciesCount)
}

/** Roll a starting stat level for a freshly bought/spawned bug — weighted low. */
export function rollStartLevel(): number {
  return Math.floor(Math.random() * Math.random() * (MAX_STAT_LEVEL + 1))
}

// ─── Item costs ─────────────────────────────────────────────────────────────
// A generic {coins, items[]} price used by upgrades and habitat gear, so
// progression naturally requires owning higher-tier bugs rather than just
// grinding coins — and creates a real sell-for-cash-vs-hoard-for-upgrades
// choice once items start taking a long time to forage.

export interface ItemCost {
  itemTypeId: string
  quantity: number
}

export interface Price {
  coins: number
  items: ItemCost[]
}

// ─── Upgrade tracks (Clash-of-Clans style builder queue) ───────────────────
// Everything that makes the colony objectively better — more slots, faster
// bugs, bigger yields, a deeper nutrition tank, leaner eating — is one of a
// handful of leveled tracks. Each level costs coins + items (the required
// item tier climbs as the track levels up) and takes real time to build.
// There is exactly one builder: only one track can be under construction at
// a time. Habitat Level (which gates which bug tiers are purchasable) only
// advances once every track has reached a required level — so the "gate" to
// the next tier is broad, deliberate colony investment, not a single grind.

export type UpgradeTrackId = 'capacity' | 'yield_boost' | 'speed_boost' | 'nutrition_storage' | 'nutrition_efficiency'

export interface UpgradeTrackType {
  id: UpgradeTrackId
  name: string
  icon: string
  description: string
  maxLevel: number
  /** Human-readable effect at a given level, for UI display. */
  effectLabel: (level: number) => string
}

export const UPGRADE_TRACKS: UpgradeTrackType[] = [
  {
    id: 'capacity',
    name: 'Terrarium Capacity',
    icon: 'i-lucide-expand',
    description: 'More slots for bugs to live in.',
    maxLevel: 20,
    effectLabel: level => `${BASE_CAPACITY + level} bug slots`
  },
  {
    id: 'yield_boost',
    name: 'Foraging Yield',
    icon: 'i-lucide-trending-up',
    description: 'Every bug produces more per tick, colony-wide.',
    maxLevel: 20,
    effectLabel: level => `+${(level * YIELD_TRACK_BONUS_PER_LEVEL * 100).toFixed(0)}% yield`
  },
  {
    id: 'speed_boost',
    name: 'Foraging Speed',
    icon: 'i-lucide-zap',
    description: 'Every bug ticks faster, colony-wide.',
    maxLevel: 8,
    effectLabel: level => `-${Math.round(Math.min(MAX_SPEED_TRACK_REDUCTION, level * SPEED_TRACK_REDUCTION_PER_LEVEL) * 100)}% tick time`
  },
  {
    id: 'nutrition_storage',
    name: 'Nutrition Storage',
    icon: 'i-lucide-warehouse',
    description: 'Raises the nutrition tank, so feeding lasts longer.',
    maxLevel: 20,
    effectLabel: level => `${NUTRITION_BASE + level * NUTRITION_STORAGE_PER_LEVEL} max nutrition`
  },
  {
    id: 'nutrition_efficiency',
    name: 'Nutrition Efficiency',
    icon: 'i-lucide-leaf',
    description: 'Every bug eats less, colony-wide.',
    maxLevel: 8,
    effectLabel: level => `-${Math.round(Math.min(MAX_FEED_TRACK_REDUCTION, level * FEED_TRACK_REDUCTION_PER_LEVEL) * 100)}% consumption`
  }
]

export function getUpgradeTrack(id: string): UpgradeTrackType | undefined {
  return UPGRADE_TRACKS.find(t => t.id === id)
}

// Every level is meant to feel like a real, noticeable jump — not a 1-2%
// sliver. Yield compounds without a cap (idle games love big late-game
// multipliers); speed/feed reductions cap out well before their track's
// max level so a maxed track reads as "maxed" rather than pointless.
export const YIELD_TRACK_BONUS_PER_LEVEL = 0.15
export const SPEED_TRACK_REDUCTION_PER_LEVEL = 0.1
export const MAX_SPEED_TRACK_REDUCTION = 0.7
export const FEED_TRACK_REDUCTION_PER_LEVEL = 0.1
export const MAX_FEED_TRACK_REDUCTION = 0.7
export const NUTRITION_STORAGE_PER_LEVEL = 40
export const CAPACITY_PER_LEVEL = 2

/** Item tier required to fund a given track level — climbs every 3 levels. */
function trackItemTier(level: number): number {
  return Math.min(MAX_TIER, 1 + Math.floor((level - 1) / 3))
}

/** Cost to build a track up TO `level` (i.e. level = currentLevel + 1). */
export function trackLevelCost(level: number): Price {
  const tier = trackItemTier(level)
  const quantity = Math.round(8 * Math.pow(1.35, level - 1))
  const coins = level === 1 ? 60 : 0
  return { coins, items: itemsByTier(tier).map(i => ({ itemTypeId: i.id, quantity })) }
}

/** Build time to reach `level`. Minutes early, hours to days by the later levels. */
export function trackLevelDurationMs(level: number): number {
  return Math.round(2 * 60_000 * Math.pow(1.55, level - 1))
}

export function deriveCapacity(levels: Record<string, number>): number {
  return BASE_CAPACITY + (levels.capacity ?? 0) * CAPACITY_PER_LEVEL
}

export function deriveNutritionMax(levels: Record<string, number>): number {
  return NUTRITION_BASE + (levels.nutrition_storage ?? 0) * NUTRITION_STORAGE_PER_LEVEL
}

export function deriveTrackModifiers(levels: Record<string, number>): { yieldMultiplier: number, tickMultiplier: number, feedMultiplier: number } {
  const yieldMultiplier = 1 + (levels.yield_boost ?? 0) * YIELD_TRACK_BONUS_PER_LEVEL
  const tickMultiplier = 1 - Math.min(MAX_SPEED_TRACK_REDUCTION, (levels.speed_boost ?? 0) * SPEED_TRACK_REDUCTION_PER_LEVEL)
  const feedMultiplier = 1 - Math.min(MAX_FEED_TRACK_REDUCTION, (levels.nutrition_efficiency ?? 0) * FEED_TRACK_REDUCTION_PER_LEVEL)
  return { yieldMultiplier, tickMultiplier, feedMultiplier }
}

/**
 * Habitat Level gates which bug tiers are purchasable at all (tier N species
 * require habitatLevel >= N). To raise it from L to L+1, every upgrade track
 * must first reach its OWN required level for that step — asymmetric, like
 * Clash of Clans' Town Hall requirements (e.g. reaching Habitat Level 2 might
 * need Nutrition Storage 3 but only Foraging Speed 1). Tracks with more
 * headroom (capacity/yield/storage go to level 20) are asked for more than
 * the two tracks capped at level 8, so nothing feels arbitrarily maxed out
 * early. One entry per habitat step (level 1→2 through 5→6).
 */
const HABITAT_TRACK_REQUIREMENTS: Record<UpgradeTrackId, number[]> = {
  capacity: [2, 4, 7, 10, 14],
  yield_boost: [2, 4, 7, 10, 14],
  speed_boost: [1, 3, 4, 6, 8],
  nutrition_storage: [3, 5, 8, 11, 15],
  nutrition_efficiency: [1, 3, 4, 6, 8]
}

export function habitatTrackRequirement(trackId: UpgradeTrackId, habitatLevel: number): number {
  const steps = HABITAT_TRACK_REQUIREMENTS[trackId]
  const step = steps[habitatLevel - 1]
  return step ?? steps[steps.length - 1] ?? 0
}

export const HABITAT_LEVEL_UP_COST = 500

// ─── Economy / cost curves ──────────────────────────────────────────────────

export const BASE_CAPACITY = 6
export const FEED_COST = 20
export const REMOVE_REFUND_RATE = 0.5
/** Nutrition tank size before any nutrition_storage upgrades. */
export const NUTRITION_BASE = 100
