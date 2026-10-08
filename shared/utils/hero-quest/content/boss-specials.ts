/**
 * Boss specials: what each world's boss and super boss does when it reaches for its special
 * attack (`open-items.md` #45, `art-style.md` §5b's table).
 *
 * Only the gate bosses have one; regular enemies have no abilities, and raids bring their own
 * fights. Each entry is a shape, read off its art: who it reaches, how hard per target (one of
 * three weights), how many hits it lands, and at most one status and a drain. The magnitudes are
 * the `BOSS_SPECIAL_*` constants.
 *
 * Party-side targeting is its own small vocabulary rather than `effects.ts`'s `EffectTarget`,
 * which is written against the enemy grid: a boss picks bodies the way its basic attack does.
 */

import { BOSS_STAGE, SUPER_BOSS_STAGE } from '../constants'

export type SpecialTarget =
    /** The body its basic attack would hit. */
    | 'front'
    /** That body and the next one its basic attack would reach. */
    | 'front_two'
    | 'all'

/** Per-target weight: `BOSS_SPECIAL_SPREAD_/HEAVY_/FOCUS_MULTIPLIER`. */
export type SpecialWeight = 'spread' | 'heavy' | 'focus'

/**
 * What lands on each target: a burn (damage over time, sized off the hit), a stun or a silence,
 * or a debuff on SPD (slow), PWR (weaken) or DEF (sunder).
 */
export type SpecialStatus = 'burn' | 'stun' | 'silence' | 'slow' | 'weaken' | 'sunder'

export interface BossSpecialDef {
    /** Stable string ID; the fight log carries it as the event's `skillId`. */
    id: string
    name: string
    world: number
    stage: typeof BOSS_STAGE | typeof SUPER_BOSS_STAGE
    target: SpecialTarget
    weight: SpecialWeight
    /** The per-target damage split into this many hits, each logged; 1 when omitted. */
    hits?: number
    status?: SpecialStatus
    /** Heals the boss `BOSS_SPECIAL_DRAIN_FRACTION` of what it landed. */
    drain?: boolean
}

export const BOSS_SPECIALS: readonly BossSpecialDef[] = [
    // the boar knocks the two nearest flying
    { id: 'special_tusk_charge', name: 'Tusk Charge', world: 1, stage: BOSS_STAGE, target: 'front_two', weight: 'focus', status: 'stun' },
    { id: 'special_wicker_blaze', name: 'Wicker Blaze', world: 1, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'spread', status: 'burn' },
    // leechlings latch on and feed her
    { id: 'special_brood_swarm', name: 'Brood Swarm', world: 2, stage: BOSS_STAGE, target: 'all', weight: 'spread', drain: true },
    { id: 'special_drowning_mire', name: 'Drowning Mire', world: 2, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'spread', status: 'slow' },
    { id: 'special_molten_quake', name: 'Molten Quake', world: 3, stage: BOSS_STAGE, target: 'all', weight: 'heavy' },
    { id: 'special_inferno', name: 'Inferno', world: 3, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'heavy', status: 'burn' },
    // ice spikes split armour
    { id: 'special_winters_cleave', name: "Winter's Cleave", world: 4, stage: BOSS_STAGE, target: 'all', weight: 'spread', status: 'sunder' },
    { id: 'special_avalanche', name: 'Avalanche', world: 4, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'heavy', status: 'slow' },
    // the conch's song
    { id: 'special_sirens_call', name: "Siren's Call", world: 5, stage: BOSS_STAGE, target: 'all', weight: 'spread', status: 'silence' },
    // a squeeze, then the whip down
    { id: 'special_krakens_embrace', name: "Kraken's Embrace", world: 5, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'spread', hits: 2, status: 'stun' },
    // runes fired three times over
    { id: 'special_grimoire_storm', name: 'Grimoire Storm', world: 6, stage: BOSS_STAGE, target: 'all', weight: 'spread', hits: 3, status: 'weaken' },
    // two beams, crossing
    { id: 'special_void_nova', name: 'Void Nova', world: 6, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'heavy', hits: 2 },
    // soul-fire under each of them
    { id: 'special_gravelords_toll', name: "Gravelord's Toll", world: 7, stage: BOSS_STAGE, target: 'all', weight: 'spread', status: 'burn' },
    { id: 'special_bone_tide', name: 'Bone Tide', world: 7, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'heavy', status: 'sunder' },
    // lightning arcing out from the dive
    { id: 'special_thunderstrike_dive', name: 'Thunderstrike Dive', world: 8, stage: BOSS_STAGE, target: 'all', weight: 'spread', status: 'stun' },
    { id: 'special_break_the_heavens', name: 'Break the Heavens', world: 8, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'heavy' },
    // the lantern drains their colour back to her
    { id: 'special_vigil_of_the_forgotten', name: 'Vigil of the Forgotten', world: 9, stage: BOSS_STAGE, target: 'all', weight: 'spread', status: 'weaken', drain: true },
    // the dark left pooled under them
    { id: 'special_the_door_opens', name: 'The Door Opens', world: 9, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'heavy', status: 'burn' },
    // every one of them struck twice
    { id: 'special_last_trumpet', name: 'Last Trumpet', world: 10, stage: BOSS_STAGE, target: 'all', weight: 'heavy', hits: 2 },
    { id: 'special_devour', name: 'Devour', world: 10, stage: SUPER_BOSS_STAGE, target: 'all', weight: 'heavy', drain: true }
]

const BY_GATE = new Map(BOSS_SPECIALS.map(special => [`${special.world}:${special.stage}`, special]))

/** The special of the boss at this gate, or undefined off a gate. */
export function bossSpecialAt(world: number, stage: number): BossSpecialDef | undefined {
    return BY_GATE.get(`${world}:${stage}`)
}
