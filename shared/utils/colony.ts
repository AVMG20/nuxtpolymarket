import { randomFloat, randomInt } from './random'

// Colony — shared game-balance config, used by both client and server.
// Static species/item/tier data lives here; only instance data (which bug,
// what traits it rolled, how much of each item is owned) is persisted.
//
// Pacing: COLONY is late-game content, priced off XENO T5/T6 income — you
// realistically start once you have ~100-200k coins. Bugs are expensive,
// produce every 1-30 minutes, and output CHUNKY quantities of cheap items:
// the game is about scale (many bugs, thousands of items), not waiting a day
// for one drop. Nutrition drains constantly and bugs stop foraging at 0, so
// players have to come back and feed. Habitat/track timers ramp from minutes
// into hours and days so reaching max Habitat Level takes roughly 90 days.

export interface ItemType {
  id: string
  name: string
  emoji: string
  tier: number
  /** Coins per unit when sold on the market */
  sellValue: number
}

// Sell values are solved against each species' yield roll range AND tick
// rate (see BUG_TYPES below) so average coins/hr — and payback, ~3.5-7 days
// across tiers — stay put. T1/T2 cycles were slowed down (4x / 1.5x) so a
// forager doesn't dump thousands of near-worthless items into storage over
// a day of AFK play; sell values were raised by the same factor so nothing
// about total income changed, only the item-count-vs-price split.
//
// Re-solved again when per-tick yield became a roll (see rollTickYield /
// avgTickYield below) instead of a flat number: average output per tick is
// now `1 + level/2`, not `level`, so it no longer matches the old flat
// value at any tier (it's higher at T1, lower at T5/6). Every sellValue
// below is scaled by (old avg / new avg) for its species' yield range so
// coins/hr is unchanged from before this mechanic switch.
//
// T4-T6 are additionally tuned around each species' intended temperament:
// social bugs grouped for their full bonus and solitary bugs kept alone.
// This keeps late-tier income climbing by roughly 2.3-3x per tier instead
// of leaving T4 flat and then jumping almost 6x at T5.
export const ITEM_TYPES: ItemType[] = [
  { id: 'silk', name: 'Silk Scrap', emoji: '🧵', tier: 1, sellValue: 50 },
  { id: 'loam', name: 'Rich Loam', emoji: '🧱', tier: 1, sellValue: 140 },
  { id: 'chitin', name: 'Chitin Shard', emoji: '🦴', tier: 2, sellValue: 375 },
  { id: 'shell_fragment', name: 'Shell Fragment', emoji: '🐚', tier: 2, sellValue: 500 },
  { id: 'resin', name: 'Amber Resin', emoji: '🟠', tier: 3, sellValue: 1500 },
  { id: 'pheromone', name: 'Pheromone Vial', emoji: '🧪', tier: 3, sellValue: 2400 },
  { id: 'venom', name: 'Venom Sac', emoji: '☠️', tier: 4, sellValue: 5500 },
  { id: 'carapace', name: 'Hardened Carapace', emoji: '🛡️', tier: 4, sellValue: 8500 },
  { id: 'ember_dust', name: 'Ember Dust', emoji: '🔥', tier: 5, sellValue: 28_000 },
  { id: 'royal_jelly', name: 'Royal Jelly', emoji: '🍯', tier: 6, sellValue: 90_000 }
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
  /** Ms between production ticks before the speed trait is applied — always 1m-30m */
  baseTickMs: number
  /** Lowest yield level this species can roll on purchase (always >= 1) */
  yieldMin: number
  /** Highest yield level this species can roll on purchase (climbs to MAX_YIELD_LEVEL at endgame) */
  yieldMax: number
  /** Lowest nutrition cost this species can roll per completed production tick (always >= 1) */
  eatMin: number
  /** Highest nutrition cost this species can roll per completed production tick */
  eatMax: number
  /** The item species this bug forages. Ignored (species should set producesGems instead) if producesGems is true. */
  itemId: string
  /** Coin cost to buy one of this species, once habitat level allows it */
  spawnCost: number
  description: string
  /** Social bugs get a speed boost from same-species peers; solitary bugs thrive alone and are penalized (slowed) when crowded */
  social: boolean
  /**
   * Special species that produce the user's gem currency instead of coins/
   * items — see effectiveGemsPerDay/gemTickMs. Cycle TIME stays fixed at a
   * ~24h base regardless of speed upgrades, but the gems earned per cycle
   * does scale with the Foraging Yield/Foraging Speed habitat tracks, hard
   * capped at MAX_GEMS_PER_DAY.
   */
  producesGems?: boolean
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

// Yield is a fixed, level-based stat — never a percentage. Every bug rolls a
// yield LEVEL on purchase (see rollYieldLevel below), and that level acts as
// a CEILING for its per-tick roll — every completed cycle actually drops
// 1 + random(0..level) items (see rollTickYield), never a flat number.
// Every bug always drops at least 1 item per cycle regardless of level.
//
// yieldMin/yieldMax/speed no longer scale with species tier at all — every
// species rolls from the exact same BASE range (1-2 yield, 0-25% speed) the
// first time you buy it. What actually differentiates species is bought
// with SWEAT, not coins: sacrificing a growing pile of a species' own bugs
// on the Research page raises that species' OWN roll range for every future
// purchase, up to 6-8 yield / 75% speed at max research (see
// RESEARCH_SPEED_MIN/MAX, RESEARCH_YIELD_MIN/MAX below). yieldMin/yieldMax
// on BUG_TYPES below is therefore just the level-0/pre-research range —
// identical for every species — kept on the type for clarity/display only.
//
// Tier still matters plenty: base cycle time, sell value of what's foraged,
// and spawn cost all still climb hard with tier (see baseTickMs/spawnCost
// below and ITEM_TYPES' sellValue) — a maxed-out T1 Larva is still nowhere
// near a maxed-out T6 Hive Empress, it just isn't handed a better dice roll
// for free anymore.
//
// eatMin/eatMax: like yield, a fixed level rolled once on purchase — not a
// percentage. Unlike yield it's a cost, not a reward: every time a bug
// COMPLETES a production tick it eats this many nutrition points, so a
// faster cycle (base or from the speed trait) means more meals per hour,
// not just more loot. The range still climbs with tier (5-8 at T1, up to
// 32-44 at T6), but because higher tiers also tick less often, effective
// nutrition/hr stays manageable across the whole roster —
// feeding stays a real cost at every tier instead of vanishing at endgame.
export const BUG_TYPES: BugType[] = [
  { id: 'larva', name: 'Larva', tier: 1, emoji: '🐛', color: 0x8ecae6, baseTickMs: 240_000, yieldMin: 1, yieldMax: 2, eatMin: 2, eatMax: 4, itemId: 'silk', spawnCost: 120_000, description: 'Hardy and quick — the fastest cycle in the colony. Every colony starts here.', social: true },
  { id: 'grub', name: 'Grub', tier: 1, emoji: '🪱', color: 0xa3b18a, baseTickMs: 600_000, yieldMin: 1, yieldMax: 2, eatMin: 2, eatMax: 4, itemId: 'loam', spawnCost: 180_000, description: 'Slower than a larva but churns out fat piles of loam.', social: false },
  { id: 'beetle', name: 'Beetle', tier: 2, emoji: '🪲', color: 0xffb703, baseTickMs: 450_000, yieldMin: 1, yieldMax: 2, eatMin: 4, eatMax: 7, itemId: 'chitin', spawnCost: 650_000, description: 'A sturdy, armored forager that does fine in a crowd.', social: true },
  { id: 'ladybug', name: 'Ladybug', tier: 2, emoji: '🐞', color: 0xe63946, baseTickMs: 720_000, yieldMin: 1, yieldMax: 2, eatMin: 4, eatMax: 7, itemId: 'shell_fragment', spawnCost: 900_000, description: 'Spotted and independent — prefers to forage alone.', social: false },
  { id: 'cricket', name: 'Cricket', tier: 3, emoji: '🦗', color: 0x90be6d, baseTickMs: 10 * 60_000, yieldMin: 1, yieldMax: 2, eatMin: 8, eatMax: 12, itemId: 'resin', spawnCost: 2_400_000, description: 'Chirps happily in a chorus of its own kind.', social: true },
  { id: 'ant', name: 'Ant', tier: 3, emoji: '🐜', color: 0x6f4e37, baseTickMs: 12 * 60_000, yieldMin: 1, yieldMax: 2, eatMin: 8, eatMax: 12, itemId: 'pheromone', spawnCost: 3_200_000, description: 'Tireless colonial workers — thrive together.', social: true },
  // Special: forages gems instead of coins/items. Fiercely solitary — a
  // 24h base cycle that only ever gets SLOWER when crowded, never faster.
  // Its per-CYCLE output (not the cycle's frequency) does ride the same
  // Foraging Yield/Foraging Speed habitat tracks every other bug rides —
  // see effectiveGemsPerDay — so a base, un-upgraded snail is very slow
  // (~1 gem/24h) and only reaches its MAX_GEMS_PER_DAY cap with real
  // investment in those tracks.
  { id: 'gem_snail', name: 'Gem Snail', tier: 3, emoji: '🐌', color: 0x4cc9f0, baseTickMs: 24 * 60 * 60_000, yieldMin: 1, yieldMax: 2, eatMin: 8, eatMax: 12, itemId: '', spawnCost: 4_000_000, description: 'A reclusive gem-forager — one per terrarium is plenty. Crowd it with its own kind and it slows to a crawl. Upgrading Foraging Yield or Foraging Speed lets it distill more per cycle.', social: false, producesGems: true },
  { id: 'spider', name: 'Spider', tier: 4, emoji: '🕷️', color: 0x9d4edd, baseTickMs: 15 * 60_000, yieldMin: 1, yieldMax: 2, eatMin: 14, eatMax: 20, itemId: 'venom', spawnCost: 7_000_000, description: 'A patient, territorial predator. Does not share well.', social: false },
  { id: 'scorpion', name: 'Scorpion', tier: 4, emoji: '🦂', color: 0xf77f00, baseTickMs: 20 * 60_000, yieldMin: 1, yieldMax: 2, eatMin: 14, eatMax: 20, itemId: 'carapace', spawnCost: 9_000_000, description: 'Armored, dangerous, and fiercely solitary.', social: false },
  { id: 'ember_roach', name: 'Ember Roach', tier: 5, emoji: '🪳', color: 0xff006e, baseTickMs: 24 * 60_000, yieldMin: 1, yieldMax: 2, eatMin: 22, eatMax: 30, itemId: 'ember_dust', spawnCost: 25_000_000, description: 'Legendary and nearly indestructible.', social: true },
  { id: 'hive_empress', name: 'Hive Empress', tier: 6, emoji: '🐝', color: 0xffd60a, baseTickMs: 30 * 60_000, yieldMin: 1, yieldMax: 2, eatMin: 32, eatMax: 44, itemId: 'royal_jelly', spawnCost: 80_000_000, description: 'A mythic queen. The absolute pinnacle of the colony.', social: true }
]

export function getBug(id: string): BugType | undefined {
  return BUG_TYPES.find(b => b.id === id)
}

export function bugsByTier(tier: number): BugType[] {
  return BUG_TYPES.filter(b => b.tier === tier)
}

// ─── Traits ─────────────────────────────────────────────────────────────────
// Every bug rolls three traits when bought, with very different shapes:
//   speed 0-25% — a percentage that reduces the time between production
//                 ticks. Purely cosmetic variance, re-rolled per purchase.
//   yield 1-8   — a FIXED LEVEL, not a percentage. Rolled once, and then
//                 stored on the bug — it's the exact number of items that
//                 bug drops per tick for as long as it's owned.
//   eat         — also a FIXED LEVEL, rolled within [eatMin, eatMax]. It's
//                 the nutrition a bug spends every time it COMPLETES a
//                 tick — eating is tied to production, not the clock, so a
//                 faster cycle means more meals per hour (see
//                 effectiveFeedPerHour below).
// All three are persisted per bug instance (not just derived from species)
// so future upgrade mechanics can raise or lower any one of them later.
// Social/solitary is fixed per species, not rolled.
//
// Speed and yield's roll RANGE is no longer fixed per species — it's driven
// by that species' Research level (see the Research section below), which
// starts at 0 (MAX_TRAIT_PCT/base yield range) for every species and is
// raised per-species by sacrificing bugs on the Research page.

/** Base (Research level 0) speed roll ceiling — every species starts here. */
export const MAX_TRAIT_PCT = 25

/** Highest yield level any species can ever roll, at max Research level. */
export const MAX_YIELD_LEVEL = 8

/** Roll a speed trait percentage within the given Research level's [min, max] (see RESEARCH_SPEED_MIN/MAX). */
export function rollTraitPct(researchLevel = 0): number {
  const lvl = Math.max(0, Math.min(MAX_RESEARCH_LEVEL, researchLevel))
  const min = RESEARCH_SPEED_MIN[lvl] ?? 0
  const max = RESEARCH_SPEED_MAX[lvl] ?? MAX_TRAIT_PCT
  return randomInt(min, max)
}

/** Roll a fixed yield LEVEL within the given Research level's [min, max] (see RESEARCH_YIELD_MIN/MAX) — stored once per bug instance, and acts as a ceiling for its per-tick roll (see rollTickYield). */
export function rollYieldLevel(researchLevel = 0): number {
  const lvl = Math.max(0, Math.min(MAX_RESEARCH_LEVEL, researchLevel))
  const min = RESEARCH_YIELD_MIN[lvl] ?? 1
  const max = RESEARCH_YIELD_MAX[lvl] ?? 2
  return randomInt(min, max)
}

/**
 * Roll the actual number of items a bug drops on ONE completed cycle: always
 * 1 + random(0..yieldLevel), mirroring XENO's own plant harvest roll
 * (rollYield in shared/utils/xeno/plants.ts). A bug's yield LEVEL is fixed
 * per-instance (rolled once at purchase), but the amount it drops each cycle
 * still varies tick to tick — a yield-5 bug always drops at least 1, up to
 * 6, never a flat number.
 */
export function rollTickYield(yieldLevel: number): number {
  return 1 + Math.floor(randomFloat() * (yieldLevel + 1))
}

/**
 * Expected value of rollTickYield — used wherever we need to settle many
 * ticks at once (offline catch-up) without actually rolling each one
 * individually. E[1 + random(0..n)] = 1 + n/2.
 */
export function avgTickYield(yieldLevel: number): number {
  return 1 + yieldLevel / 2
}

/** Roll a fixed eat rate for a species, uniform within [eatMin, eatMax]. */
export function rollEatRate(type: BugType): number {
  return randomInt(type.eatMin, type.eatMax)
}

// ─── Research (per-species roll upgrades) ──────────────────────────────────
// Every species starts at Research level 0 (base roll: 0-25% speed, 1-2
// yield — see MAX_TRAIT_PCT/BUG_TYPES). On the Research page, paying coins
// (see RESEARCH_COST_MULTIPLIERS) raises that species' research level, which
// widens the roll range every FUTURE purchase of that species uses —
// existing owned bugs keep whatever they already rolled. Four upgrades take
// a species from the base range all the way to 65-75% speed / 6-8 yield.
// This is deliberately the only way to get a strong roll on a given species —
// tier no longer hands out a better dice roll for free (see the BUG_TYPES
// doc comment above).

/** Highest Research level any species can reach (4 upgrades past base). */
export const MAX_RESEARCH_LEVEL = 4

/**
 * Coin cost to advance FROM the level at this index TO the next one, as a
 * multiple of the species' own spawn cost — indexed by current level (0-3).
 * Climbs by +15× each time: 50×, 65×, 80×, 95× the bug's price.
 */
export const RESEARCH_COST_MULTIPLIERS = [50, 65, 80, 95]

/** Coin cost to advance a species from `currentLevel` to the next, given its spawn cost, or null if already maxed. */
export function researchCost(currentLevel: number, spawnCost: number): number | null {
  const multiplier = RESEARCH_COST_MULTIPLIERS[currentLevel]
  return multiplier == null ? null : multiplier * spawnCost
}

// Speed ranges chain end-to-end as research climbs — each level's floor is
// the previous level's ceiling — so the roll only ever gets better, never
// overlaps backward.
export const RESEARCH_SPEED_MIN = [0, 25, 35, 50, 65]
export const RESEARCH_SPEED_MAX = [25, 35, 50, 65, 75]

// Yield ranges climb similarly, level 0 matching every species' BUG_TYPES
// base range and level 4 reaching MAX_YIELD_LEVEL's ceiling (8).
export const RESEARCH_YIELD_MIN = [1, 2, 3, 4, 6]
export const RESEARCH_YIELD_MAX = [2, 4, 5, 6, 8]

/** The [min, max] speed roll range a species currently purchases at, given its Research level. */
export function researchSpeedRange(level: number): [number, number] {
  const lvl = Math.max(0, Math.min(MAX_RESEARCH_LEVEL, level))
  return [RESEARCH_SPEED_MIN[lvl] ?? 0, RESEARCH_SPEED_MAX[lvl] ?? MAX_TRAIT_PCT]
}

/** The [min, max] yield roll range a species currently purchases at, given its Research level. */
export function researchYieldRange(level: number): [number, number] {
  const lvl = Math.max(0, Math.min(MAX_RESEARCH_LEVEL, level))
  return [RESEARCH_YIELD_MIN[lvl] ?? 1, RESEARCH_YIELD_MAX[lvl] ?? 2]
}

/**
 * Hard ceiling on combined speed (bug roll + habitat track + social), as a
 * percentage of base tick time removed. Every individual source is already
 * capped on its own, but stacking all three at their own max would still
 * reach a 20x tick-frequency multiplier (140% naively) — this caps the
 * worst case at a 6.67x tick-frequency multiplier instead, which is what
 * actually keeps a fully-upgraded colony from compounding into an absurd
 * number once combined with the yield track and terrarium capacity.
 */
export const MAX_TOTAL_SPEED_PCT = 85

/**
 * speedBonusPct is every OTHER source of speed — the Foraging Speed habitat
 * track's bonus and the Social trait's neighbor bonus/penalty (see
 * socialSpeedBonusPct) — expressed in percentage points and ADDED to the
 * bug's own rolled speed trait before the reduction is applied, not stacked
 * multiplicatively. A bug rolled at 20% speed with a +10-point combined
 * bonus ticks at -30%, not -(1-0.8*0.9) = -28%. The total can go negative
 * (a crowded solitary bug can tick SLOWER than its base time) but is
 * clamped at the top (see MAX_TOTAL_SPEED_PCT) so a tick can never hit zero
 * or go negative, and so the top end of the speed/yield/capacity stack
 * doesn't compound into an unreasonable number.
 */
export function effectiveTickMs(bug: { typeId: string, speed: number }, speedBonusPct = 0): number {
  const type = getBug(bug.typeId)
  if (!type) return Infinity
  const totalPct = Math.min(MAX_TOTAL_SPEED_PCT, bug.speed + speedBonusPct)
  return Math.round(type.baseTickMs * (1 - totalPct / 100))
}

/**
 * A bug's nutrition drain expressed as a per-hour rate — eat-per-tick times
 * how many ticks it completes an hour. Purely a conversion for the settle
 * loop / display purposes; the real mechanic is "eat this much per finished
 * cycle," so speed traits and the Foraging Speed track (which shorten
 * tickMs) directly raise this number, exactly like they raise item output.
 */
/** Whole nutrition points consumed whenever this bug completes one production cycle. */
export function effectiveEatPerTick(bug: { eat: number }, feedMultiplier = 1): number {
  return Math.max(1, Math.ceil(bug.eat * feedMultiplier))
}

export function effectiveFeedPerHour(bug: { typeId: string, speed: number, eat: number }, speedBonusPct = 0, feedMultiplier = 1): number {
  const tickMs = effectiveTickMs(bug, speedBonusPct)
  if (!Number.isFinite(tickMs) || tickMs <= 0) return 0
  return effectiveEatPerTick(bug, feedMultiplier) * (3_600_000 / tickMs)
}

// ─── Social trait ───────────────────────────────────────────────────────────
// Social species tick FASTER from same-species peers. Solitary species thrive
// alone and tick SLOWER as their own kind crowds in. This is a speed effect,
// not a yield effect — see socialSpeedBonusPct below.

export const SOCIAL_BONUS_PER_PEER = 0.15
export const SOCIAL_MAX_BONUS = 0.45
export const SOLITARY_BONUS_ALONE = 0.45
export const SOLITARY_PENALTY_PER_PEER = 0.15
export const SOLITARY_MIN_MULTIPLIER = 0.4

/** sameSpeciesCount includes the bug itself. Expressed as a multiplier (1 = no effect) purely so the 1-based math below reads naturally; see socialSpeedBonusPct for the percentage-point form actually applied to tick time. */
export function socialMultiplier(typeId: string, sameSpeciesCount: number): number {
  const type = getBug(typeId)
  if (!type) return 1
  const peers = Math.max(0, sameSpeciesCount - 1)
  if (type.social) {
    return 1 + Math.min(SOCIAL_MAX_BONUS, peers * SOCIAL_BONUS_PER_PEER)
  }
  return Math.max(SOLITARY_MIN_MULTIPLIER, 1 + SOLITARY_BONUS_ALONE - peers * SOLITARY_PENALTY_PER_PEER)
}

/**
 * Social's speed contribution, in percentage points — ADDED to a bug's own
 * rolled Speed trait and the Foraging Speed habitat bonus (see
 * effectiveTickMs), not stacked as a further multiplier on top of them.
 * Social species gain up to +45% speed from same-species neighbors;
 * solitary species gain +45% alone but lose 15%/neighbor as their own kind
 * crowds in, down to a floor. Does NOT affect yield/output per cycle at all.
 */
export function socialSpeedBonusPct(typeId: string, sameSpeciesCount: number): number {
  return (socialMultiplier(typeId, sameSpeciesCount) - 1) * 100
}

// ─── Gem-producing bugs ─────────────────────────────────────────────────────
// A small number of species (see BugType.producesGems) forage the user's
// gem currency instead of coins/items, on a fixed 24h base CYCLE TIME that
// stays completely separate from the normal speed-trait/Foraging Speed
// stack — a gem bug always ticks once every ~24h, never faster, however
// much speed a player has invested. The only thing that can still move the
// cycle TIME is crowding (still solitary — see socialMultiplier), and only
// in the SLOWER direction.
//
// What DOES ride the normal Foraging Yield/Foraging Speed habitat tracks is
// the AMOUNT of gems earned per completed cycle (see effectiveGemsPerDay) —
// "upgrade the bug with more speed or yield and it yields 2-3/24h" — hard
// capped at MAX_GEMS_PER_DAY regardless of how far those tracks are pushed.
// A base, un-upgraded snail nets ~1 gem/24h (deliberately very slow); by the
// time a player has the Foraging Yield/Speed levels a T3 unlock requires
// (see HABITAT_TRACK_REQUIREMENTS) they should land right around that same
// ~1/24h floor, with real extra investment beyond that needed to reach 2-3.

export const MAX_GEMS_PER_DAY = 3
/** Extra colony-wide yield LEVELS (from the Foraging Yield track) it takes to add +1 gem/cycle. */
export const GEM_YIELD_LEVELS_PER_GEM = 12
/** Extra colony-wide speed percentage points (from the Foraging Speed track) it takes to add +1 gem/cycle. */
export const GEM_SPEED_PCT_PER_GEM = 35

/** Fixed 24h-scale cycle time for a gem-producing bug — immune to the bug's own speed roll and the Foraging Speed habitat track. Crowding (solitary penalty) can still lengthen it, never shorten it below base. */
export function gemTickMs(bug: { typeId: string }, sameSpeciesCount: number): number {
  const type = getBug(bug.typeId)
  if (!type) return Infinity
  const crowdingMultiplier = Math.min(1, socialMultiplier(bug.typeId, sameSpeciesCount))
  return Math.round(type.baseTickMs / crowdingMultiplier)
}

/**
 * Gems produced per completed ~24h cycle. Starts at a flat 1 (very slow on
 * purpose) and climbs with EITHER the Foraging Yield track (the bug's own
 * rolled yield level plus the track's flat level bonus, see
 * deriveTrackModifiers) OR the Foraging Speed track's bonus percentage —
 * either path alone can reach the MAX_GEMS_PER_DAY cap. Deliberately reads
 * only the TRACK-level bonuses (not the bug's own random speed roll or its
 * social/solitary trait) so the baseline stays predictable rather than
 * swinging on RNG or the automatic solitary-alone bonus.
 */
export function effectiveGemsPerDay(bug: { yield: number }, yieldLevelBonus = 0, speedBonusPct = 0): number {
  const yieldGems = Math.floor(((bug.yield - 1) + yieldLevelBonus) / GEM_YIELD_LEVELS_PER_GEM)
  const speedGems = Math.floor(speedBonusPct / GEM_SPEED_PCT_PER_GEM)
  return Math.min(MAX_GEMS_PER_DAY, 1 + yieldGems + speedGems)
}

// ─── Item costs ─────────────────────────────────────────────────────────────
// A generic {coins, items[]} price used by upgrades, so progression naturally
// requires owning higher-tier bugs rather than just grinding coins — and
// creates a real sell-for-cash-vs-hoard-for-upgrades choice.

export interface ItemCost {
  itemTypeId: string
  quantity: number
}

export interface Price {
  coins: number
  items: ItemCost[]
}

// ─── Upgrade tracks (single-builder queue) ──────────────────────────────────
// Everything that makes the colony objectively better — more slots, faster
// bugs, bigger yields, a deeper nutrition tank, leaner eating — is one of a
// handful of leveled tracks. Each level costs coins + items (the required
// item tier climbs as the track levels up) and takes real time to build.
// There is exactly one builder: only one track can be under construction at
// a time. Habitat Level (which gates which bug tiers are purchasable) only
// advances once every track has reached a required level.

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
    maxLevel: 15,
    effectLabel: level => `${BASE_CAPACITY + level * CAPACITY_PER_LEVEL} bug slots`
  },
  {
    id: 'yield_boost',
    name: 'Foraging Yield',
    icon: 'i-lucide-trending-up',
    description: 'Every bug\'s yield level rises, colony-wide.',
    maxLevel: 12,
    effectLabel: level => `+${level * YIELD_TRACK_LEVELS_PER_LEVEL} yield levels`
  },
  {
    id: 'speed_boost',
    name: 'Foraging Speed',
    icon: 'i-lucide-zap',
    description: 'Every bug ticks faster, colony-wide.',
    maxLevel: 8,
    effectLabel: level => `+${Math.round(Math.min(MAX_SPEED_TRACK_REDUCTION, level * SPEED_TRACK_REDUCTION_PER_LEVEL) * 100)}% speed`
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
// sliver. Yield is now added as flat LEVELS (not a percentage) directly onto
// every bug's own rolled yield level, colony-wide, so it compounds without a
// cap the same way a bug's own yield roll does; speed/feed reductions cap
// out well before their track's max level so a maxed track reads as
// "maxed" rather than pointless.
export const YIELD_TRACK_LEVELS_PER_LEVEL = 2
export const SPEED_TRACK_REDUCTION_PER_LEVEL = 0.1
export const MAX_SPEED_TRACK_REDUCTION = 0.7
export const FEED_TRACK_REDUCTION_PER_LEVEL = 0.1
export const MAX_FEED_TRACK_REDUCTION = 0.7
export const NUTRITION_STORAGE_PER_LEVEL = 5000
export const CAPACITY_PER_LEVEL = 2

/** Item tier required to fund a given track level — climbs every 3 levels. */
function trackItemTier(level: number): number {
  return Math.min(MAX_TIER, 1 + Math.floor((level - 1) / 3))
}

/**
 * Roughly how many items/hr one bug of the given tier forages (average yield
 * roll × ticks/hr, averaged across that tier's species) — used to size
 * upgrade item costs against real production rates.
 */
const TIER_ITEM_HOURLY_RATE: Record<number, number> = {
  1: 16,
  2: 20,
  3: 22,
  4: 18,
  5: 15,
  6: 14
}

/**
 * How much an earlier tier's item requirement shrinks per tier step back
 * from the level's own demanded tier — tier-1 items are required at ~55% of
 * the current tier's quantity, tier-2 at ~30%, and so on. Keeps early bugs
 * (Larva/Grub, Beetle/Ladybug, ...) relevant deep into the game instead of
 * being obsoleted the moment a player moves on to the next tier.
 */
const EARLIER_TIER_COST_DECAY = 0.55

/**
 * Cost to build a track up TO `level` (i.e. level = currentLevel + 1).
 * Coins are the real wall — 100k at level 1, ×1.55 per level (~30M by 14,
 * ~400M at 20). Item quantities are sized off the demanded tier's foraging
 * rate: early levels ≈ a few hours of one bug's output, late levels ≈ days
 * of a whole squad's. Every level also splinters in a smaller helping of
 * every EARLIER tier's items too (see EARLIER_TIER_COST_DECAY), so reaching
 * a high-tier upgrade still requires having kept earlier-tier bugs foraging
 * along the way, not just the current tier's squad.
 */
export function trackLevelCost(level: number): Price {
  const tier = trackItemTier(level)
  const items: ItemCost[] = []
  for (let t = 1; t <= tier; t++) {
    const rate = TIER_ITEM_HOURLY_RATE[t] ?? 10
    const decay = Math.pow(EARLIER_TIER_COST_DECAY, tier - t)
    const quantity = Math.max(10, Math.round(rate * 3 * Math.pow(1.3, level - 1) * decay / 5) * 5)
    for (const item of itemsByTier(t)) items.push({ itemTypeId: item.id, quantity })
  }
  const coins = Math.round(100_000 * Math.pow(1.55, level - 1) / 1000) * 1000
  return { coins, items }
}

/**
 * Build time to reach `level`: 1.5h at level 1, ×1.5 per level, capped at 3
 * days. Track construction totals ~66 days through the Level 6 requirements;
 * habitat-level construction brings the full critical path to ~82 days.
 */
export function trackLevelDurationMs(level: number): number {
  const raw = 1.5 * 3600_000 * Math.pow(1.5, level - 1)
  return Math.round(Math.min(3 * 24 * 3600_000, raw))
}

export function deriveCapacity(levels: Record<string, number>): number {
  return BASE_CAPACITY + (levels.capacity ?? 0) * CAPACITY_PER_LEVEL
}

export function deriveNutritionMax(levels: Record<string, number>): number {
  return NUTRITION_BASE + (levels.nutrition_storage ?? 0) * NUTRITION_STORAGE_PER_LEVEL
}

export function deriveTrackModifiers(levels: Record<string, number>): { yieldLevelBonus: number, speedBonusPct: number, feedMultiplier: number } {
  // Flat yield LEVELS, added directly to each bug's own rolled yield level
  // (see rollTickYield/avgTickYield) rather than a multiplier on output.
  const yieldLevelBonus = (levels.yield_boost ?? 0) * YIELD_TRACK_LEVELS_PER_LEVEL
  // Percentage points, added directly to each bug's own rolled speed (see
  // effectiveTickMs) rather than stacked as a second multiplicative factor.
  const speedBonusPct = Math.min(MAX_SPEED_TRACK_REDUCTION, (levels.speed_boost ?? 0) * SPEED_TRACK_REDUCTION_PER_LEVEL) * 100
  const feedMultiplier = 1 - Math.min(MAX_FEED_TRACK_REDUCTION, (levels.nutrition_efficiency ?? 0) * FEED_TRACK_REDUCTION_PER_LEVEL)
  return { yieldLevelBonus, speedBonusPct, feedMultiplier }
}

/**
 * Habitat Level gates which bug tiers are purchasable at all (tier N species
 * require habitatLevel >= N). To raise it from L to L+1, every upgrade track
 * must first reach its OWN required level for that step — asymmetric, like
 * Clash of Clans' Town Hall requirements. Tracks with more headroom
 * (capacity/yield/storage go to level 20) are asked for more than the two
 * tracks capped at level 8. One entry per habitat step (1→2 through 5→6).
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

/** Coin cost to raise habitat from `level` to `level + 1`: 250k → 1M → 4M → 16M → 64M. */
export function habitatLevelUpCost(level: number): number {
  return Math.round(250_000 * Math.pow(4, level - 1) / 1000) * 1000
}

/** Builder time to raise habitat from `level` to `level + 1`: 12h → 1d → 2d → 4d → 8d. */
export function habitatLevelUpDurationMs(level: number): number {
  return 12 * 3600_000 * Math.pow(2, Math.max(0, level - 1))
}

/** Sentinel stored in colonyState.builderTrackId while the builder raises the habitat itself. */
export const HABITAT_BUILDER_JOB_ID = 'habitat_level'

/** Gem cost bounds for habitat level-ups: the first step costs the least, the final step (to Level 6) costs the most. */
export const HABITAT_GEM_COST_MIN = 20
export const HABITAT_GEM_COST_MAX = 1000

/**
 * Gem cost to raise habitat from `level` to `level + 1` — a second, gem-
 * denominated wall alongside the coin cost above, exponential across the 5
 * level-up steps: 20 → 53 → 141 → 376 → 1000 gems. Gems only come from
 * selling on the gem market, Gem Snails, or other gem-earning content, so
 * this makes Habitat Level a real long-term gem sink too, not just a coin
 * one.
 */
export function habitatLevelUpGemCost(level: number): number {
  const steps = MAX_TIER - 1
  const t = steps <= 1 ? 0 : Math.min(1, (level - 1) / (steps - 1))
  const cost = HABITAT_GEM_COST_MIN * Math.pow(HABITAT_GEM_COST_MAX / HABITAT_GEM_COST_MIN, t)
  return Math.round(cost / 5) * 5
}

// ─── Economy / cost curves ──────────────────────────────────────────────────

export const BASE_CAPACITY = 6
/**
 * Coins per missing nutrition point when feeding. Nutrition/hr is now driven
 * by eatMin/eatMax × ticks/hr (see BUG_TYPES) rather than a flat per-species
 * rate, which lands around ~40-100/hr per bug — roughly 10x the old flat
 * rates — so this constant was cut from 80 to 5 to match. At the floor roll
 * a Larva still hands back over half its gross income as food; the margin
 * widens fast from T2 onward as ticks/hr drop faster than eat cost climbs.
 */
export const FEED_COST_PER_POINT = 5
export const REMOVE_REFUND_RATE = 0.5
/**
 * Nutrition tank size before any nutrition_storage upgrades. Raised 20x
 * alongside the eat-per-tick rework (a full 6-slot starter colony of fast
 * T1 bugs can now drain 400-600/hr, versus under 50/hr under the old flat
 * feedPerHour model) so a starter colony still gets a several-hour runway
 * before starving instead of minutes.
 */
export const NUTRITION_BASE = 3000

// ─── Gem feed (premium nutrition booster) ──────────────────────────────────
// A second, gem-funded nutrition pool that always drains BEFORE regular
// coin-fed nutrition and grants every non-gem bug a flat colony-wide boost
// for as long as any of it remains: +1 yield (added to the per-instance
// yield LEVEL before the per-tick roll, so a level-5 bug rolls as if it
// were level 6) and +20% speed (additive, same as every other speed
// source — see effectiveTickMs). Expensive on purpose — this is a burst
// booster, not a replacement for regular feeding.

export const GEM_FEED_NUTRITION_PER_GEM = 200
export const GEM_FEED_MAX_NUTRITION_PCT_PER_GEM = 0.015
export const GEM_FEED_YIELD_BONUS = 1
export const GEM_FEED_SPEED_BONUS_PCT = 20

/** Nutrition bought by one gem: at least 200, scaling to 1.5% of the user's maximum tank. */
export function gemFeedNutritionPerGem(nutritionMax: number): number {
  return Math.max(GEM_FEED_NUTRITION_PER_GEM, Math.ceil(nutritionMax * GEM_FEED_MAX_NUTRITION_PCT_PER_GEM))
}

/** Gems required to add `nutritionPoints` to the gem-fed pool (rounded up — gems are whole). */
export function gemFeedCost(nutritionPoints: number, nutritionMax = NUTRITION_BASE): number {
  return Math.ceil(nutritionPoints / gemFeedNutritionPerGem(nutritionMax))
}
