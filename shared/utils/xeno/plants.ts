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
  isMutation?: boolean
}

// ─── T1 — Starter tier ──────────────────────────────────────────────────────
// Max speed: 1 | Max yield: 1
// Base times 3-7 min. Distributed stats across plants.

export const T1_PLANTS: PlantType[] = [
  {
    id: 'sprout',
    name: 'Sprout',
    tier: 1, emoji: '🌱', color: 'lime',
    baseTime: 360,   // 6 min, no speed bonus → 6 min effective
    speed: 0, yield: 1, value: 5,
    description: 'The most basic xenoflora. Reliable starter plant.',
    isStarter: true,
  },
  {
    id: 'tendril',
    name: 'Tendril',
    tier: 1, emoji: '🌿', color: 'green',
    baseTime: 300,   // 5 min base, speed 1 → 270s (4.5 min) effective
    speed: 1, yield: 1, value: 6,
    description: 'A fast-growing vine. Faster than Sprout, same yield.',
    isStarter: true,
  },
  {
    id: 'dustbloom',
    name: 'Dustbloom',
    tier: 1, emoji: '🌻', color: 'yellow',
    baseTime: 180,   // 3 min — ultra-fast filler
    speed: 0, yield: 0, value: 3,
    description: 'Ultra-fast filler. Grows in 3 min. Perfect artifact material.',
    isStarter: true,
  },
  {
    id: 'glowshroom',
    name: 'Glowshroom',
    tier: 1, emoji: '🍄', color: 'amber',
    baseTime: 330,   // 5.5 min base, speed 1 → 297s (≈5 min) effective
    speed: 1, yield: 1, value: 14,
    description: 'Bioluminescent mutation. Max T1 stats — rare from T1 breeding.',
    isMutation: true,
  },
]

// ─── T2 — Developed tier ────────────────────────────────────────────────────
// Max speed: 2 | Max yield: 2
// Diverse base times and value distribution. Some slow+valuable, some fast+cheap.

export const T2_PLANTS: PlantType[] = [
  {
    id: 'bloom',
    name: 'Bloom',
    tier: 2, emoji: '🌸', color: 'rose',
    baseTime: 1800,  // 30 min, speed 0 → 30 min effective
    speed: 0, yield: 2, value: 22,
    description: 'High-yield xenoflower. Slow but produces up to 3 per harvest.',
  },
  {
    id: 'creeper',
    name: 'Creeper',
    tier: 2, emoji: '🍃', color: 'teal',
    baseTime: 1200,  // 20 min base, speed 2 → 960s (16 min) effective
    speed: 2, yield: 0, value: 26,
    description: 'Fast-spreading T2 organism. Low yield, high speed.',
  },
  {
    id: 'fernite',
    name: 'Fernite',
    tier: 2, emoji: '🌾', color: 'emerald',
    baseTime: 2700,  // 45 min base, speed 1 → 2430s (40.5 min) effective
    speed: 1, yield: 1, value: 42,
    description: 'Balanced T2 plant with high sell value. Slower cycle.',
  },
  {
    id: 'ashvine',
    name: 'Ashvine',
    tier: 2, emoji: '🍀', color: 'cyan',
    baseTime: 720,   // 12 min, speed 1 → 648s effective
    speed: 1, yield: 0, value: 18,
    description: 'Fast T2 plant. Low value but great for stacking artifact costs.',
  },
  {
    id: 'crystal-bud',
    name: 'Crystal Bud',
    tier: 2, emoji: '💎', color: 'sky',
    baseTime: 1500,  // 25 min base, speed 2 → 1200s (20 min) effective
    speed: 2, yield: 2, value: 52,
    description: 'Rare crystalline mutation. Max T2 speed and yield.',
    isMutation: true,
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
    speed: 1, yield: 3, value: 68,
    description: 'Majestic vine with crystal nodes. Highest T3 yield (1-4 per harvest).',
  },
  {
    id: 'phantom-leaf',
    name: 'Phantom Leaf',
    tier: 3, emoji: '🌙', color: 'indigo',
    baseTime: 4200,  // 70 min base, speed 3 → 2940s (49 min) effective
    speed: 3, yield: 0, value: 60,
    description: 'Quantum-shifted organism. Fastest T3 grow time, no yield bonus.',
  },
  {
    id: 'voidbloom',
    name: 'Voidbloom',
    tier: 3, emoji: '🌑', color: 'slate',
    baseTime: 9000,  // 2.5h base, speed 0 → 9000s (2.5h) effective
    speed: 0, yield: 2, value: 88,
    description: 'High-value T3 plant. Slow cycle, good yield, premium price.',
  },
  {
    id: 'emberfern',
    name: 'Emberfern',
    tier: 3, emoji: '🌺', color: 'orange',
    baseTime: 5400,  // 1.5h, speed 2 → 4320s effective
    speed: 2, yield: 1, value: 72,
    description: 'Balanced T3. Needed for T4 mutation recipes.',
  },
  {
    id: 'xenoform',
    name: 'Xenoform',
    tier: 3, emoji: '🌀', color: 'fuchsia',
    baseTime: 5400,  // 1.5h base, speed 3 → 3780s (63 min) effective
    speed: 3, yield: 3, value: 108,
    description: 'Alien organism of unknown origin. Max T3 stats. Extremely rare.',
    isMutation: true,
  },
]

// ─── T4 — Elite tier ────────────────────────────────────────────────────────
// Max speed: 4 | Max yield: 4
// Grow 1.5h–5h. High value, key ingredients for T5 mutations.

export const T4_PLANTS: PlantType[] = [
  {
    id: 'deepfrond',
    name: 'Deepfrond',
    tier: 4, emoji: '🌴', color: 'emerald',
    baseTime: 18000, // 5h
    speed: 0, yield: 4, value: 260,
    description: 'Extreme yield, very slow. Key ingredient for T5 mutations.',
  },
  {
    id: 'swiftcane',
    name: 'Swiftcane',
    tier: 4, emoji: '🎋', color: 'lime',
    baseTime: 5400,  // 1.5h, speed 4 → 3240s effective
    speed: 4, yield: 0, value: 155,
    description: 'Max T4 speed. Great for grid artifact material.',
  },
  {
    id: 'crystalmoss',
    name: 'Crystalmoss',
    tier: 4, emoji: '🪴', color: 'blue',
    baseTime: 10800, // 3h, speed 2 → 8640s effective
    speed: 2, yield: 2, value: 210,
    description: 'Balanced T4. Reliable income, used in top artifacts.',
  },
  {
    id: 'voidfern',
    name: 'Voidfern',
    tier: 4, emoji: '🌵', color: 'stone',
    baseTime: 14400, // 4h, speed 1 → 12960s effective
    speed: 1, yield: 3, value: 240,
    description: 'High yield T4. Slow but valuable. Filler for T5 recipes.',
  },
  {
    id: 'abyssform',
    name: 'Abyssform',
    tier: 4, emoji: '🌲', color: 'purple',
    baseTime: 14400, // 4h, speed 4 → 8640s effective
    speed: 4, yield: 4, value: 420,
    description: 'Max T4. Rare mutation. Required for Cosmosbloom.',
    isMutation: true,
  },
]

// ─── T5 — Cosmic tier ───────────────────────────────────────────────────────
// Max speed: 5 | Max yield: 5
// Grow 5h–12h. The pinnacle of xenoflora.

export const T5_PLANTS: PlantType[] = [
  {
    id: 'starweave',
    name: 'Starweave',
    tier: 5, emoji: '⭐', color: 'amber',
    baseTime: 28800, // 8h, speed 2 → 23040s effective
    speed: 2, yield: 5, value: 650,
    description: 'Extreme yield T5. Slow but the best passive income plant.',
  },
  {
    id: 'voidpulse',
    name: 'Voidpulse',
    tier: 5, emoji: '🌌', color: 'indigo',
    baseTime: 18000, // 5h, speed 5 → 9000s effective
    speed: 5, yield: 0, value: 520,
    description: 'Max T5 speed. Fastest plant in the game. Artifact machine.',
  },
  {
    id: 'cosmosbloom',
    name: 'Cosmosbloom',
    tier: 5, emoji: '🌟', color: 'pink',
    baseTime: 43200, // 12h, speed 3 → 30240s effective
    speed: 3, yield: 3, value: 850,
    description: 'Premium balanced T5. Expensive to grow, high returns.',
  },
  {
    id: 'etherform',
    name: 'Etherform',
    tier: 5, emoji: '✨', color: 'cyan',
    baseTime: 36000, // 10h, speed 5 → 18000s effective
    speed: 5, yield: 5, value: 1500,
    description: 'The rarest plant. Max stats. Only obtainable via mutation.',
    isMutation: true,
  },
]

export const PLANT_TYPES: PlantType[] = [
  ...T1_PLANTS,
  ...T2_PLANTS,
  ...T3_PLANTS,
  ...T4_PLANTS,
  ...T5_PLANTS,
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
  return 1 + Math.floor(Math.random() * (plantYield + 1))
}

/** Breed duration = max(effectiveTime(p1), effectiveTime(p2)) × 2 */
export function breedDuration(
  p1: { baseTime: number; speed: number },
  p2: { baseTime: number; speed: number },
): number {
  return Math.max(effectiveGrowTime(p1), effectiveGrowTime(p2)) * 2
}

/** Average sell value per cycle (accounting for yield) — used for market sorting */
export function avgYield(plant: PlantType): number {
  const avgHarvest = 1 + plant.yield / 2
  return plant.value * avgHarvest
}
