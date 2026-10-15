/**
 * Boss specials: what each world's boss and super boss does when it reaches for its special
 * attack (`open-items.md` #45, `art-style.md` §5b's table).
 *
 * Every gate boss has one, and every raid boss its own (`RAID_BOSS_SPECIALS`, below); regular
 * enemies and a raid's adds have no abilities. Each entry is a shape, read off its art: who it
 * reaches, how hard per target (one of three weights, each a share of the target's max HP), how
 * many hits it lands, and at most one status and a drain. The magnitudes are the `BOSS_SPECIAL_*`
 * constants.
 *
 * Party-side targeting is its own small vocabulary rather than `effects.ts`'s `EffectTarget`,
 * which is written against the enemy grid: a boss picks bodies the way its basic attack does.
 */

import { BOSS_STAGE, SUPER_BOSS_STAGE } from '../constants'
import type { RaidId } from './raids'

export type SpecialTarget =
    /** The body its basic attack would hit. */
    | 'front'
    /** That body and the next one its basic attack would reach. */
    | 'front_two'
    | 'all'

/** Per-target weight: the share of max HP it takes, `BOSS_SPECIAL_SPREAD_/HEAVY_/FOCUS_HP_SHARE`. */
export type SpecialWeight = 'spread' | 'heavy' | 'focus'

/**
 * What lands on each target: a burn (damage over time, sized off the hit), a stun or a silence,
 * or a debuff on SPD (slow), PWR (weaken) or DEF (sunder).
 */
export type SpecialStatus = 'burn' | 'stun' | 'silence' | 'slow' | 'weaken' | 'sunder'

/**
 * A raid boss reaches further down the line than a gate boss: the nearest three or four, or not
 * the party at all but its own adds (`adds`), which it mends by its weight's share of their max HP.
 */
export type RaidSpecialTarget = SpecialTarget | 'front_three' | 'front_four' | 'adds'

export interface BossSpecialDef extends SpecialDef {
    world: number
    stage: typeof BOSS_STAGE | typeof SUPER_BOSS_STAGE
    target: SpecialTarget
}

/** A special as the fight casts it, a gate boss's or a raid boss's. */
export interface SpecialDef {
    /** Stable string ID; the fight log carries it as the event's `skillId`. */
    id: string
    name: string
    target: RaidSpecialTarget
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

/**
 * The raid bosses' specials (issue #36), each raid's list per boss of its pack in the order the
 * fight indexes them (God's Forge's three in the order they walk out), and each boss's in the order
 * its art takes them (`specialsOf` in `app/utils/hero-quest-art`): a boss with two takes them in
 * turn, passing over one for its adds while none stand. Named and shaped off the raid art, where
 * every one was already drawn: `raid-warlord.ts`, `raid-wyrm.ts`, `raid-forge.ts`, `raid-rampant.ts`.
 *
 * The raids were tuned before the specials (`RAID_*_HP_MULT`); with them in, each multiplier was
 * measured again and moved so a level clears where it did (`constants.ts`).
 */
export const RAID_BOSS_SPECIALS: Readonly<Partial<Record<RaidId, readonly (readonly SpecialDef[])[]>>> = {
    raid_guild: [[
        // he gallops through the front rank, running the nearest three through
        { id: 'special_sunlance_charge', name: 'Sunlance Charge', target: 'front_three', weight: 'heavy', status: 'stun' },
        // spears of light rained onto every one of them
        { id: 'special_judgement_of_the_sun', name: 'Judgement of the Sun', target: 'all', weight: 'spread', status: 'weaken' }
    ]],
    raid_dig_site: [[
        // amethyst bursting up under the four nearest
        { id: 'special_geode_eruption', name: 'Geode Eruption', target: 'front_four', weight: 'heavy', status: 'sunder' },
        // a shell of crystal grown round each of its adds
        { id: 'special_crystal_mantle', name: 'Crystal Mantle', target: 'adds', weight: 'heavy' }
    ]],
    raid_forge: [
        // the Apprentice: three slams, the nearest three struck in turn
        [{ id: 'special_runaway_hammer', name: 'Runaway Hammer', target: 'front_three', weight: 'spread', hits: 3 }],
        // the Journeyman: steam rolling out over all of them
        [{ id: 'special_quench', name: 'Quench', target: 'all', weight: 'spread', status: 'slow' }],
        // the Forgemaster: three blows on the white-hot blade, then the hammer thrown down the line
        [
            { id: 'special_shower_of_sparks', name: 'Shower of Sparks', target: 'all', weight: 'spread', hits: 3, status: 'burn' },
            { id: 'special_masters_throw', name: 'Master\'s Throw', target: 'all', weight: 'heavy' }
        ]
    ],
    raid_trait: [[
        // curled into a ball, its armoured back slammed down on the three nearest
        { id: 'special_rolling_crash', name: 'Rolling Crash', target: 'front_three', weight: 'heavy', status: 'stun' },
        // its mane's crystals flung over every one of them
        { id: 'special_shard_storm', name: 'Shard Storm', target: 'all', weight: 'spread', hits: 2, status: 'sunder' }
    ]]
}

/** The specials of the `boss`th boss of a raid's pack, in the order it takes them; none for the dummy. */
export function raidBossSpecials(raid: RaidId, boss = 0): readonly SpecialDef[] {
    return RAID_BOSS_SPECIALS[raid]?.[boss] ?? []
}
