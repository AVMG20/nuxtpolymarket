export type ArtifactEffectType =
  | 'breeder_extra_yield'
  | 'breeder_mutation_boost'
  | 'grid_yield_bonus'
  | 'grid_speed_boost'

export interface ArtifactEffect {
  type: ArtifactEffectType
  value: number
}

export interface ArtifactType {
  id: string
  name: string
  emoji: string
  description: string
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
    description: 'Grid: −15% grow time. Best for early cycling.',
    maxCharges: 2,
    effects: [{ type: 'grid_speed_boost', value: 0.15 }],
    cost: [{ plantTypeId: 'tendril', quantity: 15 }, { plantTypeId: 'dustbloom', quantity: 10 }],
  },
  {
    id: 'speed-rune-ii',
    name: 'Speed Rune II',
    emoji: '⚡',
    description: 'Grid: −35% grow time. Significant cycle reduction.',
    maxCharges: 3,
    effects: [{ type: 'grid_speed_boost', value: 0.35 }],
    cost: [{ plantTypeId: 'creeper', quantity: 10 }, { plantTypeId: 'phantom-leaf', quantity: 4 }],
  },
  {
    id: 'speed-rune-iii',
    name: 'Speed Rune III',
    emoji: '⚡',
    description: 'Grid: −60% grow time. Best pure speed artifact in the game.',
    maxCharges: 5,
    effects: [{ type: 'grid_speed_boost', value: 0.60 }],
    cost: [{ plantTypeId: 'swiftcane', quantity: 5 }, { plantTypeId: 'voidpulse', quantity: 2 }],
  },

  // ─── Grid: yield bonus (pure) ─────────────────────────────────────────────
  {
    id: 'yield-crystal',
    name: 'Yield Crystal',
    emoji: '💠',
    description: 'Grid: +1 yield per harvest. Reliable starter yield boost.',
    maxCharges: 2,
    effects: [{ type: 'grid_yield_bonus', value: 1 }],
    cost: [{ plantTypeId: 'sprout', quantity: 12 }, { plantTypeId: 'dustbloom', quantity: 10 }],
  },
  {
    id: 'yield-crystal-ii',
    name: 'Yield Crystal II',
    emoji: '💠',
    description: 'Grid: +2 yield per harvest. Strong mid-game yield artifact.',
    maxCharges: 3,
    effects: [{ type: 'grid_yield_bonus', value: 2 }],
    cost: [{ plantTypeId: 'bloom', quantity: 8 }, { plantTypeId: 'ashvine', quantity: 6 }],
  },
  {
    id: 'yield-crystal-iii',
    name: 'Yield Crystal III',
    emoji: '💠',
    description: 'Grid: +3 yield per harvest. Best pure yield artifact. Requires T4 plants.',
    maxCharges: 5,
    effects: [{ type: 'grid_yield_bonus', value: 3 }],
    cost: [{ plantTypeId: 'deepfrond', quantity: 3 }, { plantTypeId: 'voidfern', quantity: 4 }],
  },

  // ─── Grid: hybrid (speed + yield) ────────────────────────────────────────
  {
    id: 'harvest-prism',
    name: 'Harvest Prism',
    emoji: '🔷',
    description: 'Grid: −10% grow time & +1 yield. Versatile early hybrid.',
    maxCharges: 3,
    effects: [
      { type: 'grid_speed_boost', value: 0.10 },
      { type: 'grid_yield_bonus', value: 1 },
    ],
    cost: [{ plantTypeId: 'fernite', quantity: 5 }, { plantTypeId: 'ashvine', quantity: 5 }],
  },
  {
    id: 'harvest-prism-ii',
    name: 'Harvest Prism II',
    emoji: '🔷',
    description: 'Grid: −20% grow time & +2 yield. Solid T3 hybrid.',
    maxCharges: 4,
    effects: [
      { type: 'grid_speed_boost', value: 0.20 },
      { type: 'grid_yield_bonus', value: 2 },
    ],
    cost: [{ plantTypeId: 'emberfern', quantity: 4 }, { plantTypeId: 'crystalmoss', quantity: 3 }],
  },
  {
    id: 'harvest-prism-iii',
    name: 'Harvest Prism III',
    emoji: '🔷',
    description: 'Grid: −25% grow time & +2 yield. Premium T5 hybrid with max charges. Pure artifacts exceed it in their single stat.',
    maxCharges: 6,
    effects: [
      { type: 'grid_speed_boost', value: 0.25 },
      { type: 'grid_yield_bonus', value: 2 },
    ],
    cost: [{ plantTypeId: 'cosmosbloom', quantity: 2 }, { plantTypeId: 'starweave', quantity: 2 }],
  },

  // ─── Breeder: extra yield (pure) ─────────────────────────────────────────
  {
    id: 'growth-catalyst',
    name: 'Growth Catalyst',
    emoji: '⚗️',
    description: 'Breeder: +1 extra plant per breed. Entry-level yield booster.',
    maxCharges: 2,
    effects: [{ type: 'breeder_extra_yield', value: 1 }],
    cost: [{ plantTypeId: 'sprout', quantity: 12 }],
  },
  {
    id: 'growth-catalyst-ii',
    name: 'Growth Catalyst II',
    emoji: '⚗️',
    description: 'Breeder: +2 extra plants per breed. Strong T2 yield booster.',
    maxCharges: 3,
    effects: [{ type: 'breeder_extra_yield', value: 2 }],
    cost: [{ plantTypeId: 'fernite', quantity: 8 }, { plantTypeId: 'bloom', quantity: 5 }],
  },
  {
    id: 'growth-catalyst-iii',
    name: 'Growth Catalyst III',
    emoji: '⚗️',
    description: 'Breeder: +3 extra plants per breed. Best pure extra yield artifact.',
    maxCharges: 5,
    effects: [{ type: 'breeder_extra_yield', value: 3 }],
    cost: [{ plantTypeId: 'crystalmoss', quantity: 5 }, { plantTypeId: 'voidfern', quantity: 3 }],
  },

  // ─── Breeder: mutation boost (pure) ──────────────────────────────────────
  {
    id: 'mutation-booster',
    name: 'Mutation Booster',
    emoji: '🧬',
    description: 'Breeder: +5% mutation chance. Good for T1-T2 mutation hunting.',
    maxCharges: 2,
    effects: [{ type: 'breeder_mutation_boost', value: 0.05 }],
    cost: [{ plantTypeId: 'glowshroom', quantity: 8 }, { plantTypeId: 'dustbloom', quantity: 15 }],
  },
  {
    id: 'mutation-booster-ii',
    name: 'Mutation Booster II',
    emoji: '🧬',
    description: 'Breeder: +15% mutation chance. Reliable for T3 mutations.',
    maxCharges: 3,
    effects: [{ type: 'breeder_mutation_boost', value: 0.15 }],
    cost: [{ plantTypeId: 'crystal-bud', quantity: 3 }, { plantTypeId: 'emberfern', quantity: 4 }],
  },
  {
    id: 'prism-lens',
    name: 'Prism Lens',
    emoji: '🧬',
    description: 'Breeder: +35% mutation chance. Best pure mutation artifact. Essential for T5.',
    maxCharges: 5,
    effects: [{ type: 'breeder_mutation_boost', value: 0.35 }],
    cost: [{ plantTypeId: 'xenoform', quantity: 3 }, { plantTypeId: 'abyssform', quantity: 2 }],
  },

  // ─── Breeder: hybrid (extra yield + mutation boost) ───────────────────────
  {
    id: 'xenoculture-flask',
    name: 'Xenoculture Flask',
    emoji: '🫧',
    description: 'Breeder: +1 extra plant & +8% mutation. Great early hybrid.',
    maxCharges: 3,
    effects: [
      { type: 'breeder_extra_yield', value: 1 },
      { type: 'breeder_mutation_boost', value: 0.08 },
    ],
    cost: [{ plantTypeId: 'ashvine', quantity: 6 }, { plantTypeId: 'bloom', quantity: 3 }],
  },
  {
    id: 'xenoculture-flask-ii',
    name: 'Xenoculture Flask II',
    emoji: '🫧',
    description: 'Breeder: +2 extra plants & +15% mutation. Strong T3 hybrid.',
    maxCharges: 4,
    effects: [
      { type: 'breeder_extra_yield', value: 2 },
      { type: 'breeder_mutation_boost', value: 0.15 },
    ],
    cost: [{ plantTypeId: 'emberfern', quantity: 4 }, { plantTypeId: 'crystal-vine', quantity: 2 }],
  },
  {
    id: 'xenoculture-flask-iii',
    name: 'Xenoculture Flask III',
    emoji: '🫧',
    description: 'Breeder: +2 extra plants & +20% mutation. Premium T4 hybrid with max charges. Pure artifacts exceed it in their single stat.',
    maxCharges: 6,
    effects: [
      { type: 'breeder_extra_yield', value: 2 },
      { type: 'breeder_mutation_boost', value: 0.20 },
    ],
    cost: [{ plantTypeId: 'abyssform', quantity: 2 }, { plantTypeId: 'crystalmoss', quantity: 2 }],
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
