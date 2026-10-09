/**
 * The Trait vocabulary (`traits.md`): the eight stats a slot can roll, the nine grades, and the
 * five Sets.
 *
 * IDs are stable and are what `hq_trait_slots` and the save slots store; reordering a list here
 * must never change one. Nothing numeric lives here: the odds, the value tables and the Set tiers
 * are `constants.ts`'s, read through `traits.ts`.
 */

import type { HqModifier } from '../modifiers'
import type { TraitGrade, TraitSetId, TraitStatId } from '../types'

/**
 * Who a Trait line reaches (`traits.md` §0). Everything is party-wide, like an Artifact, except the
 * two entries named for one side: Hero Skill DMG touches only the Hero's own skills, and Champion
 * ATK only the Champions' PWR.
 */
export type TraitScope = 'party' | 'hero' | 'champion'

export interface TraitStatDef {
    id: TraitStatId
    name: string
    /** What it maps onto, as a modifier line with no magnitude yet. */
    line: Omit<HqModifier, 'magnitude'>
    scope: TraitScope
}

/** Uniform odds, 1 in 8 each (§2). */
export const TRAIT_STATS: readonly TraitStatDef[] = [
    // ATK reads as PWR, the single damage stat, on Hero and Champions alike
    { id: 'trait_atk', name: 'ATK', line: { kind: 'stat', stat: 'pwr' }, scope: 'party' },
    { id: 'trait_spd', name: 'SPD', line: { kind: 'stat', stat: 'spd' }, scope: 'party' },
    // HP is VIT, which is what max HP is built from (§0's resolution table)
    { id: 'trait_hp', name: 'HP', line: { kind: 'stat', stat: 'vit' }, scope: 'party' },
    // every archetype, Tank included (§4, revised for Champion stat parity)
    { id: 'trait_champion_atk', name: 'Champion ATK', line: { kind: 'stat', stat: 'pwr' }, scope: 'champion' },
    { id: 'trait_hero_skill_dmg', name: 'Hero Skill DMG', line: { kind: 'skillDamage' }, scope: 'hero' },
    { id: 'trait_lck', name: 'LCK', line: { kind: 'stat', stat: 'lck' }, scope: 'party' },
    { id: 'trait_imp', name: 'IMP', line: { kind: 'stat', stat: 'imp' }, scope: 'party' },
    { id: 'trait_exp_gain', name: 'EXP Gain', line: { kind: 'xp' }, scope: 'party' }
]

/** Worst to best (§2). */
export const TRAIT_GRADES: readonly TraitGrade[] = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS']

export interface TraitSetDef {
    id: TraitSetId
    name: string
    /** The lines a tier's magnitude lands as, every one party-wide (§5). */
    lines: readonly Omit<HqModifier, 'magnitude'>[]
    /** What a tier does, for a player; `{x}` is the tier's magnitude, already formatted. */
    effect: string
}

/** Uniform odds, 1 in 5 each (§2). */
export const TRAIT_SETS: readonly TraitSetDef[] = [
    // HP is VIT here as on the HP stat; Evasion Rate is EVA, a rate under MAX_EVASION
    { id: 'set_vital_reflex', name: 'Vital Reflex', lines: [{ kind: 'stat', stat: 'vit' }, { kind: 'evasion' }], effect: 'HP & Evasion Rate +{x}' },
    { id: 'set_divine_blessing', name: 'Divine Blessing', lines: [{ kind: 'regen' }], effect: 'Recovers {x} Max HP every second' },
    // "main attack stat": PWR, the one damage stat every unit has
    { id: 'set_aggression', name: 'Aggression', lines: [{ kind: 'stat', stat: 'pwr' }], effect: 'Main attack stat +{x}' },
    { id: 'set_deep_impact', name: 'Deep Impact', lines: [{ kind: 'stat', stat: 'imp' }], effect: 'IMP +{x}' },
    { id: 'set_back_to_basics', name: 'Back to Basics', lines: [{ kind: 'basicAttack' }], effect: 'Basic Attack DMG +{x}' }
]

export function isTraitStatId(value: unknown): value is TraitStatId {
    return TRAIT_STATS.some(stat => stat.id === value)
}

export function isTraitGrade(value: unknown): value is TraitGrade {
    return TRAIT_GRADES.includes(value as TraitGrade)
}

export function isTraitSetId(value: unknown): value is TraitSetId {
    return TRAIT_SETS.some(set => set.id === value)
}

export function getTraitStat(id: TraitStatId): TraitStatDef {
    return TRAIT_STATS.find(stat => stat.id === id)!
}

export function getTraitSet(id: TraitSetId): TraitSetDef {
    return TRAIT_SETS.find(set => set.id === id)!
}
