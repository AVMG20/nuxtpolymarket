export interface Mutation {
  parent1: string
  parent2: string
  offspring: string
  /** Base mutation chance (0-1). Artifacts can boost this. */
  chance: number
}

// ─── Mutation Table ───────────────────────────────────────────────────────────
// Pairs are order-independent (checked both ways).
// Note: some pairs appear twice — e.g. crystal-vine + voidbloom can yield xenoform OR deepfrond.
// getMutation returns the FIRST match (xenoform), which is fine for preview UI.
// Players targeting deepfrond need to be aware xenoform might appear first.

export const MUTATIONS: Mutation[] = [
  // T1 × T1 → T1
  { parent1: 'sprout',       parent2: 'tendril',      offspring: 'glowshroom',   chance: 0.20 },
  { parent1: 'sprout',       parent2: 'sprout',       offspring: 'dustbloom',    chance: 0.15 },

  // T1 × T1 → T2 (dustbloom shortcut to ashvine)
  { parent1: 'dustbloom',    parent2: 'tendril',      offspring: 'ashvine',      chance: 0.18 },

  // T1-mutation × T1 → T2 base plants (only path to bloom, creeper, fernite)
  { parent1: 'glowshroom',   parent2: 'sprout',       offspring: 'bloom',        chance: 0.15 },
  { parent1: 'glowshroom',   parent2: 'tendril',      offspring: 'creeper',      chance: 0.12 },
  { parent1: 'glowshroom',   parent2: 'dustbloom',    offspring: 'fernite',      chance: 0.12 },

  // T2 × T2 → T2
  { parent1: 'bloom',        parent2: 'fernite',      offspring: 'crystal-bud',  chance: 0.12 },
  { parent1: 'bloom',        parent2: 'creeper',      offspring: 'crystal-bud',  chance: 0.10 },
  { parent1: 'creeper',      parent2: 'fernite',      offspring: 'crystal-bud',  chance: 0.08 },

  // T2-mutation × T2 → T3
  { parent1: 'crystal-bud',  parent2: 'bloom',        offspring: 'crystal-vine', chance: 0.15 },
  { parent1: 'crystal-bud',  parent2: 'creeper',      offspring: 'phantom-leaf', chance: 0.12 },
  { parent1: 'crystal-bud',  parent2: 'fernite',      offspring: 'voidbloom',    chance: 0.10 },
  { parent1: 'crystal-bud',  parent2: 'ashvine',      offspring: 'emberfern',    chance: 0.10 },

  // T3 × T3 → T3
  { parent1: 'crystal-vine', parent2: 'phantom-leaf', offspring: 'xenoform',     chance: 0.08 },
  { parent1: 'crystal-vine', parent2: 'voidbloom',    offspring: 'xenoform',     chance: 0.06 },
  { parent1: 'phantom-leaf', parent2: 'voidbloom',    offspring: 'xenoform',     chance: 0.06 },

  // T3 × T3 → T4 (low chance, forcing artifact use)
  { parent1: 'crystal-vine', parent2: 'voidbloom',    offspring: 'deepfrond',    chance: 0.04 },
  { parent1: 'xenoform',     parent2: 'phantom-leaf', offspring: 'swiftcane',    chance: 0.04 },
  { parent1: 'emberfern',    parent2: 'voidbloom',    offspring: 'crystalmoss',  chance: 0.04 },
  { parent1: 'xenoform',     parent2: 'crystal-vine', offspring: 'voidfern',     chance: 0.03 },

  // T4 × T4 → T4
  { parent1: 'deepfrond',    parent2: 'swiftcane',    offspring: 'abyssform',    chance: 0.03 },

  // T4 × T4 → T5 (very low, needs strong artifact boost)
  { parent1: 'deepfrond',    parent2: 'crystalmoss',  offspring: 'starweave',    chance: 0.02 },
  { parent1: 'swiftcane',    parent2: 'voidfern',     offspring: 'voidpulse',    chance: 0.02 },
  { parent1: 'abyssform',    parent2: 'crystalmoss',  offspring: 'cosmosbloom',  chance: 0.02 },

  // T5 × T5 → T5 (requires massive artifact stack)
  { parent1: 'starweave',    parent2: 'voidpulse',    offspring: 'etherform',    chance: 0.01 },
]

/** Returns the first mutation for a plant pair (used for UI preview). */
export function getMutation(
  p1Id: string,
  p2Id: string,
): { offspring: string; chance: number } | null {
  const m = MUTATIONS.find(
    m => (m.parent1 === p1Id && m.parent2 === p2Id)
      || (m.parent1 === p2Id && m.parent2 === p1Id),
  )
  return m ? { offspring: m.offspring, chance: m.chance } : null
}

/** Returns ALL possible mutations for a plant pair in table order. */
export function getMutationPair(
  p1Id: string,
  p2Id: string,
): { offspring: string; chance: number }[] {
  return MUTATIONS
    .filter(m => (m.parent1 === p1Id && m.parent2 === p2Id)
      || (m.parent1 === p2Id && m.parent2 === p1Id))
    .map(m => ({ offspring: m.offspring, chance: m.chance }))
}

/** Returns all possible mutations involving a given plant. */
export function getMutationsFor(plantId: string): Mutation[] {
  return MUTATIONS.filter(m => m.parent1 === plantId || m.parent2 === plantId)
}
