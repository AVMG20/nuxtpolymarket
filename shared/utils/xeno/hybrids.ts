import { randomFloat, randomInt } from '../random'
import { PLANT_TYPES, getPlant, effectiveGrowTime, type PlantType } from './plants'

/**
 * ─── Hybrids ─────────────────────────────────────────────────────────────────
 *
 * A hybrid is an ordinary `xeno_plants` row. Its full composition — each
 * resource plant PLUS that resource's own speed/yield level — is encoded into
 * its `typeId`:
 *
 *   typeId = "hybrid:" + sorted("<id>~<speed>~<yield>").join("+")
 *          → "hybrid:abyssform~4~3+swiftcane~2~1"
 *
 * Because each distinct composition (incl. per-resource stats) yields a unique
 * typeId, the existing (typeId, speed, yield) identity used for inventory
 * grouping, stacking, planting and selling keeps working unchanged — no schema
 * change needed. Hybrid rows carry speed=0/yield=0 in their own columns; all the
 * meaningful stats live per-resource inside the typeId.
 *
 * Everything else (emoji, name, grow time, …) is DERIVED at read time — never
 * stored. The hybrid itself has NO sell value; it is only a vessel.
 *
 * When harvested, a hybrid produces every resource at its own speed/yield in
 * `rollYield(resourceYield)` quantity, and regrows itself to the SAME total
 * count as that combined harvest (so the hybrid farm can scale).
 */

export const HYBRID_PREFIX = 'hybrid:'

/** One resource inside a hybrid: a plant type with its own stat levels. */
export interface HybridResource {
  id: string
  speed: number
  yield: number
}

/** A resource enriched with its plant-config display fields. */
export interface HybridResourceDisplay extends HybridResource {
  name: string
  emoji: string
  tier: number
}

/** Lowest tier that must be FULLY unlocked to access the Hybrid vendor. */
export const HYBRID_UNLOCK_TIER = 4

/** Highest plant tier that exists in the game. */
export const XENO_MAX_TIER = Math.max(...PLANT_TYPES.map(p => p.tier))

export function isHybrid(typeId: string): boolean {
  return typeId.startsWith(HYBRID_PREFIX)
}

/** Build the canonical hybrid typeId from resources (sorted by id → order-independent). */
export function makeHybridTypeId(resources: HybridResource[]): string {
  const parts = [...resources]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(r => `${r.id}~${r.speed}~${r.yield}`)
  return HYBRID_PREFIX + parts.join('+')
}

/**
 * Parse the resources (id + per-resource speed/yield) out of a hybrid typeId.
 * Returns [] for non-hybrids. Tolerates the legacy "<id>" form (no stats) by
 * falling back to the plant's base stats.
 */
export function parseHybridResources(typeId: string): HybridResource[] {
  if (!isHybrid(typeId)) return []
  return typeId.slice(HYBRID_PREFIX.length).split('+').filter(Boolean).map((part) => {
    const [id, s, y] = part.split('~')
    const base = getPlant(id!)
    return {
      id: id!,
      speed: s != null ? Number(s) : (base?.speed ?? 0),
      yield: y != null ? Number(y) : (base?.yield ?? 0),
    }
  })
}

/** Rarity table: number of resources (K) → relative weight. 4-resource ≈ 5%. */
export const HYBRID_RARITY: { k: number; w: number }[] = [
  { k: 1, w: 65 },
  { k: 2, w: 22 },
  { k: 3, w: 8 },
  { k: 4, w: 5 },
]

/** Plants eligible to appear as hybrid resources at the given tier (no void plants). */
export function hybridResourcePool(maxTier: number): PlantType[] {
  return PLANT_TYPES.filter(p => p.tier <= maxTier && !p.voidPlant)
}

/** All plant types belonging to a tier. */
export function plantsOfTier(tier: number): PlantType[] {
  return PLANT_TYPES.filter(p => p.tier === tier)
}

/**
 * The hybrid tier a player has earned: the highest tier for which they have
 * unlocked EVERY plant. Hybrids roll resources/stats up to this tier.
 * Returns 0 if no tier is fully unlocked.
 */
export function hybridTierFromUnlocked(unlockedTypeIds: string[]): number {
  const set = new Set(unlockedTypeIds)
  let best = 0
  for (let t = 1; t <= XENO_MAX_TIER; t++) {
    const plants = plantsOfTier(t)
    if (plants.length > 0 && plants.every(p => set.has(p.id))) best = t
  }
  return best
}

export interface TierUnlockProgress {
  tier: number
  unlocked: number
  total: number
  missing: { id: string; name: string; emoji: string }[]
}

/** How close the player is to fully unlocking a given tier (for the UI). */
export function tierUnlockProgress(tier: number, unlockedTypeIds: string[]): TierUnlockProgress {
  const set = new Set(unlockedTypeIds)
  const plants = plantsOfTier(tier)
  const missing = plants.filter(p => !set.has(p.id)).map(p => ({ id: p.id, name: p.name, emoji: p.emoji }))
  return { tier, total: plants.length, unlocked: plants.length - missing.length, missing }
}

function weightedRarityK(): number {
  const total = HYBRID_RARITY.reduce((s, r) => s + r.w, 0)
  let roll = randomFloat() * total
  for (const r of HYBRID_RARITY) {
    roll -= r.w
    if (roll < 0) return r.k
  }
  return 1
}

function pickDistinct<T>(arr: T[], count: number): T[] {
  const pool = [...arr]
  const out: T[] = []
  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(randomFloat() * pool.length)
    out.push(pool.splice(idx, 1)[0]!)
  }
  return out
}

/**
 * Roll a fresh hybrid for a player whose hybrid tier is `maxTier`.
 * Picks K distinct resources via the rarity table; EACH resource gets its own
 * speed/yield rolled uniformly in 0..maxTier. Called server-side only.
 */
export function rollHybrid(maxTier: number): { resources: HybridResource[] } {
  const k = weightedRarityK()
  const pool = hybridResourcePool(maxTier)
  const resources = pickDistinct(pool, k).map(p => ({
    id: p.id,
    speed: randomInt(0, maxTier),
    yield: randomInt(0, maxTier),
  }))
  return { resources }
}

/** Enrich raw resources with plant-config display fields. */
export function enrichHybridResources(resources: HybridResource[]): HybridResourceDisplay[] {
  return resources.map((r) => {
    const p = getPlant(r.id)
    return { ...r, name: p?.name ?? r.id, emoji: p?.emoji ?? '❓', tier: p?.tier ?? 0 }
  })
}

/**
 * Effective grow time of a hybrid: the MAX of each resource's speed-adjusted
 * grow time. A hybrid grows all its resources in parallel, so it only takes
 * as long as its slowest component — never the sum of all of them.
 */
export function hybridGrowSeconds(resources: HybridResource[]): number {
  const parts = resources.map(r => ({ base: getPlant(r.id), speed: r.speed })).filter(p => p.base)
  return parts.reduce((s, p) => Math.max(s, effectiveGrowTime({ baseTime: p.base!.baseTime, speed: p.speed })), 0)
}

export interface PlantDisplay {
  id: string
  name: string
  emoji: string
  tier: number
  color: string
  /** For hybrids this is already the speed-adjusted (effective) grow time (max over resources). */
  baseTime: number
  value: number
  description: string
  isHybrid: boolean
  /** Enriched resources (empty for normal plants) */
  resources: HybridResourceDisplay[]
}

/** Display/computed properties for a hybrid typeId, derived from its resources. */
export function getHybridDisplay(typeId: string): PlantDisplay {
  const resources = enrichHybridResources(parseHybridResources(typeId))
  const first = resources[0]
  const tier = resources.length ? Math.max(...resources.map(r => r.tier)) : 1
  return {
    id: typeId,
    name: 'Hybrid',
    emoji: first?.emoji ?? '🧬',
    tier,
    color: 'primary',
    baseTime: hybridGrowSeconds(resources),
    value: 0, // a hybrid is only a vessel — no sell value
    description: resources.length
      ? `Vessel hybrid — produces ${resources.map(r => r.name).join(', ')} when harvested.`
      : 'Vessel hybrid.',
    isHybrid: true,
    resources,
  }
}

/** Unified display props for both normal plants and hybrids. Returns null for unknown ids. */
export function getPlantDisplay(typeId: string): PlantDisplay | null {
  if (isHybrid(typeId)) return getHybridDisplay(typeId)
  const p = getPlant(typeId)
  if (!p) return null
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    tier: p.tier,
    color: p.color,
    baseTime: p.baseTime,
    value: p.value,
    description: p.description,
    isHybrid: false,
    resources: [],
  }
}

/**
 * Flat gem cost of one hybrid roll, based only on the player's hybrid tier.
 * T4 = 4 gems, +2 per tier above that (T5 = 6, T6 = 8, …).
 */
export function hybridGemCost(tier: number): number {
  if (tier < HYBRID_UNLOCK_TIER) return 0
  return 4 + 2 * (tier - HYBRID_UNLOCK_TIER)
}
