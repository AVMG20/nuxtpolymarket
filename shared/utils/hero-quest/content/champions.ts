/**
 * Champion roster and archetype rules (`champions-guild-gacha.md`).
 *
 * **All 48** — 2 per archetype per rarity across all six rarities, the complete roster §1
 * describes.
 *
 * The roster is **assembled from two tables** rather than written out entry by entry — names
 * and titles in `ROSTER`, ability draws in `ABILITY_SLOTS`. That makes the three structural
 * rules (ability count per rarity, the ≤3 reuse cap, and variety within a rarity) consequences
 * of one shared distribution instead of 48 separate opportunities to break one of them.
 *
 * What is **specified by the doc** and reproduced faithfully: rarity multipliers (§2),
 * ability counts per rarity (§2), default rows (§8.1), autoattack targeting (§8.2), the
 * passive stat mapping (§7), the naming template and its epithet/title pools (§5), the
 * 7-ability starting pool per archetype (§6), and each ability's effect (§6).
 *
 * What is **not specified and is therefore placeholdered**: the per-archetype base stat
 * spread. §2 says outright there is no Champion equivalent of `classes-and-combat.md` §2's
 * table, and that absolute magnitudes are owned by this content pass. They are marked
 * `UNTUNED ╧` and expressed in the same `StatTier` vocabulary the Hero uses, so the two
 * remain comparable and one edit retunes both.
 *
 * Cooldowns stay on the shared placeholder — no doc assigns one to any of the 28, and
 * inventing 28 different values would encode a spread nobody decided.
 */

import {
    EXECUTE_BONUS,
    FOCUSED_BARRAGE_HITS,
    FROSTBIND_FREEZE_STACKS,
    FROSTBIND_STACKS_PER_CAST,
    REVIVE_HP_FRACTION,
    SKILL_BASE_ABILITY_MULTIPLIER,
    SKILL_BASE_COOLDOWN_SECONDS,
    SKILL_BUFF_FRACTION,
    SKILL_CONTROL_DURATION_SECONDS,
    SKILL_DEBUFF_FRACTION,
    SKILL_DOT_MULTIPLIER,
    SKILL_HEAL_MULTIPLIER,
    SKILL_HOT_MULTIPLIER,
    SKILL_REDIRECT_FRACTION,
    SKILL_REFLECT_FRACTION,
    SKILL_SHIELD_MULTIPLIER,
    SKILL_STATUS_DURATION_SECONDS
} from '../constants'
import { onCooldownRank, SINGLE_TARGET } from '../effects'
import type { AbilityEffect } from '../effects'
import { RARITIES, RARITY_EFFECT_LINES, RARITY_EPITHET, RARITY_STAT_MULTIPLIER, rarityIndex } from '../gacha'
import type {
    AutoTarget,
    ChampionArchetype,
    ClassSkill,
    FormationRow,
    HqStatKey,
    Rarity,
    StatTier
} from '../types'

// ── Rarity ─────────────────────────────────────────────  gacha-shared-system.md §1, §2

/**
 * Re-exported from `gacha.ts`, which owns all three because every gacha shares them, so
 * Champion-facing callers have one import for everything rarity-related.
 */
export { RARITIES, RARITY_EPITHET, RARITY_STAT_MULTIPLIER }

/**
 * Ability slots by rarity (§2). Common–Rare 1, Epic/Legendary 2, Mythic 3.
 *
 * The *same* 1/1/1/2/2/3 table Skills and Artifacts state as an effect-line count — an alias,
 * not a copy, so the three cannot drift apart under a retune.
 */
export const RARITY_ABILITY_COUNT = RARITY_EFFECT_LINES

// ── Archetypes ─────────────────────────────────────────  champions-guild-gacha.md §1, §7, §8

export const ARCHETYPES: readonly ChampionArchetype[] = ['damage', 'tank', 'support', 'control']

export interface ArchetypeDefinition {
    id: ChampionArchetype
    name: string
    /** §8.1 — Tank is the only front-row default. */
    defaultRow: FormationRow
    /** §8.2. Not yet read by combat — see `AutoTarget`. */
    autoTarget: AutoTarget
    /**
     * §7 — which Hero stat(s) owning this Champion buffs, in or out of the party. Coverage is
     * exactly 2/1/2/1 across the Hero's six stats, every stat once, no archetype special-cased.
     */
    passiveStats: readonly HqStatKey[]
    /** §5 title pool, so twelve of one archetype aren't all named the same thing. */
    titles: readonly string[]
    /** UNTUNED ╧ — §2 states there is no doc table for this. */
    spread: Record<HqStatKey, StatTier>
}

/**
 * Per-archetype base spreads. **Placeholder values, deliberately.**
 *
 * Shaped to the archetype identities §1 and §2 describe — Tank leans DEF/VIT, Damage leans
 * PWR, Support leans IMP/LCK to match its own passive flavour, Control leans SPD — using the
 * same four-tier vocabulary as the Hero's class table so the two are directly comparable.
 * The *relative* shape is a reading of the doc; the absolute magnitudes are a guess.
 */
export const ARCHETYPE_DEFINITIONS: readonly ArchetypeDefinition[] = [
    {
        id: 'damage',
        name: 'Damage',
        defaultRow: 'back',
        autoTarget: 'highest_pwr',
        passiveStats: ['pwr'],
        titles: ['Blade', 'Edge', 'Render', 'Lancer', 'Ravager', 'Scourge', 'Slayer', 'Fury', 'Tempest', 'Warbringer', 'Reaver', 'Executioner'],
        spread: { pwr: 'high', spd: 'mid', lck: 'mid_high', imp: 'mid_high', vit: 'low', def: 'low' } // UNTUNED ╧
    },
    {
        id: 'tank',
        name: 'Tank',
        defaultRow: 'front',
        autoTarget: 'lowest_hp_pct',
        passiveStats: ['def', 'vit'],
        titles: ['Bulwark', 'Rampart', 'Anvil', 'Keeper', 'Aegis', 'Bastion', 'Sentinel', 'Shieldwall', 'Colossus', 'Ironclad', 'Guardian', 'Unbroken'],
        spread: { pwr: 'low', spd: 'low', lck: 'low', imp: 'low', vit: 'high', def: 'high' } // UNTUNED ╧
    },
    {
        id: 'support',
        name: 'Support',
        defaultRow: 'back',
        autoTarget: 'lowest_hp_pct',
        passiveStats: ['imp', 'lck'],
        titles: ['Sage', 'Mender', 'Oracle', 'Solace', 'Anchor', 'Chorus', 'Warden', 'Lightbearer', 'Benediction', 'Harbinger', 'Blessed', 'Lifebinder'],
        spread: { pwr: 'mid', spd: 'mid', lck: 'high', imp: 'high', vit: 'mid', def: 'low' } // UNTUNED ╧
    },
    {
        id: 'control',
        name: 'Control',
        defaultRow: 'back',
        autoTarget: 'highest_pwr',
        passiveStats: ['spd'],
        titles: ['Binder', 'Whisper', 'Hexer', 'Fetter', 'Trickster', 'Snare', 'Veil', 'Riddle', 'Nullifier', 'Unmaker', 'Weaver', 'Shade'],
        spread: { pwr: 'mid', spd: 'high', lck: 'mid', imp: 'mid', vit: 'mid', def: 'low' } // UNTUNED ╧
    }
]

export const ARCHETYPE_BY_ID: Readonly<Record<ChampionArchetype, ArchetypeDefinition>> =
    Object.fromEntries(
        ARCHETYPE_DEFINITIONS.map(archetype => [archetype.id, archetype])
    ) as Record<ChampionArchetype, ArchetypeDefinition>

export function getArchetype(id: ChampionArchetype): ArchetypeDefinition {
    const archetype = ARCHETYPE_BY_ID[id]
    if (!archetype) throw new Error(`Unknown champion archetype: ${id}`)
    return archetype
}

// ── Ability pool ───────────────────────────────────────  champions-guild-gacha.md §6

/** All 28 starting abilities, 7 per archetype. Effects are content; magnitudes are shared. */
export const CHAMPION_ABILITY_POOL: Readonly<Record<ChampionArchetype, readonly string[]>> = {
    damage: ['Cleave', 'Piercing Bolt', 'Rising Flame', 'Execute Strike', 'Volley', 'Focused Barrage', 'Rupture'],
    tank: ['Provoke', 'Bulwark Stance', "Guardian's Reflect", 'Rallying Shout', 'Iron Skin', 'Ground Slam', "Guardian's Vow"],
    support: ['Mending Light', 'Sanctuary', 'Tide of Renewal', 'Empower', 'Haste Blessing', 'Second Wind', 'Purify'],
    control: ['Weaken', 'Slow', 'Silence', 'Shatter Armor', 'Chain Bind', 'Unraveling Curse', 'Frostbind']
}

const TIMED = SKILL_STATUS_DURATION_SECONDS
const buff = (stat: HqStatKey, magnitude = SKILL_BUFF_FRACTION) =>
    ({ kind: 'buff' as const, stat, duration: TIMED, magnitude })
const debuff = (stat: HqStatKey, magnitude = SKILL_DEBUFF_FRACTION) =>
    ({ kind: 'debuff' as const, stat, duration: TIMED, magnitude })

/**
 * What each of the 28 abilities actually does.
 *
 * **Every one of these is transcribed from `champions-guild-gacha.md` §6**, which gives each
 * ability a one-line effect description — unlike the class skills, where seven had nothing but
 * a name. The doc's own wording is quoted above each entry so a later reading can check the
 * transcription rather than re-deriving intent.
 *
 * Where a description needs machinery that does not exist, the entry says so and approximates
 * rather than silently dropping the clause. Three do: Iron Skin's "each hit taken" needs an
 * on-hit trigger, Frostbind's "at max stacks, freeze" needs a threshold trigger, and the
 * "chance to" clauses on Guardian's Reflect and Chain Bind are rendered as always-on, since a
 * per-application proc roll would add a second source of variance on top of crit for no gain
 * anyone asked for.
 */
export const CHAMPION_ABILITY_EFFECTS: Readonly<Record<string, AbilityEffect>> = {
    // ── Damage ─────────────────────────────────────────
    /** "Melee AoE hit to the 2–3 frontmost enemies." */
    Cleave: { target: 'enemy_front_line' },
    /** "Single-target hit that also strikes whatever's directly behind it." */
    'Piercing Bolt': { target: 'enemy_pierce' },
    /** "Burn (damage over time) on current target; re-application stacks." */
    'Rising Flame': {
        target: 'enemy_single',
        status: { kind: 'dot', duration: TIMED, magnitude: SKILL_DOT_MULTIPLIER, scalesWithPwr: true }
    },
    /** "Bonus damage that scales up the lower the target's HP% is." */
    'Execute Strike': { target: 'enemy_single', executeBonus: EXECUTE_BONUS },
    /**
     * "Hits 3 random enemies for smaller damage each."
     *
     * Rendered as the front line — three bodies, reduced damage each. Random selection would
     * need the fight's RNG inside the pure target resolver, and "three arbitrary enemies" and
     * "the three in front" differ only when the pack is part-cleared.
     */
    Volley: { target: 'enemy_front_line' },
    /** "Several smaller hits on one target instead of one big hit — more crit rolls per cast." */
    'Focused Barrage': { target: 'enemy_single', hits: FOCUSED_BARRAGE_HITS },
    /**
     * "Deals damage immediately, then a second burst after a short delay."
     *
     * The delayed burst is a short, heavy DoT — the closest the engine expresses without a
     * scheduled-event queue, and it lands the damage in the same window the doc describes.
     */
    Rupture: {
        target: 'enemy_single',
        status: {
            kind: 'dot', duration: SKILL_CONTROL_DURATION_SECONDS,
            magnitude: SKILL_DOT_MULTIPLIER, scalesWithPwr: true
        }
    },

    // ── Tank ───────────────────────────────────────────
    /** "Forces nearby enemies to prioritize this Tank for a short duration." */
    Provoke: { target: 'self', selfStatus: { kind: 'taunt', duration: TIMED } },
    /** "Temporary flat % damage reduction, self only." */
    'Bulwark Stance': { target: 'self', selfStatus: buff('def') },
    /** "Temporary chance to reflect a portion of incoming damage back at the attacker." */
    "Guardian's Reflect": {
        target: 'self',
        selfStatus: { kind: 'reflect', duration: TIMED, magnitude: SKILL_REFLECT_FRACTION }
    },
    /** "Brief party-wide % damage-reduction buff." */
    'Rallying Shout': { target: 'ally_all', status: buff('def') },
    /**
     * "Each hit taken slightly raises this Tank's DEF for the rest of the fight."
     *
     * No on-hit trigger exists, so this lands as a stacking DEF buff applied on cast rather
     * than per hit taken. The growth is real; what it is keyed off is not.
     */
    'Iron Skin': {
        target: 'self',
        selfStatus: { ...buff('def'), stacks: 1 }
    },
    /** "AoE knockback/brief stun on nearby enemies." */
    'Ground Slam': {
        target: 'enemy_front_line',
        status: { kind: 'stun', duration: SKILL_CONTROL_DURATION_SECONDS }
    },
    /** "Redirects a portion of damage aimed at one chosen ally onto this Tank instead." */
    "Guardian's Vow": {
        target: 'self',
        selfStatus: { kind: 'redirect', duration: TIMED, magnitude: SKILL_REDIRECT_FRACTION }
    },

    // ── Support ────────────────────────────────────────
    /** "Single-target heal." */
    'Mending Light': { target: 'ally_lowest_hp', heal: SKILL_HEAL_MULTIPLIER },
    /** "Shield (damage absorb) on a single ally." */
    Sanctuary: { target: 'ally_lowest_hp', shield: SKILL_SHIELD_MULTIPLIER },
    /** "Small heal-over-time applied to the whole party." */
    'Tide of Renewal': {
        target: 'ally_all',
        status: { kind: 'hot', duration: TIMED, magnitude: SKILL_HOT_MULTIPLIER, scalesWithPwr: true }
    },
    /** "Buffs one ally's damage output for a duration." */
    Empower: { target: 'ally_strongest', status: buff('pwr') },
    /** "Buffs one ally's SPD (i.e. shortens its cooldowns) for a duration." */
    'Haste Blessing': { target: 'ally_strongest', status: buff('spd') },
    /** "Revives a fallen ally with partial HP." */
    'Second Wind': { target: 'ally_all', revive: REVIVE_HP_FRACTION },
    /** "Removes all debuffs from a target (or the whole party) and grants brief debuff immunity." */
    Purify: {
        target: 'ally_all',
        cleanse: true,
        status: { kind: 'immunity', duration: SKILL_CONTROL_DURATION_SECONDS }
    },

    // ── Control ────────────────────────────────────────
    /** "Reduces target's damage output for a duration." */
    Weaken: { target: 'enemy_single', status: debuff('pwr') },
    /** "Reduces target's SPD (lengthens its cooldowns)." */
    Slow: { target: 'enemy_single', status: debuff('spd') },
    /** "Forces target's abilities into cooldown — they can't trigger for a duration." */
    Silence: {
        target: 'enemy_single',
        status: { kind: 'silence', duration: SKILL_CONTROL_DURATION_SECONDS }
    },
    /** "Reduces target's DEF for a duration." */
    'Shatter Armor': { target: 'enemy_single', status: debuff('def') },
    /**
     * "Applies its debuff, with a chance to also spread it to a second nearby enemy."
     *
     * The spread is rendered as always reaching the body behind — a pierce — rather than a
     * proc roll. Deterministic, and "a second nearby enemy" is exactly what a column is.
     */
    'Chain Bind': { target: 'enemy_pierce', status: debuff('spd') },
    /** "Extends the remaining duration of all debuffs currently active on its target." */
    'Unraveling Curse': { target: 'enemy_single', extendDebuffs: TIMED },
    /**
     * "Stacking slow; at max stacks, fully disables (freezes) the target."
     *
     * Both clauses, in full. The slow builds `FROSTBIND_STACKS_PER_CAST` at a time and the
     * freeze lands on whichever cast carries the target to `FROSTBIND_FREEZE_STACKS` — a stack
     * threshold rather than "on the last application", so how long the build-up takes stays a
     * tuning question. Setting the threshold above `STATUS_MAX_STACKS` disables the freeze
     * without touching the slow.
     */
    Frostbind: {
        target: 'enemy_single',
        status: { ...debuff('spd'), stacks: FROSTBIND_STACKS_PER_CAST },
        escalation: {
            atStacks: FROSTBIND_FREEZE_STACKS,
            status: { kind: 'stun', duration: SKILL_CONTROL_DURATION_SECONDS }
        }
    }
}

/**
 * Stable ID from an ability's display name — `Guardian's Reflect` →
 * `champ_ability_guardians_reflect`.
 *
 * Apostrophes are dropped rather than turned into a separator, matching `skillIdFor`. Unlike a
 * Skill or Gear id, an ability id is never persisted — it appears only in a `FightEvent` — so
 * the slug can change freely.
 */
export function abilityId(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return `champ_ability_${slug}`
}

/**
 * Abilities whose whole payload is the effect — a heal, a shield, a buff, a pure debuff.
 *
 * `champions-guild-gacha.md` §2 gives Support and Control their own formula shapes
 * (`healAmount` and `debuffPotency`, both `PWR × abilityMultiplier`) rather than routing them
 * through the damage formula, so a Support ability that also swung a weapon would be reading
 * the doc wrong.
 */
const UTILITY_ABILITIES = new Set([
    'Provoke', 'Bulwark Stance', "Guardian's Reflect", 'Rallying Shout', 'Iron Skin',
    "Guardian's Vow",
    'Mending Light', 'Sanctuary', 'Tide of Renewal', 'Empower', 'Haste Blessing',
    'Second Wind', 'Purify',
    'Weaken', 'Slow', 'Silence', 'Shatter Armor', 'Unraveling Curse', 'Frostbind'
])

export function ability(name: string): ClassSkill {
    return {
        id: abilityId(name),
        name,
        cooldownSeconds: SKILL_BASE_COOLDOWN_SECONDS,
        abilityMultiplier: UTILITY_ABILITIES.has(name) ? 0 : SKILL_BASE_ABILITY_MULTIPLIER,
        effect: CHAMPION_ABILITY_EFFECTS[name] ?? SINGLE_TARGET
    }
}

// ── Roster ─────────────────────────────────────────────

export interface ChampionDefinition {
    /** Stable string ID. Save data references this, never an index or a display name. */
    id: string
    /** The `<Given Name>` half of the §5 template. */
    givenName: string
    archetype: ChampionArchetype
    rarity: Rarity
    /** Chosen from the archetype's §5 title pool. */
    title: string
    /** Count must equal `RARITY_ABILITY_COUNT[rarity]` — asserted in the content spec. */
    abilities: readonly ClassSkill[]
    /** Hunter's triple and Beast Master's quad have no Champion equivalent yet. */
    strikesPerAttack: number
}

/**
 * Ability picks follow §6's method: Mythics take three, and no ability is reused more than 3
 * times within an archetype (the structural rule that sized the pool at 7). See `ABILITY_SLOTS`;
 * `test/hero-quest/content.spec.ts` enforces it.
 */
function champion(
    id: string,
    givenName: string,
    archetype: ChampionArchetype,
    rarity: Rarity,
    title: string,
    abilityNames: readonly string[]
): ChampionDefinition {
    return {
        id,
        givenName,
        archetype,
        rarity,
        title,
        abilities: abilityNames.map(name => onCooldownRank(ability(name), rarityIndex(rarity))),
        strikesPerAttack: 1
    }
}

/**
 * The twelve slots every archetype fills, in order: two per rarity, ascending.
 *
 * The full roster is **2 per archetype per rarity across all six rarities** (§1) — 48. Four
 * archetypes × this list.
 */
const ROSTER_RARITIES: readonly Rarity[] = [
    'common', 'common',
    'uncommon', 'uncommon',
    'rare', 'rare',
    'epic', 'epic',
    'legendary', 'legendary',
    'mythic', 'mythic'
]

/**
 * Which pool abilities each of those twelve slots draws, as indices into the archetype's
 * 7-strong pool. Shared by all four archetypes, which is what makes the reuse arithmetic a
 * property of one table rather than of 48 hand-written entries.
 *
 * ## Why this exact distribution
 *
 * Two goals pull against each other. **Variety within a rarity**: the two Champions of the
 * same archetype and rarity should not be the same Champion twice. **Overlap across
 * rarities**: a Common's ability should reappear at higher rarity, so pulling a Mythic never
 * feels like it is *missing* something a Common had.
 *
 * A small pool with heavy reuse is what serves the second goal — counter-intuitively,
 * *expanding* the pool would work against it, because a Common's one ability would be less
 * likely to show up on anything Mythic. So the pool stays at 7 and the cap at 3 uses.
 *
 * The arithmetic: 20 slots (1+1+1+2+2+3, doubled) against a capacity of 21 (7 abilities × 3
 * uses). It fits with exactly one slot spare:
 *
 *     common     {0}     / {1}
 *     uncommon   {2}     / {3}
 *     rare       {4}     / {5}
 *     epic       {0,6}   / {1,2}
 *     legendary  {3,6}   / {4,5}
 *     mythic     {0,1,2} / {3,4,5}
 *
 * Every rarity's pair is disjoint, so no two Champions of the same archetype and rarity share
 * a kit. And **the six abilities that appear at Common, Uncommon or Rare are exactly the six
 * the two Mythics carry** — so nothing a low-rarity Champion can do is missing from the top of
 * the ladder, which was the whole point. Ability 6 is the one the Mythics lack; it lives at
 * Epic and Legendary only, and is the single slot of spare capacity.
 *
 * Use counts land at 3,3,3,3,3,3,2 — inside the cap.
 *
 * **A tension worth knowing about.** §6's design table tiers abilities by rarity: a Support's
 * revive and cleanse are described as the *third* ability a Mythic gets, not a Rare's only
 * one. That cannot hold simultaneously with the two goals above: a 7-ability pool capped at 3
 * uses cannot put the basic abilities on low rarities, mirror the low set onto the Mythics,
 * *and* reserve the exotic abilities for high rarities — the arithmetic runs out. The overlap
 * goal won, so Rare Champions do draw from the back half of the pool. Recorded in
 * `open-items.md`; the levers are the pool size and the reuse cap.
 */
const ABILITY_SLOTS: readonly (readonly number[])[] = [
    [0], [1],
    [2], [3],
    [4], [5],
    [0, 6], [1, 2],
    [3, 6], [4, 5],
    [0, 1, 2], [3, 4, 5]
]

/**
 * Given names and titles, twelve per archetype, in `ROSTER_RARITIES` order.
 *
 * Authored content, "pre-decided per Champion" per §5 — not generated.
 *
 * ⚠ The given name *is* the persisted id (`championIdFor`), and the slot decides rarity. Never
 * rename or reorder an existing entry — collection rows would orphan or change rarity. Ability
 * draws are not persisted and may move freely.
 */
const ROSTER: Readonly<Record<ChampionArchetype, readonly (readonly [string, string])[]>> = {
    damage: [
        ['Rask', 'Blade'], ['Vheln', 'Edge'],
        ['Sorrek', 'Render'], ['Ayra', 'Lancer'],
        ['Dorne', 'Ravager'], ['Kestrel', 'Scourge'],
        ['Malachai', 'Slayer'], ['Ryn', 'Fury'],
        ['Vashka', 'Tempest'], ['Toren', 'Warbringer'],
        ['Kaira', 'Reaver'], ['Draveth', 'Executioner']
    ],
    tank: [
        ['Borin', 'Bulwark'], ['Hulric', 'Rampart'],
        ['Gareth', 'Anvil'], ['Mora', 'Keeper'],
        ['Ulrid', 'Aegis'], ['Bastyn', 'Bastion'],
        ['Ordwin', 'Sentinel'], ['Katrin', 'Shieldwall'],
        ['Volgrim', 'Colossus'], ['Sable', 'Ironclad'],
        ['Thoraxx', 'Guardian'], ['Ferrun', 'Unbroken']
    ],
    support: [
        ['Meret', 'Sage'], ['Lys', 'Mender'],
        ['Tavin', 'Oracle'], ['Ceren', 'Solace'],
        ['Calen', 'Anchor'], ['Illyana', 'Chorus'],
        ['Ordo', 'Warden'], ['Nieve', 'Lightbearer'],
        ['Aurelith', 'Benediction'], ['Mistral', 'Harbinger'],
        ['Seraphel', 'Blessed'], ['Vaelora', 'Lifebinder']
    ],
    control: [
        ['Ilyx', 'Binder'], ['Nym', 'Whisper'],
        ['Fesk', 'Hexer'], ['Orien', 'Fetter'],
        ['Varn', 'Trickster'], ['Sylwen', 'Snare'],
        ['Corvath', 'Veil'], ['Ashen', 'Riddle'],
        ['Nixara', 'Nullifier'], ['Thess', 'Unmaker'],
        ['Zeraphine', 'Weaver'], ['Umbriel', 'Shade']
    ]
}

/** `Rask` → `champ_rask`. Stable, and the only thing a save row ever references. */
function championIdFor(givenName: string): string {
    return `champ_${givenName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
}

/**
 * **All 48.** Four archetypes × two per rarity × six rarities.
 *
 * Assembled from `ROSTER` and `ABILITY_SLOTS` rather than written out, so the reuse cap, the
 * within-rarity variety and the ability-count-per-rarity rule are consequences of one table
 * instead of 48 opportunities to get one of them wrong. `content.spec.ts` asserts all three.
 */
export const CHAMPIONS: readonly ChampionDefinition[] = ARCHETYPES.flatMap(archetype =>
    ROSTER[archetype].map((entry, slot) => {
        const [givenName, title] = entry
        return champion(
            championIdFor(givenName),
            givenName,
            archetype,
            ROSTER_RARITIES[slot]!,
            title,
            ABILITY_SLOTS[slot]!.map(index => CHAMPION_ABILITY_POOL[archetype][index]!)
        )
    })
)

export const CHAMPION_BY_ID: Readonly<Record<string, ChampionDefinition>> = Object.fromEntries(
    CHAMPIONS.map(entry => [entry.id, entry])
)

export function getChampion(id: string): ChampionDefinition {
    const entry = CHAMPION_BY_ID[id]
    if (!entry) throw new Error(`Unknown champion id: ${id}`)
    return entry
}

export function isChampionId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(CHAMPION_BY_ID, id)
}

/** `Kaira, the Ascendant Reaver` — the §5 template, assembled. */
export function championDisplayName(entry: ChampionDefinition): string {
    return `${entry.givenName}, the ${RARITY_EPITHET[entry.rarity]} ${entry.title}`
}

export function championsOfRarity(rarity: Rarity): ChampionDefinition[] {
    return CHAMPIONS.filter(entry => entry.rarity === rarity)
}

/** Whether this roster populates a rarity — all six today, asserted in `content.spec.ts`. */
export function championRarityHasContent(rarity: Rarity): boolean {
    return CHAMPIONS.some(entry => entry.rarity === rarity)
}

/**
 * Resolve a rolled rarity to a Champion. Throws if the rarity is unpopulated — see the drop-table
 * note in `gacha.ts` before ever shipping a partial roster.
 *
 * `roll` is supplied by the caller because `shared/` must stay pure — the entropy is the
 * server's.
 */
export function championFromRoll(rarity: Rarity, roll: number): ChampionDefinition {
    const pool = championsOfRarity(rarity)
    if (pool.length === 0) throw new Error(`No Champion authored at rarity: ${rarity}`)
    const index = Math.min(pool.length - 1, Math.floor(Math.min(1, Math.max(0, roll)) * pool.length))
    return pool[index]!
}
