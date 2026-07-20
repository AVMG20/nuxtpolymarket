export type ArtifactEffectType =
  | 'breeder_extra_yield'
  | 'breeder_mutation_boost'
  | 'breeder_speed_boost'
  | 'grid_yield_bonus'
  | 'grid_speed_boost'

/** % speed reduction per display level for artifacts (5% per level, max level 10 = 50%) */
export const ARTIFACT_SPEED_PER_LEVEL = 0.05

/** % mutation boost per display level for breeder artifacts (5% per level) */
export const ARTIFACT_MUTATION_PER_LEVEL = 0.05

export interface ArtifactEffect {
  type: ArtifactEffectType
  value: number
}

export interface ArtifactType {
  id: string
  name: string
  emoji: string
  description: string
  /** Tier within its family: 1 = base through 5 = endgame T8/T9 artifact. */
  level: number
  maxCharges: number
  effects: ArtifactEffect[]
  cost: { plantTypeId: string; quantity: number }[]
}

export function getEffectValue(art: ArtifactType, type: ArtifactEffectType): number {
  return art.effects.find(e => e.type === type)?.value ?? 0
}

export function hasEffect(art: ArtifactType, type: ArtifactEffectType): boolean {
  return art.effects.some(e => e.type === type)
}

// ─── Gem crafting ────────────────────────────────────────────────────────────
// An artifact can be crafted with gems to gain +1 display level on EVERY effect
// it already has (absent effects are never granted). This maps each effect type
// to the raw value that "+1 level" represents.
export const ARTIFACT_GEM_LEVEL_INCREMENT: Record<ArtifactEffectType, number> = {
  grid_speed_boost: ARTIFACT_SPEED_PER_LEVEL,
  grid_yield_bonus: 1,
  breeder_speed_boost: ARTIFACT_SPEED_PER_LEVEL,
  breeder_extra_yield: 1,
  breeder_mutation_boost: ARTIFACT_MUTATION_PER_LEVEL,
}

/** Gem cost to gem-craft an artifact = its tier level (e.g. Mutation Booster II → 2 gems). */
export function gemCraftCost(art: ArtifactType): number {
  return art.level
}

/**
 * Effective value of one effect, accounting for a gem-crafted +1 level.
 * Effects the artifact doesn't have (base 0) are never granted by gem crafting.
 */
export function getEffectValueFor(art: ArtifactType, type: ArtifactEffectType, gemCrafted = false): number {
  const base = getEffectValue(art, type)
  if (!gemCrafted || base === 0) return base
  return base + ARTIFACT_GEM_LEVEL_INCREMENT[type]
}

/** The artifact's effects with the gem-craft +1 level applied to each present effect. */
export function effectiveEffects(art: ArtifactType, gemCrafted = false): ArtifactEffect[] {
  if (!gemCrafted) return art.effects
  return art.effects.map(e => ({ type: e.type, value: e.value + ARTIFACT_GEM_LEVEL_INCREMENT[e.type] }))
}

// ─── Display stats ─────────────────────────────────────────────────────────────
// A single source of truth for the level/dot-bar rows shown on every artifact card
// (shop, inventory). Speed & mutation are stored as percentages; these convert them
// to whole "display levels" (5% per level) and provide the max dot count + colour.

/** Display level for a speed/mutation percentage value (5% = 1 level). */
function toDisplayLevel(pct: number, per: number) { return Math.round(Math.round(pct * 1000) / Math.round(per * 1000)) }
const toSpeedLevel = (pct: number) => toDisplayLevel(pct, ARTIFACT_SPEED_PER_LEVEL)
const toMutLevel   = (pct: number) => Math.ceil(Math.round(pct * 1000) / Math.round(ARTIFACT_MUTATION_PER_LEVEL * 1000))

const _max = (type: ArtifactEffectType, toLevel: (v: number) => number) =>
  Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === type).map(e => toLevel(e.value))), 1)

// Lazily memoised — ARTIFACT_TYPES is declared further down this module, so these
// can't be computed eagerly at module-init time (temporal dead zone).
let _maxLevels: Record<ArtifactEffectType, number> | null = null
function maxLevels(): Record<ArtifactEffectType, number> {
  return _maxLevels ??= {
    grid_speed_boost: _max('grid_speed_boost', toSpeedLevel),
    grid_yield_bonus: _max('grid_yield_bonus', v => v),
    breeder_speed_boost: _max('breeder_speed_boost', toSpeedLevel),
    breeder_extra_yield: _max('breeder_extra_yield', v => v),
    breeder_mutation_boost: _max('breeder_mutation_boost', toMutLevel),
  }
}

export interface ArtifactStatRow {
  label: 'Speed' | 'Yield' | 'Mutation'
  /** Display level (0 = effect absent, row should be hidden). */
  level: number
  /** Number of dots in the bar. */
  max: number
  /** Tailwind bg-* class for filled dots. */
  color: string
}

/**
 * The level/dot-bar rows to render for an artifact card, accounting for gem crafting
 * (which adds +1 level to every present effect, and one extra dot to the bar).
 * Rows with level 0 are kept so callers can filter — the artifact simply lacks that effect.
 */
export function artifactStatRows(art: ArtifactType, gemCrafted = false): ArtifactStatRow[] {
  const effects = effectiveEffects(art, gemCrafted)
  const val = (type: ArtifactEffectType) => effects.find(e => e.type === type)?.value ?? 0
  const bump = gemCrafted ? 1 : 0
  const max = maxLevels()

  if (art.effects.some(e => e.type.startsWith('grid_'))) {
    return [
      { label: 'Speed', level: toSpeedLevel(val('grid_speed_boost')), max: max.grid_speed_boost + bump, color: 'bg-warning' },
      { label: 'Yield', level: val('grid_yield_bonus'),               max: max.grid_yield_bonus + bump, color: 'bg-info' },
    ]
  }
  return [
    { label: 'Speed',    level: toSpeedLevel(val('breeder_speed_boost')), max: max.breeder_speed_boost + bump, color: 'bg-warning' },
    { label: 'Yield',    level: val('breeder_extra_yield'),               max: max.breeder_extra_yield + bump, color: 'bg-info' },
    { label: 'Mutation', level: toMutLevel(val('breeder_mutation_boost')), max: max.breeder_mutation_boost + bump,  color: 'bg-secondary' },
  ]
}

export const ARTIFACT_TYPES: ArtifactType[] = [
  // ─── Grid: speed boost (pure) ────────────────────────────────────────────
  {
    id: 'speed-rune',
    name: 'Speed Rune',
    emoji: '⚡',
    description: 'Grid: −10% grow time. Best for early cycling.',
    level: 1, maxCharges: 8,
    effects: [{ type: 'grid_speed_boost', value: 0.10 }],
    cost: [{ plantTypeId: 'tendril', quantity: 15 }, { plantTypeId: 'dustbloom', quantity: 10 }],
  },
  {
    id: 'speed-rune-ii',
    name: 'Speed Rune II',
    emoji: '⚡',
    description: 'Grid: −25% grow time. Significant cycle reduction.',
    level: 2, maxCharges: 11,
    effects: [{ type: 'grid_speed_boost', value: 0.25 }],
    cost: [{ plantTypeId: 'creeper', quantity: 10 }, { plantTypeId: 'phantom-leaf', quantity: 4 }],
  },
  {
    id: 'speed-rune-iii',
    name: 'Speed Rune III',
    emoji: '⚡',
    description: 'Grid: −40% grow time. Best pure speed artifact below T6.',
    level: 3, maxCharges: 14,
    effects: [{ type: 'grid_speed_boost', value: 0.40 }],
    cost: [{ plantTypeId: 'swiftcane', quantity: 5 }, { plantTypeId: 'voidpulse', quantity: 2 }],
  },
  {
    id: 'speed-rune-iv',
    name: 'Speed Rune IV',
    emoji: '⚡',
    description: 'Grid: −50% grow time. Maximum speed. Requires T6 plants.',
    level: 4, maxCharges: 17,
    effects: [{ type: 'grid_speed_boost', value: 0.50 }],
    cost: [{ plantTypeId: 'dawnrift', quantity: 4 }, { plantTypeId: 'stellarfrond', quantity: 2 }],
  },
  {
    id: 'speed-rune-v',
    name: 'Speed Rune V',
    emoji: '⚡',
    description: 'Grid: −60% grow time. Transcendent speed forged from T8/T9 plants.',
    level: 5, maxCharges: 20,
    effects: [{ type: 'grid_speed_boost', value: 0.60 }],
    cost: [{ plantTypeId: 'solar-needle', quantity: 4 }, { plantTypeId: 'chronofrond', quantity: 2 }],
  },

  // ─── Grid: yield bonus (pure) ─────────────────────────────────────────────
  {
    id: 'yield-crystal',
    name: 'Yield Crystal',
    emoji: '💠',
    description: 'Grid: +1 yield per harvest. Reliable starter yield boost.',
    level: 1, maxCharges: 8,
    effects: [{ type: 'grid_yield_bonus', value: 1 }],
    cost: [{ plantTypeId: 'sprout', quantity: 12 }, { plantTypeId: 'dustbloom', quantity: 10 }],
  },
  {
    id: 'yield-crystal-ii',
    name: 'Yield Crystal II',
    emoji: '💠',
    description: 'Grid: +3 yield per harvest. Strong mid-game yield artifact.',
    level: 2, maxCharges: 11,
    effects: [{ type: 'grid_yield_bonus', value: 3 }],
    cost: [{ plantTypeId: 'bloom', quantity: 8 }, { plantTypeId: 'ashvine', quantity: 6 }],
  },
  {
    id: 'yield-crystal-iii',
    name: 'Yield Crystal III',
    emoji: '💠',
    description: 'Grid: +5 yield per harvest. Best pure yield artifact. Requires T4 plants.',
    level: 3, maxCharges: 14,
    effects: [{ type: 'grid_yield_bonus', value: 5 }],
    cost: [{ plantTypeId: 'deepfrond', quantity: 3 }, { plantTypeId: 'voidfern', quantity: 4 }],
  },
  {
    id: 'yield-crystal-iv',
    name: 'Yield Crystal IV',
    emoji: '💠',
    description: 'Grid: +7 yield per harvest. Maximum grid yield. Requires T6 plants.',
    level: 4, maxCharges: 17,
    effects: [{ type: 'grid_yield_bonus', value: 7 }],
    cost: [{ plantTypeId: 'voidlattice', quantity: 3 }, { plantTypeId: 'nexusbloom', quantity: 2 }],
  },
  {
    id: 'yield-crystal-v',
    name: 'Yield Crystal V',
    emoji: '💠',
    description: 'Grid: +10 yield per harvest. Omega-grade abundance.',
    level: 5, maxCharges: 20,
    effects: [{ type: 'grid_yield_bonus', value: 10 }],
    cost: [{ plantTypeId: 'nebula-root', quantity: 4 }, { plantTypeId: 'darkmatter-pod', quantity: 2 }],
  },

  // ─── Grid: hybrid (speed + yield) ────────────────────────────────────────
  {
    id: 'harvest-prism',
    name: 'Harvest Prism',
    emoji: '🔷',
    description: 'Grid: −5% grow time & +1 yield. Versatile early hybrid.',
    level: 1, maxCharges: 8,
    effects: [
      { type: 'grid_speed_boost', value: 0.05 },
      { type: 'grid_yield_bonus', value: 1 },
    ],
    cost: [{ plantTypeId: 'fernite', quantity: 5 }, { plantTypeId: 'ashvine', quantity: 5 }],
  },
  {
    id: 'harvest-prism-ii',
    name: 'Harvest Prism II',
    emoji: '🔷',
    description: 'Grid: −15% grow time & +2 yield. Solid T3 hybrid.',
    level: 2, maxCharges: 11,
    effects: [
      { type: 'grid_speed_boost', value: 0.15 },
      { type: 'grid_yield_bonus', value: 2 },
    ],
    cost: [{ plantTypeId: 'emberfern', quantity: 4 }, { plantTypeId: 'crystalmoss', quantity: 3 }],
  },
  {
    id: 'harvest-prism-iii',
    name: 'Harvest Prism III',
    emoji: '🔷',
    description: 'Grid: −25% grow time & +3 yield. Premium T5 hybrid.',
    level: 3, maxCharges: 14,
    effects: [
      { type: 'grid_speed_boost', value: 0.25 },
      { type: 'grid_yield_bonus', value: 3 },
    ],
    cost: [{ plantTypeId: 'cosmosbloom', quantity: 2 }, { plantTypeId: 'starweave', quantity: 2 }],
  },
  {
    id: 'harvest-prism-iv',
    name: 'Harvest Prism IV',
    emoji: '🔷',
    description: 'Grid: −35% grow time & +6 yield. Pinnacle hybrid. Requires T6/T7 plants.',
    level: 4, maxCharges: 17,
    effects: [
      { type: 'grid_speed_boost', value: 0.35 },
      { type: 'grid_yield_bonus', value: 6 },
    ],
    cost: [{ plantTypeId: 'aetherix', quantity: 2 }, { plantTypeId: 'quantum-bloom', quantity: 1 }],
  },
  {
    id: 'harvest-prism-v',
    name: 'Harvest Prism V',
    emoji: '🔷',
    description: 'Grid: −45% grow time & +9 yield. The ultimate cultivation hybrid.',
    level: 5, maxCharges: 20,
    effects: [
      { type: 'grid_speed_boost', value: 0.45 },
      { type: 'grid_yield_bonus', value: 9 },
    ],
    cost: [{ plantTypeId: 'gravity-vine', quantity: 3 }, { plantTypeId: 'galaxy-bloom', quantity: 2 }],
  },

  // ─── Breeder: yield + speed (Growth Catalyst) ────────────────────────────
  {
    id: 'growth-catalyst',
    name: 'Growth Catalyst',
    emoji: '⚗️',
    description: 'Breeder: +3 yield, −10% breed time. Best yield & speed at tier I.',
    level: 1, maxCharges: 3,
    effects: [
      { type: 'breeder_speed_boost', value: 0.10 },
      { type: 'breeder_extra_yield', value: 3 },
    ],
    cost: [{ plantTypeId: 'sprout', quantity: 12 }],
  },
  {
    id: 'growth-catalyst-ii',
    name: 'Growth Catalyst II',
    emoji: '⚗️',
    description: 'Breeder: +5 yield, −20% breed time. Best yield & speed at tier II.',
    level: 2, maxCharges: 4,
    effects: [
      { type: 'breeder_speed_boost', value: 0.20 },
      { type: 'breeder_extra_yield', value: 5 },
    ],
    cost: [{ plantTypeId: 'fernite', quantity: 8 }, { plantTypeId: 'bloom', quantity: 5 }],
  },
  {
    id: 'growth-catalyst-iii',
    name: 'Growth Catalyst III',
    emoji: '⚗️',
    description: 'Breeder: +6 yield, −30% breed time. Strong yield & speed. Excellent for farming.',
    level: 3, maxCharges: 5,
    effects: [
      { type: 'breeder_speed_boost', value: 0.30 },
      { type: 'breeder_extra_yield', value: 6 },
    ],
    cost: [{ plantTypeId: 'crystalmoss', quantity: 5 }, { plantTypeId: 'voidfern', quantity: 3 }],
  },
  {
    id: 'growth-catalyst-iv',
    name: 'Growth Catalyst IV',
    emoji: '⚗️',
    description: 'Breeder: +8 yield, −50% breed time. Maximum yield & speed. Unrivalled for farming.',
    level: 4, maxCharges: 6,
    effects: [
      { type: 'breeder_speed_boost', value: 0.50 },
      { type: 'breeder_extra_yield', value: 8 },
    ],
    cost: [{ plantTypeId: 'nexusbloom', quantity: 4 }, { plantTypeId: 'dawnrift', quantity: 2 }],
  },
  {
    id: 'growth-catalyst-v',
    name: 'Growth Catalyst V',
    emoji: '⚗️',
    description: 'Breeder: +10 yield, −60% breed time. Omega-grade propagation.',
    level: 5, maxCharges: 7,
    effects: [
      { type: 'breeder_speed_boost', value: 0.60 },
      { type: 'breeder_extra_yield', value: 10 },
    ],
    cost: [{ plantTypeId: 'eventide-bloom', quantity: 4 }, { plantTypeId: 'reality-thorn', quantity: 2 }],
  },

  // ─── Breeder: mutation boost (Mutation Booster / Prism Lens) ─────────────
  {
    id: 'mutation-booster',
    name: 'Mutation Booster',
    emoji: '🧬',
    description: 'Breeder: +10% mutation, −5% breed time. Good for T1–T2 void hunting.',
    level: 1, maxCharges: 3,
    effects: [
      { type: 'breeder_speed_boost', value: 0.05 },
      { type: 'breeder_mutation_boost', value: 0.10 },
    ],
    cost: [{ plantTypeId: 'glowshroom', quantity: 8 }, { plantTypeId: 'dustbloom', quantity: 15 }],
  },
  {
    id: 'mutation-booster-ii',
    name: 'Mutation Booster II',
    emoji: '🧬',
    description: 'Breeder: +15% mutation, −10% breed time. Reliable for T3–T4 void hunting.',
    level: 2, maxCharges: 4,
    effects: [
      { type: 'breeder_speed_boost', value: 0.10 },
      { type: 'breeder_mutation_boost', value: 0.15 },
    ],
    cost: [{ plantTypeId: 'crystal-bud', quantity: 3 }, { plantTypeId: 'emberfern', quantity: 4 }],
  },
  {
    id: 'prism-lens',
    name: 'Prism Lens',
    emoji: '🧬',
    description: 'Breeder: +25% mutation, −15% breed time. High mutation chance. Essential for Void plants.',
    level: 3, maxCharges: 5,
    effects: [
      { type: 'breeder_speed_boost', value: 0.15 },
      { type: 'breeder_mutation_boost', value: 0.25 },
    ],
    cost: [{ plantTypeId: 'xenoform', quantity: 3 }, { plantTypeId: 'abyssform', quantity: 2 }],
  },
  {
    id: 'prism-lens-ii',
    name: 'Prism Lens II',
    emoji: '🧬',
    description: 'Breeder: +35% mutation, −25% breed time. Unmatched void hunting. Essential for upper-tier Void plants.',
    level: 4, maxCharges: 6,
    effects: [
      { type: 'breeder_speed_boost', value: 0.25 },
      { type: 'breeder_mutation_boost', value: 0.35 },
    ],
    cost: [{ plantTypeId: 'aetherix', quantity: 2 }, { plantTypeId: 'tempest-spike', quantity: 1 }],
  },
  {
    id: 'prism-lens-iii',
    name: 'Prism Lens III',
    emoji: '🧬',
    description: 'Breeder: +45% mutation, −35% breed time. The strongest mutation artifact.',
    level: 5, maxCharges: 7,
    effects: [
      { type: 'breeder_speed_boost', value: 0.35 },
      { type: 'breeder_mutation_boost', value: 0.45 },
    ],
    cost: [{ plantTypeId: 'void-orchid', quantity: 2 }, { plantTypeId: 'omega-core', quantity: 1 }],
  },

  // ─── Breeder: hybrid all-rounder (Xenoculture Flask) ─────────────────────
  {
    id: 'xenoculture-flask',
    name: 'Xenoculture Flask',
    emoji: '🫧',
    description: 'Breeder: +2 yield, +10% mutation, −5% breed time. Balanced early hybrid.',
    level: 1, maxCharges: 3,
    effects: [
      { type: 'breeder_speed_boost', value: 0.05 },
      { type: 'breeder_extra_yield', value: 2 },
      { type: 'breeder_mutation_boost', value: 0.10 },
    ],
    cost: [{ plantTypeId: 'ashvine', quantity: 6 }, { plantTypeId: 'bloom', quantity: 3 }],
  },
  {
    id: 'xenoculture-flask-ii',
    name: 'Xenoculture Flask II',
    emoji: '🫧',
    description: 'Breeder: +3 yield, +15% mutation, −10% breed time. Balanced T3 hybrid.',
    level: 2, maxCharges: 4,
    effects: [
      { type: 'breeder_speed_boost', value: 0.10 },
      { type: 'breeder_extra_yield', value: 3 },
      { type: 'breeder_mutation_boost', value: 0.15 },
    ],
    cost: [{ plantTypeId: 'emberfern', quantity: 4 }, { plantTypeId: 'crystal-vine', quantity: 2 }],
  },
  {
    id: 'xenoculture-flask-iii',
    name: 'Xenoculture Flask III',
    emoji: '🫧',
    description: 'Breeder: +4 yield, +20% mutation, −15% breed time. Premium T4 all-rounder.',
    level: 3, maxCharges: 5,
    effects: [
      { type: 'breeder_speed_boost', value: 0.15 },
      { type: 'breeder_extra_yield', value: 4 },
      { type: 'breeder_mutation_boost', value: 0.20 },
    ],
    cost: [{ plantTypeId: 'abyssform', quantity: 2 }, { plantTypeId: 'crystalmoss', quantity: 2 }],
  },
  {
    id: 'xenoculture-flask-iv',
    name: 'Xenoculture Flask IV',
    emoji: '🫧',
    description: 'Breeder: +5 yield, +30% mutation, −25% breed time. Legendary T7 all-rounder.',
    level: 4, maxCharges: 6,
    effects: [
      { type: 'breeder_speed_boost', value: 0.25 },
      { type: 'breeder_extra_yield', value: 5 },
      { type: 'breeder_mutation_boost', value: 0.30 },
    ],
    cost: [{ plantTypeId: 'quantum-bloom', quantity: 2 }, { plantTypeId: 'starcore', quantity: 1 }],
  },
  {
    id: 'xenoculture-flask-v',
    name: 'Xenoculture Flask V',
    emoji: '🫧',
    description: 'Breeder: +7 yield, +40% mutation, −35% breed time. The final all-rounder.',
    level: 5, maxCharges: 7,
    effects: [
      { type: 'breeder_speed_boost', value: 0.35 },
      { type: 'breeder_extra_yield', value: 7 },
      { type: 'breeder_mutation_boost', value: 0.40 },
    ],
    cost: [{ plantTypeId: 'void-orchid', quantity: 2 }, { plantTypeId: 'reality-thorn', quantity: 1 }, { plantTypeId: 'omega-core', quantity: 1 }],
  },
]

export function getArtifact(id: string): ArtifactType | undefined {
  return ARTIFACT_TYPES.find(a => a.id === id)
}

export function getArtifactOrThrow(id: string): ArtifactType {
  const a = getArtifact(id)
  if (!a) throw new Error(`Unknown artifact type: ${id}`)
  return a
}
