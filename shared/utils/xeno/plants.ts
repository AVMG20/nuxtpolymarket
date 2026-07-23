import { randomFloat } from '../random'
import { SPEED_REDUCTION_PER_LEVEL, MAX_SPEED_REDUCTION } from './tiers'

export interface PlantType {
  id: string
  name: string
  tier: number
  emoji: string
  /** Tailwind color key for plant-specific theming (e.g. 'lime', 'amber', 'rose') */
  color: string
  /** Base grow time in seconds before speed reduction is applied */
  baseTime: number
  /** Speed level: each point reduces grow time by SPEED_REDUCTION_PER_LEVEL% */
  speed: number
  /** Yield level: you always get 1 + random(0..yield) plants on harvest */
  yield: number
  /** Base sell value */
  value: number
  description: string
  isStarter?: boolean
  /** Void plants require a Void-Touched artifact in the grid slot to grow */
  voidPlant?: boolean
}

// ─── T1 — Starter tier ──────────────────────────────────────────────────────
// Max speed: 1 | Max yield: 1
// Base times 3-7 min. Distributed stats across plants.

export const T1_PLANTS: PlantType[] = [
  {
    id: 'sprout',
    name: 'Sprout',
    tier: 1, emoji: '🌱', color: 'slate',
    baseTime: 360,   // 6 min, no speed bonus → 6 min effective
    speed: 0, yield: 1, value: 6,
    description: 'The most basic xenoflora. Reliable starter plant.',
    isStarter: true,
  },
  {
    id: 'tendril',
    name: 'Tendril',
    tier: 1, emoji: '🌿', color: 'slate',
    baseTime: 300,   // 5 min base, speed 1 → 270s (4.5 min) effective
    speed: 1, yield: 1, value: 7,
    description: 'A fast-growing vine. Faster than Sprout, same yield.',
    isStarter: true,
  },
  {
    id: 'dustbloom',
    name: 'Dustbloom',
    tier: 1, emoji: '🌻', color: 'slate',
    baseTime: 180,   // 3 min — ultra-fast filler
    speed: 0, yield: 1, value: 3,
    description: 'Ultra-fast filler. Grows in 3 min. Perfect artifact material.',
  },
  {
    id: 'glowshroom',
    name: 'Glowshroom',
    tier: 1, emoji: '🍄', color: 'slate',
    baseTime: 330,   // 5.5 min base, speed 1 → 297s (≈5 min) effective
    speed: 1, yield: 1, value: 16,
    description: 'Bioluminescent mutation. Max T1 stats — rare from T1 breeding.',
  },
]

// ─── T2 — Developed tier ────────────────────────────────────────────────────
// Max speed: 2 | Max yield: 2
// Diverse base times and value distribution. Some slow+valuable, some fast+cheap.

export const T2_PLANTS: PlantType[] = [
  {
    id: 'bloom',
    name: 'Bloom',
    tier: 2, emoji: '🌸', color: 'sky',
    baseTime: 1800,  // 30 min, speed 0 → 30 min effective
    speed: 0, yield: 2, value: 25,
    description: 'High-yield xenoflower. Slow but produces up to 3 per harvest.',
  },
  {
    id: 'creeper',
    name: 'Creeper',
    tier: 2, emoji: '🍃', color: 'sky',
    baseTime: 1200,  // 20 min base, speed 2 → 960s (16 min) effective
    speed: 2, yield: 1, value: 30,
    description: 'Fast-spreading T2 organism. High speed, low yield.',
  },
  {
    id: 'fernite',
    name: 'Fernite',
    tier: 2, emoji: '🌾', color: 'sky',
    baseTime: 2700,  // 45 min base, speed 1 → 2430s (40.5 min) effective
    speed: 1, yield: 1, value: 48,
    description: 'Balanced T2 plant with high sell value. Slower cycle.',
  },
  {
    id: 'ashvine',
    name: 'Ashvine',
    tier: 2, emoji: '🍀', color: 'sky',
    baseTime: 720,   // 12 min, speed 1 → 648s effective
    speed: 1, yield: 1, value: 21,
    description: 'Fast T2 plant. Good for stacking artifact costs.',
  },
  {
    id: 'crystal-bud',
    name: 'Crystal Bud',
    tier: 2, emoji: '💎', color: 'sky',
    baseTime: 1500,  // 25 min base, speed 2 → 1200s (20 min) effective
    speed: 2, yield: 2, value: 60,
    description: 'Rare crystalline mutation. Max T2 speed and yield.',
  },
]

// ─── T3 — Advanced tier ─────────────────────────────────────────────────────
// Max speed: 3 | Max yield: 3
// Long cycles, much higher values.

export const T3_PLANTS: PlantType[] = [
  {
    id: 'crystal-vine',
    name: 'Crystal Vine',
    tier: 3, emoji: '🔮', color: 'violet',
    baseTime: 7200,  // 2h base, speed 1 → 6480s (1h48m) effective
    speed: 1, yield: 3, value: 78,
    description: 'Majestic vine with crystal nodes. Highest T3 yield (1-4 per harvest).',
  },
  {
    id: 'phantom-leaf',
    name: 'Phantom Leaf',
    tier: 3, emoji: '🌙', color: 'violet',
    baseTime: 4200,  // 70 min base, speed 3 → 2940s (49 min) effective
    speed: 3, yield: 1, value: 69,
    description: 'Quantum-shifted organism. Fastest T3 grow time, minimal yield.',
  },
  {
    id: 'voidbloom',
    name: 'Voidbloom',
    tier: 3, emoji: '🌑', color: 'violet',
    baseTime: 9000,  // 2.5h base, speed 0 → 9000s (2.5h) effective
    speed: 0, yield: 2, value: 101,
    description: 'High-value T3 plant. Slow cycle, good yield, premium price.',
  },
  {
    id: 'emberfern',
    name: 'Emberfern',
    tier: 3, emoji: '🌺', color: 'violet',
    baseTime: 5400,  // 1.5h, speed 2 → 4320s effective
    speed: 2, yield: 1, value: 83,
    description: 'Balanced T3. Needed for T4 mutation recipes.',
  },
  {
    id: 'xenoform',
    name: 'Xenoform',
    tier: 3, emoji: '🌀', color: 'violet',
    baseTime: 5400,  // 1.5h base, speed 3 → 3780s (63 min) effective
    speed: 3, yield: 3, value: 124,
    description: 'Alien organism of unknown origin. Max T3 stats. Extremely rare.',
  },
]

// ─── T4 — Elite tier ────────────────────────────────────────────────────────
// Max speed: 4 | Max yield: 4
// Grow 1.5h–5h. High value, key ingredients for T5 mutations.

export const T4_PLANTS: PlantType[] = [
  {
    id: 'deepfrond',
    name: 'Deepfrond',
    tier: 4, emoji: '🌴', color: 'orange',
    baseTime: 18000, // 5h
    speed: 0, yield: 4, value: 291,
    description: 'Extreme yield, very slow. Key ingredient for T5 mutations.',
  },
  {
    id: 'swiftcane',
    name: 'Swiftcane',
    tier: 4, emoji: '🎋', color: 'orange',
    baseTime: 5400,  // 1.5h, speed 4 → 3240s effective
    speed: 4, yield: 1, value: 174,
    description: 'Max T4 speed. Great for grid artifact material.',
  },
  {
    id: 'crystalmoss',
    name: 'Crystalmoss',
    tier: 4, emoji: '🪴', color: 'orange',
    baseTime: 10800, // 3h, speed 2 → 8640s effective
    speed: 2, yield: 2, value: 235,
    description: 'Balanced T4. Reliable income, used in top artifacts.',
  },
  {
    id: 'voidfern',
    name: 'Voidfern',
    tier: 4, emoji: '🌵', color: 'orange',
    baseTime: 14400, // 4h, speed 1 → 12960s effective
    speed: 1, yield: 3, value: 269,
    description: 'High yield T4. Slow but valuable. Filler for T5 recipes.',
  },
  {
    id: 'abyssform',
    name: 'Abyssform',
    tier: 4, emoji: '🌲', color: 'orange',
    baseTime: 14400, // 4h, speed 4 → 8640s effective
    speed: 4, yield: 4, value: 470,
    description: 'Max T4. Rare mutation. Required for Cosmosbloom.',
  },
]

// ─── T5 — Cosmic tier ───────────────────────────────────────────────────────
// Max speed: 5 | Max yield: 5
// Grow 5h–12h. The pinnacle of xenoflora.

export const T5_PLANTS: PlantType[] = [
  {
    id: 'starweave',
    name: 'Starweave',
    tier: 5, emoji: '⭐', color: 'rose',
    baseTime: 28800, // 8h, speed 2 → 23040s effective
    speed: 2, yield: 5, value: 715,
    description: 'Extreme yield T5. Slow but the best passive income plant.',
  },
  {
    id: 'voidpulse',
    name: 'Voidpulse',
    tier: 5, emoji: '🌌', color: 'rose',
    baseTime: 18000, // 5h, speed 5 → 9000s effective
    speed: 5, yield: 1, value: 572,
    description: 'Max T5 speed. Fastest plant in the game. Artifact machine.',
  },
  {
    id: 'cosmosbloom',
    name: 'Cosmosbloom',
    tier: 5, emoji: '🌟', color: 'rose',
    baseTime: 43200, // 12h, speed 3 → 30240s effective
    speed: 3, yield: 3, value: 935,
    description: 'Premium balanced T5. Expensive to grow, high returns.',
  },
  {
    id: 'etherform',
    name: 'Voidweave',
    tier: 5, emoji: '✨', color: 'rose',
    baseTime: 36000, // 10h, speed 5 → 18000s effective
    speed: 5, yield: 5, value: 1650,
    description: 'Void plant. Max T5 stats. Requires a tier II or higher artifact to grow.',
    voidPlant: true,
  },
]

// ─── T6 — Ethereal tier ─────────────────────────────────────────────────────
// Max speed: 6 | Max yield: 6
// Grow 16h–36h. Far beyond T5 — astronomically rare.

export const T6_PLANTS: PlantType[] = [
  {
    id: 'dawnrift',
    name: 'Dawnrift',
    tier: 6, emoji: '☄️', color: 'fuchsia',
    baseTime: 57600,  // 16h, speed 6 → 23040s (6.4h) effective
    speed: 6, yield: 1, value: 3456,
    description: 'Blazing T6 organism. Fastest in its tier. Prime artifact material.',
  },
  {
    id: 'voidlattice',
    name: 'Voidlattice',
    tier: 6, emoji: '🪸', color: 'fuchsia',
    baseTime: 129600, // 36h, speed 0 → 36h effective
    speed: 0, yield: 6, value: 3024,
    description: 'Crystalline void structure. Massive yield, glacial growth.',
  },
  {
    id: 'nexusbloom',
    name: 'Nexusbloom',
    tier: 6, emoji: '🌊', color: 'fuchsia',
    baseTime: 86400,  // 24h, speed 3 → 60480s (16.8h) effective
    speed: 3, yield: 3, value: 4536,
    description: 'Balanced T6. Key ingredient for upper-tier mutations.',
  },
  {
    id: 'stellarfrond',
    name: 'Stellarfrond',
    tier: 6, emoji: '💫', color: 'fuchsia',
    baseTime: 86400,  // 24h, speed 5 → 43200s (12h) effective
    speed: 5, yield: 4, value: 7020,
    description: 'Fast T6 with strong yield. Essential for high-tier artifact crafting.',
  },
  {
    id: 'aetherix',
    name: 'Voidrix',
    tier: 6, emoji: '🧿', color: 'fuchsia',
    baseTime: 108000, // 30h, speed 6 → 43200s (12h) effective
    speed: 6, yield: 6, value: 12960,
    description: 'Void plant. Max T6 stats. Requires a tier II or higher artifact to grow.',
    voidPlant: true,
  },
]

// ─── T7 — Singularity tier ──────────────────────────────────────────────────
// Max speed: 7 | Max yield: 7
// Grow 36h–72h. The absolute apex of xenoflora.

export const T7_PLANTS: PlantType[] = [
  {
    id: 'tempest-spike',
    name: 'Tempest Spike',
    tier: 7, emoji: '🌪️', color: 'amber',
    baseTime: 129600, // 36h, speed 7 → 38880s (10.8h) effective
    speed: 7, yield: 1, value: 14840,
    description: 'Fastest T7 organism. Hypercharged artifact machine.',
  },
  {
    id: 'abyssal-frond',
    name: 'Abyssal Frond',
    tier: 7, emoji: '🔱', color: 'amber',
    baseTime: 259200, // 72h, speed 0 → 72h effective
    speed: 0, yield: 7, value: 11660,
    description: 'Extreme yield over a punishing 3-day cycle. Max T7 yield.',
  },
  {
    id: 'quantum-bloom',
    name: 'Quantum Bloom',
    tier: 7, emoji: '❄️', color: 'amber',
    baseTime: 172800, // 48h, speed 4 → 103680s (28.8h) effective
    speed: 4, yield: 4, value: 21200,
    description: 'Balanced T7. Rare from T6 crossing.',
  },
  {
    id: 'starcore',
    name: 'Starcore',
    tier: 7, emoji: '🌠', color: 'amber',
    baseTime: 216000, // 60h, speed 6 → 86400s (24h) effective
    speed: 6, yield: 5, value: 37100,
    description: 'Near-max T7 stats. Requires crossing max T6 plants.',
  },
  {
    id: 'singularity',
    name: 'Void Apex',
    tier: 7, emoji: '💥', color: 'amber',
    baseTime: 172800, // 48h, speed 7 → 51840s (14.4h) effective
    speed: 7, yield: 7, value: 53000,
    description: 'Void plant. Max T7 stats. The rarest organism in existence.',
    voidPlant: true,
  },
]

// ─── T8 — Transcendent tier ────────────────────────────────────────────────

export const T8_PLANTS: PlantType[] = [
  {
    id: 'solar-needle', name: 'Solar Needle',
    tier: 8, emoji: '🌞', color: 'cyan',
    baseTime: 259200, speed: 8, yield: 2, value: 468_000,
    description: 'A fast transcendent organism built for rapid high-value cycling.',
  },
  {
    id: 'nebula-root', name: 'Nebula Root',
    tier: 8, emoji: '🫚', color: 'cyan',
    baseTime: 518400, speed: 1, yield: 8, value: 374_400,
    description: 'Slow-growing cosmic roots that return an enormous harvest.',
  },
  {
    id: 'eventide-bloom', name: 'Eventide Bloom',
    tier: 8, emoji: '🌒', color: 'cyan',
    baseTime: 345600, speed: 5, yield: 5, value: 780_000,
    description: 'A balanced flower suspended between stellar dusk and dawn.',
  },
  {
    id: 'gravity-vine', name: 'Gravity Vine',
    tier: 8, emoji: '🪐', color: 'cyan',
    baseTime: 432000, speed: 7, yield: 6, value: 1_248_000,
    description: 'Dense vines that bend cultivation time around their fruit.',
  },
  {
    id: 'void-orchid', name: 'Void Orchid',
    tier: 8, emoji: '🪷', color: 'cyan',
    baseTime: 345600, speed: 8, yield: 8, value: 2_496_000,
    description: 'Transcendent Void plant with maximum T8 stats.',
    voidPlant: true,
  },
]

// ─── T9 — Omega tier ───────────────────────────────────────────────────────

export const T9_PLANTS: PlantType[] = [
  {
    id: 'chronofrond', name: 'Chronofrond',
    tier: 9, emoji: '⏳', color: 'primary',
    baseTime: 345600, speed: 9, yield: 3, value: 2_472_000,
    description: 'An Omega organism that grows across several timelines at once.',
  },
  {
    id: 'darkmatter-pod', name: 'Darkmatter Pod',
    tier: 9, emoji: '⚫', color: 'primary',
    baseTime: 691200, speed: 2, yield: 9, value: 1_545_000,
    description: 'A glacial pod whose harvest carries impossible density.',
  },
  {
    id: 'galaxy-bloom', name: 'Galaxy Bloom',
    tier: 9, emoji: '🌌', color: 'primary',
    baseTime: 518400, speed: 6, yield: 6, value: 3_708_000,
    description: 'A balanced Omega flower containing a miniature spiral galaxy.',
  },
  {
    id: 'reality-thorn', name: 'Reality Thorn',
    tier: 9, emoji: '🌀', color: 'primary',
    baseTime: 432000, speed: 8, yield: 8, value: 4_635_000,
    description: 'Near-perfect xenoflora that punctures the edge of reality.',
  },
  {
    id: 'omega-core', name: 'Omega Core',
    tier: 9, emoji: '🌐', color: 'primary',
    baseTime: 518400, speed: 9, yield: 9, value: 9_270_000,
    description: 'The final Void organism. Maximum speed, yield, and value.',
    voidPlant: true,
  },
]

export const PLANT_TYPES: PlantType[] = [
  ...T1_PLANTS,
  ...T2_PLANTS,
  ...T3_PLANTS,
  ...T4_PLANTS,
  ...T5_PLANTS,
  ...T6_PLANTS,
  ...T7_PLANTS,
  ...T8_PLANTS,
  ...T9_PLANTS,
]

export function getPlant(id: string): PlantType | undefined {
  return PLANT_TYPES.find(p => p.id === id)
}

export function getPlantOrThrow(id: string): PlantType {
  const p = getPlant(id)
  if (!p) throw new Error(`Unknown plant type: ${id}`)
  return p
}

/** Effective grow time in seconds after applying speed reduction */
export function effectiveGrowTime(plant: PlantType | { baseTime: number; speed: number }): number {
  const reduction = Math.min(MAX_SPEED_REDUCTION, plant.speed * SPEED_REDUCTION_PER_LEVEL)
  return Math.round(plant.baseTime * (1 - reduction))
}

/** Roll harvest yield: always 1 + random(0..plantYield) */
export function rollYield(plantYield: number): number {
  return 1 + Math.floor(randomFloat() * (plantYield + 1))
}

/** Breed duration = max(baseTime(p1), baseTime(p2)) × 2 — speed does not affect breeding */
export function breedDuration(
  p1: { baseTime: number },
  p2: { baseTime: number },
): number {
  return Math.max(p1.baseTime, p2.baseTime) * 2
}

/** Average sell value per cycle (accounting for yield) — used for market sorting */
export function avgYield(plant: PlantType): number {
  const avgHarvest = 1 + plant.yield / 2
  return plant.value * avgHarvest
}

/** Marketplace buy price for a plant (≈ 2× value, scaled by yield and speed). */
export function plantBuyPrice(plant: { value: number; yield: number; speed: number }): number {
  return Math.round(plant.value * 2 * (1 + plant.yield) * (1 + plant.speed * 0.05))
}
