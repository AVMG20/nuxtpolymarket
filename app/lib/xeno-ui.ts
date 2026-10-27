import {
  getArtifact, getEffectValueFor, getMutationPair, getPlant,
  type ArtifactType
} from '#shared/utils/xeno'

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** Roman numeral for tiers and artifact levels (1-10). */
export function roman(n: number): string {
  return ROMAN[n] ?? String(n)
}

export const TIER_NAMES: Record<number, string> = {
  1: 'Starter', 2: 'Developed', 3: 'Advanced', 4: 'Elite', 5: 'Cosmic',
  6: 'Ethereal', 7: 'Singularity', 8: 'Transcendent', 9: 'Omega'
}

/** Marker class for a tier leaf (`t1`-`t9`), violet for void plants. */
export function tierClass(tier: number, isVoid = false): string {
  return isVoid ? 'tv' : `t${Math.min(9, Math.max(1, tier))}`
}

export interface ArtifactFamily {
  key: string
  name: string
  icon: string
  cls: string
  domain: 'grid' | 'breeder'
  description: string
  matches: (id: string) => boolean
}

export const ARTIFACT_FAMILIES: ArtifactFamily[] = [
  { key: 'speed', name: 'Speed Rune', icon: 'i-lucide-zap', cls: 'g-speed', domain: 'grid', description: 'Shorter grow time', matches: id => id.startsWith('speed-rune') },
  { key: 'yield', name: 'Yield Crystal', icon: 'i-lucide-droplet', cls: 'g-yield', domain: 'grid', description: 'More plants per harvest', matches: id => id.startsWith('yield-crystal') },
  { key: 'prism', name: 'Harvest Prism', icon: 'i-lucide-diamond', cls: 'g-prism', domain: 'grid', description: 'Speed and yield', matches: id => id.startsWith('harvest-prism') },
  { key: 'catalyst', name: 'Growth Catalyst', icon: 'i-lucide-sprout', cls: 'g-cat', domain: 'breeder', description: 'More plants and faster breeding', matches: id => id.startsWith('growth-catalyst') },
  { key: 'mutation', name: 'Mutation Booster', icon: 'i-lucide-sparkles', cls: 'g-mut', domain: 'breeder', description: 'Higher mutation chance', matches: id => id.startsWith('mutation-booster') || id.startsWith('prism-lens') },
  { key: 'flask', name: 'Xenoculture Flask', icon: 'i-lucide-flower-2', cls: 'g-flask', domain: 'breeder', description: 'A bit of everything for pods', matches: id => id.startsWith('xenoculture-flask') }
]

const FALLBACK_FAMILY = ARTIFACT_FAMILIES[0]!

export function artifactFamily(typeId: string): ArtifactFamily {
  return ARTIFACT_FAMILIES.find(f => f.matches(typeId)) ?? FALLBACK_FAMILY
}

export function artifactDomain(typeId: string): 'grid' | 'breeder' {
  return getArtifact(typeId)?.effects.some(e => e.type.startsWith('grid_')) ? 'grid' : 'breeder'
}

/** Plain-language effect lines, e.g. "−25% grow time", "+3 per harvest". */
export function artifactEffectLines(art: ArtifactType | undefined, gemCrafted = false): { label: string, value: string }[] {
  if (!art) return []
  const v = (t: Parameters<typeof getEffectValueFor>[1]) => getEffectValueFor(art, t, gemCrafted)
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const out: { label: string, value: string }[] = []
  if (v('grid_speed_boost')) out.push({ label: 'Grow time', value: `−${pct(v('grid_speed_boost'))}` })
  if (v('grid_yield_bonus')) out.push({ label: 'Per harvest', value: `+${v('grid_yield_bonus')}` })
  if (v('breeder_speed_boost')) out.push({ label: 'Breed time', value: `−${pct(v('breeder_speed_boost'))}` })
  if (v('breeder_extra_yield')) out.push({ label: 'Extra plants', value: `+${v('breeder_extra_yield')}` })
  if (v('breeder_mutation_boost')) out.push({ label: 'Mutation', value: `+${pct(v('breeder_mutation_boost'))}` })
  return out
}

export function artifactEffectSummary(typeId: string, gemCrafted = false): string {
  return artifactEffectLines(getArtifact(typeId), gemCrafted).map(l => `${l.value} ${l.label.toLowerCase()}`).join(' · ')
}

export interface BreedOdds {
  /** Each possible mutation with its real chance (checked in table order, first hit wins). */
  mutations: { offspring: string, chance: number, base: number }[]
  /** Total chance of any mutation. */
  mutationTotal: number
  /** The no-mutation outcome per parent species (same species → one entry). */
  parents: { typeId: string, chance: number }[]
}

/** Outcome odds of a breed, mirroring the server roll in server/utils/xeno.ts. */
export function breedOdds(p1: string, p2: string, boost: number): BreedOdds {
  let miss = 1
  const mutations = getMutationPair(p1, p2).map((m) => {
    const eff = Math.max(0, Math.min(1, m.chance + boost))
    const chance = miss * eff
    miss *= 1 - eff
    return { offspring: m.offspring, chance, base: m.chance }
  })
  const parents = p1 === p2
    ? [{ typeId: p1, chance: miss }]
    : [{ typeId: p1, chance: miss / 2 }, { typeId: p2, chance: miss / 2 }]
  return { mutations, mutationTotal: 1 - miss, parents }
}

/** "12.5%" with at most one decimal. */
export function formatPct(x: number): string {
  const v = Math.round(x * 1000) / 10
  return `${v}%`
}

export function plantName(id: string | null | undefined): string {
  return (id && getPlant(id)?.name) || 'Unknown'
}

/** Two-letter initials for a player name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '?'
}
