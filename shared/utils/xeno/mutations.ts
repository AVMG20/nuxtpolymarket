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
//
// ─── Balance philosophy ───────────────────────────────────────────────────────
// `effectiveChance = base chance + artifact mutation boost` (clamped to [0, 1]).
// A failed roll is NOT a total loss — the breeder returns a plant of one parent's
// type, so players keep cycling parents while hunting a new species.
//
// T1–T2 stays approachable so new players ramp up fast. From T3 onward each new
// species gets progressively harder, and the only way to keep odds in a rewarding
// band is to invest in stronger mutation artifacts. Because artifacts can only be
// crafted from plants you already own, the BEST boost realistically available at
// each stage is gated:
//   • reaching T3 (own T2):       Mutation Booster / Xenoculture Flask  → +5%
//   • T3→T3 & T3→T4 (own T3):     Mutation Booster II / Flask II        → +10%
//   • T4→T5 (own T4):             Prism Lens / Flask III                → +15–20%
//   • T5→T6 (own T5):             Prism Lens                            → +20%
//   • T6→T7 (own T6/T7):          Prism Lens II                         → +30%
// Bases below are tuned so the effective chance with the best realistically-owned
// artifact sits around ~8–15% and trends downward each tier — rewarding but never
// trivial. T5+ bases are negative, so a mutation artifact is mandatory to advance.

export const MUTATIONS: Mutation[] = [
  // T1 × T1 → T1  (early game — left generous on purpose)
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

  // T2-mutation × T2 → T3  (difficulty ramp begins; best realistic boost +5% → ~12–15% effective)
  { parent1: 'crystal-bud',  parent2: 'bloom',        offspring: 'crystal-vine', chance: 0.10 },
  { parent1: 'crystal-bud',  parent2: 'creeper',      offspring: 'phantom-leaf', chance: 0.08 },
  { parent1: 'crystal-bud',  parent2: 'fernite',      offspring: 'voidbloom',    chance: 0.07 },
  { parent1: 'crystal-bud',  parent2: 'ashvine',      offspring: 'emberfern',    chance: 0.07 },

  // T3 × T3 → T3  (best realistic boost +10% → ~13–14% effective)
  { parent1: 'crystal-vine', parent2: 'phantom-leaf', offspring: 'xenoform',     chance: 0.04 },
  { parent1: 'crystal-vine', parent2: 'voidbloom',    offspring: 'xenoform',     chance: 0.03 },
  { parent1: 'phantom-leaf', parent2: 'voidbloom',    offspring: 'xenoform',     chance: 0.03 },

  // T3 × T3 → T4  (best realistic boost +10% → ~11–12% effective; Prism Lens not craftable yet)
  { parent1: 'crystal-vine', parent2: 'voidbloom',    offspring: 'deepfrond',    chance: 0.02 },
  { parent1: 'xenoform',     parent2: 'phantom-leaf', offspring: 'swiftcane',    chance: 0.02 },
  { parent1: 'emberfern',    parent2: 'voidbloom',    offspring: 'crystalmoss',  chance: 0.02 },
  { parent1: 'xenoform',     parent2: 'crystal-vine', offspring: 'voidfern',     chance: 0.015 },

  // T4 × T4 → T4  (+10% for the first abyssform, ~11.5% effective; Prism Lens makes repeats easier)
  { parent1: 'deepfrond',    parent2: 'swiftcane',    offspring: 'abyssform',    chance: 0.015 },

  // T4 × T4 → T5 (negative base — a mutation artifact is mandatory; Prism Lens +20% → ~12% effective)
  { parent1: 'deepfrond',    parent2: 'crystalmoss',  offspring: 'starweave',    chance: -0.08 },
  { parent1: 'swiftcane',    parent2: 'voidfern',     offspring: 'voidpulse',    chance: -0.08 },
  { parent1: 'abyssform',    parent2: 'crystalmoss',  offspring: 'cosmosbloom',  chance: -0.08 },

  // T5 × T5 → T5 (Prism Lens +20% → ~12% effective)
  { parent1: 'starweave',    parent2: 'voidpulse',    offspring: 'etherform',    chance: -0.08 },

  // T5 × T5 → T6 (Prism Lens +20% → ~10% effective; Prism Lens II later eases repeats)
  { parent1: 'etherform',    parent2: 'starweave',    offspring: 'dawnrift',     chance: -0.10 },
  { parent1: 'starweave',    parent2: 'cosmosbloom',  offspring: 'voidlattice',  chance: -0.10 },
  { parent1: 'voidpulse',    parent2: 'etherform',    offspring: 'nexusbloom',   chance: -0.10 },
  { parent1: 'cosmosbloom',  parent2: 'etherform',    offspring: 'stellarfrond', chance: -0.10 },

  // T6 × T6 → T6 (first aetherix: Prism Lens +20% → ~8% effective; gates Prism Lens II & all of T7)
  { parent1: 'dawnrift',     parent2: 'voidlattice',  offspring: 'aetherix',     chance: -0.12 },

  // T6 × T6 → T7 (Prism Lens +20% → ~7%; Prism Lens II +30% → ~17% once unlocked)
  { parent1: 'dawnrift',     parent2: 'aetherix',     offspring: 'tempest-spike', chance: -0.13 },
  { parent1: 'voidlattice',  parent2: 'nexusbloom',   offspring: 'abyssal-frond', chance: -0.13 },
  { parent1: 'nexusbloom',   parent2: 'stellarfrond', offspring: 'quantum-bloom', chance: -0.13 },
  { parent1: 'stellarfrond', parent2: 'aetherix',     offspring: 'starcore',      chance: -0.13 },

  // T7 × T7 → T7 (deeply negative — only Prism Lens II +30% gives any chance, ~5%: the endgame grind)
  { parent1: 'tempest-spike', parent2: 'abyssal-frond', offspring: 'singularity', chance: -0.25 },
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

/** Set of plant IDs that are exclusively obtainable via mutation (never from normal breeding). */
export const MUTATION_OFFSPRING = new Set(MUTATIONS.map(m => m.offspring))

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
