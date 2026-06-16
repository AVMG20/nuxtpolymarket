export type ArtifactEffectType =
  | 'breeder_extra_yield'    // +N extra plants produced per breed
  | 'breeder_mutation_boost' // +N% added to mutation chance
  | 'grid_yield_bonus'       // +N to yield roll on harvest
  | 'grid_speed_boost'       // reduce effective grow time by N%

export interface ArtifactEffect {
  type: ArtifactEffectType
  value: number
}

export interface ArtifactType {
  id: string
  name: string
  emoji: string
  description: string
  /** Total uses before the artifact degrades and is destroyed */
  maxCharges: number
  effect: ArtifactEffect
  /** Cost to purchase (paid in plants, not money) */
  cost: { plantTypeId: string; quantity: number }[]
}

export const ARTIFACT_TYPES: ArtifactType[] = [
  // ─── Breeder: extra yield ──────────────────────────────────────────────────
  {
    id: 'growth-catalyst',
    name: 'Growth Catalyst',
    emoji: '⚗️',
    description: 'Breeder: +1 extra plant per breed. 3 uses.',
    maxCharges: 3,
    effect: { type: 'breeder_extra_yield', value: 1 },
    cost: [{ plantTypeId: 'sprout', quantity: 12 }],
  },
  {
    id: 'growth-catalyst-ii',
    name: 'Growth Catalyst II',
    emoji: '⚗️',
    description: 'Breeder: +2 extra plants per breed. 6 uses.',
    maxCharges: 6,
    effect: { type: 'breeder_extra_yield', value: 2 },
    cost: [{ plantTypeId: 'fernite', quantity: 8 }, { plantTypeId: 'bloom', quantity: 5 }],
  },
  {
    id: 'growth-catalyst-iii',
    name: 'Growth Catalyst III',
    emoji: '⚗️',
    description: 'Breeder: +3 extra plants per breed. 6 uses.',
    maxCharges: 6,
    effect: { type: 'breeder_extra_yield', value: 3 },
    cost: [{ plantTypeId: 'crystalmoss', quantity: 3 }, { plantTypeId: 'emberfern', quantity: 5 }, { plantTypeId: 'ashvine', quantity: 10 }],
  },

  // ─── Breeder: mutation boost ───────────────────────────────────────────────
  {
    id: 'mutation-booster',
    name: 'Mutation Booster',
    emoji: '🧬',
    description: 'Breeder: +5% mutation chance. 3 uses.',
    maxCharges: 3,
    effect: { type: 'breeder_mutation_boost', value: 0.05 },
    cost: [{ plantTypeId: 'glowshroom', quantity: 8 }, { plantTypeId: 'dustbloom', quantity: 15 }],
  },
  {
    id: 'mutation-booster-ii',
    name: 'Mutation Booster II',
    emoji: '🧬',
    description: 'Breeder: +15% mutation chance. 6 uses.',
    maxCharges: 6,
    effect: { type: 'breeder_mutation_boost', value: 0.15 },
    cost: [{ plantTypeId: 'crystal-bud', quantity: 3 }, { plantTypeId: 'emberfern', quantity: 4 }],
  },
  {
    id: 'prism-lens',
    name: 'Prism Lens',
    emoji: '🧬',
    description: 'Breeder: +30% mutation chance. 6 uses. Essential for T5.',
    maxCharges: 6,
    effect: { type: 'breeder_mutation_boost', value: 0.30 },
    cost: [{ plantTypeId: 'xenoform', quantity: 2 }, { plantTypeId: 'abyssform', quantity: 1 }, { plantTypeId: 'crystalmoss', quantity: 3 }],
  },

  // ─── Grid: yield bonus ────────────────────────────────────────────────────
  {
    id: 'yield-crystal',
    name: 'Yield Crystal',
    emoji: '💠',
    description: 'Grid: +1 yield per harvest. 3 uses.',
    maxCharges: 3,
    effect: { type: 'grid_yield_bonus', value: 1 },
    cost: [{ plantTypeId: 'sprout', quantity: 10 }, { plantTypeId: 'dustbloom', quantity: 8 }],
  },
  {
    id: 'yield-crystal-ii',
    name: 'Yield Crystal II',
    emoji: '💠',
    description: 'Grid: +2 yield per harvest. 6 uses.',
    maxCharges: 6,
    effect: { type: 'grid_yield_bonus', value: 2 },
    cost: [{ plantTypeId: 'bloom', quantity: 8 }, { plantTypeId: 'ashvine', quantity: 6 }],
  },
  {
    id: 'yield-crystal-iii',
    name: 'Yield Crystal III',
    emoji: '💠',
    description: 'Grid: +3 yield per harvest. 6 uses.',
    maxCharges: 6,
    effect: { type: 'grid_yield_bonus', value: 3 },
    cost: [{ plantTypeId: 'deepfrond', quantity: 2 }, { plantTypeId: 'voidfern', quantity: 3 }, { plantTypeId: 'crystalmoss', quantity: 2 }],
  },

  // ─── Grid: speed boost ────────────────────────────────────────────────────
  {
    id: 'speed-rune',
    name: 'Speed Rune',
    emoji: '⚡',
    description: 'Grid: −10% grow time. 3 uses.',
    maxCharges: 3,
    effect: { type: 'grid_speed_boost', value: 0.10 },
    cost: [{ plantTypeId: 'tendril', quantity: 10 }, { plantTypeId: 'dustbloom', quantity: 12 }],
  },
  {
    id: 'speed-rune-ii',
    name: 'Speed Rune II',
    emoji: '⚡',
    description: 'Grid: −30% grow time. 6 uses.',
    maxCharges: 6,
    effect: { type: 'grid_speed_boost', value: 0.30 },
    cost: [{ plantTypeId: 'creeper', quantity: 8 }, { plantTypeId: 'phantom-leaf', quantity: 3 }],
  },
  {
    id: 'speed-rune-iii',
    name: 'Speed Rune III',
    emoji: '⚡',
    description: 'Grid: −50% grow time. 6 uses. Required for efficient T5 farming.',
    maxCharges: 6,
    effect: { type: 'grid_speed_boost', value: 0.50 },
    cost: [{ plantTypeId: 'swiftcane', quantity: 4 }, { plantTypeId: 'voidpulse', quantity: 2 }, { plantTypeId: 'abyssform', quantity: 1 }],
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
