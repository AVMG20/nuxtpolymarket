export type ArtifactEffectType =
  | 'breeder_extra_yield'
  | 'breeder_mutation_boost'
  | 'breeder_speed_boost'
  | 'grid_yield_bonus'
  | 'grid_speed_boost'

/** % speed reduction per display level for artifacts (5% per level, max level 10 = 50%) */
export const ARTIFACT_SPEED_PER_LEVEL = 0.05

export interface ArtifactEffect {
  type: ArtifactEffectType
  value: number
}

export interface ArtifactType {
  id: string
  name: string
  emoji: string
  description: string
  /** Tier within its family: 1 = base, 2 = II, 3 = III, 4 = IV */
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

  // ─── Breeder: yield + speed (Growth Catalyst) ────────────────────────────
  {
    id: 'growth-catalyst',
    name: 'Growth Catalyst',
    emoji: '⚗️',
    description: 'Breeder: +3 yield, −10% breed time. Best yield & speed at tier I.',
    level: 1, maxCharges: 6,
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
    level: 2, maxCharges: 7,
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
    level: 3, maxCharges: 8,
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
    level: 4, maxCharges: 10,
    effects: [
      { type: 'breeder_speed_boost', value: 0.50 },
      { type: 'breeder_extra_yield', value: 8 },
    ],
    cost: [{ plantTypeId: 'nexusbloom', quantity: 4 }, { plantTypeId: 'dawnrift', quantity: 2 }],
  },

  // ─── Breeder: mutation boost (Mutation Booster / Prism Lens) ─────────────
  {
    id: 'mutation-booster',
    name: 'Mutation Booster',
    emoji: '🧬',
    description: 'Breeder: +5% mutation, −5% breed time. Good for T1–T2 void hunting.',
    level: 1, maxCharges: 6,
    effects: [
      { type: 'breeder_speed_boost', value: 0.05 },
      { type: 'breeder_mutation_boost', value: 0.05 },
    ],
    cost: [{ plantTypeId: 'glowshroom', quantity: 8 }, { plantTypeId: 'dustbloom', quantity: 15 }],
  },
  {
    id: 'mutation-booster-ii',
    name: 'Mutation Booster II',
    emoji: '🧬',
    description: 'Breeder: +10% mutation, −10% breed time. Reliable for T3–T4 void hunting.',
    level: 2, maxCharges: 7,
    effects: [
      { type: 'breeder_speed_boost', value: 0.10 },
      { type: 'breeder_mutation_boost', value: 0.10 },
    ],
    cost: [{ plantTypeId: 'crystal-bud', quantity: 3 }, { plantTypeId: 'emberfern', quantity: 4 }],
  },
  {
    id: 'prism-lens',
    name: 'Prism Lens',
    emoji: '🧬',
    description: 'Breeder: +20% mutation, −15% breed time. Highest mutation chance. Essential for Void plants.',
    level: 3, maxCharges: 8,
    effects: [
      { type: 'breeder_speed_boost', value: 0.15 },
      { type: 'breeder_mutation_boost', value: 0.20 },
    ],
    cost: [{ plantTypeId: 'xenoform', quantity: 3 }, { plantTypeId: 'abyssform', quantity: 2 }],
  },
  {
    id: 'prism-lens-ii',
    name: 'Prism Lens II',
    emoji: '🧬',
    description: 'Breeder: +30% mutation, −25% breed time. Unmatched void hunting. Essential for T6–T7 Void plants.',
    level: 4, maxCharges: 10,
    effects: [
      { type: 'breeder_speed_boost', value: 0.25 },
      { type: 'breeder_mutation_boost', value: 0.30 },
    ],
    cost: [{ plantTypeId: 'aetherix', quantity: 2 }, { plantTypeId: 'tempest-spike', quantity: 1 }],
  },

  // ─── Breeder: hybrid all-rounder (Xenoculture Flask) ─────────────────────
  {
    id: 'xenoculture-flask',
    name: 'Xenoculture Flask',
    emoji: '🫧',
    description: 'Breeder: +2 yield, +5% mutation, −5% breed time. Balanced early hybrid.',
    level: 1, maxCharges: 6,
    effects: [
      { type: 'breeder_speed_boost', value: 0.05 },
      { type: 'breeder_extra_yield', value: 2 },
      { type: 'breeder_mutation_boost', value: 0.05 },
    ],
    cost: [{ plantTypeId: 'ashvine', quantity: 6 }, { plantTypeId: 'bloom', quantity: 3 }],
  },
  {
    id: 'xenoculture-flask-ii',
    name: 'Xenoculture Flask II',
    emoji: '🫧',
    description: 'Breeder: +3 yield, +10% mutation, −10% breed time. Balanced T3 hybrid.',
    level: 2, maxCharges: 7,
    effects: [
      { type: 'breeder_speed_boost', value: 0.10 },
      { type: 'breeder_extra_yield', value: 3 },
      { type: 'breeder_mutation_boost', value: 0.10 },
    ],
    cost: [{ plantTypeId: 'emberfern', quantity: 4 }, { plantTypeId: 'crystal-vine', quantity: 2 }],
  },
  {
    id: 'xenoculture-flask-iii',
    name: 'Xenoculture Flask III',
    emoji: '🫧',
    description: 'Breeder: +4 yield, +15% mutation, −15% breed time. Premium T4 all-rounder.',
    level: 3, maxCharges: 8,
    effects: [
      { type: 'breeder_speed_boost', value: 0.15 },
      { type: 'breeder_extra_yield', value: 4 },
      { type: 'breeder_mutation_boost', value: 0.15 },
    ],
    cost: [{ plantTypeId: 'abyssform', quantity: 2 }, { plantTypeId: 'crystalmoss', quantity: 2 }],
  },
  {
    id: 'xenoculture-flask-iv',
    name: 'Xenoculture Flask IV',
    emoji: '🫧',
    description: 'Breeder: +5 yield, +25% mutation, −25% breed time. Legendary T7 all-rounder.',
    level: 4, maxCharges: 10,
    effects: [
      { type: 'breeder_speed_boost', value: 0.25 },
      { type: 'breeder_extra_yield', value: 5 },
      { type: 'breeder_mutation_boost', value: 0.25 },
    ],
    cost: [{ plantTypeId: 'quantum-bloom', quantity: 2 }, { plantTypeId: 'starcore', quantity: 1 }],
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
