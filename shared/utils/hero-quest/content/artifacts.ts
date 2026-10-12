/**
 * The Dig-site — Artifact roster and the 33-effect pool (`artifacts-dig-site-gacha.md`).
 *
 * **Party-wide and passive-only** (§1). Every equipped Artifact's effect applies to the whole
 * fielded party — Hero and all active Champions — which is the one thing that distinguishes this
 * system from the other three: Champions *are* the party, Skills are the Hero's own loadout, and
 * Gear is Hero-only equipment. No actives, no cooldowns, no buttons anywhere in here.
 *
 * ## What is doc-specified, and what is not
 *
 * **Specified and reproduced faithfully:** the four categories and their stat domains (§2), the
 * 48-item roster shape — 2 per category per rarity (§3), the effect-line count per rarity (§3),
 * the full 33-effect pool with each effect's shape (§3), the reuse ceiling of 3 per effect (§3),
 * additive same-category stacking with no cap and no set bonuses (§4), and the 2→5 slot
 * progression (§7).
 *
 * **Not specified:** Artifact *names* and the per-item rarity assignment of pool effects — §3
 * leaves both "to implementation", the same deferral Champions had. Names were authored in the
 * 2026-09-15 naming pass (`ARTIFACT_NAMES`); the effect assignment is still a shared distribution
 * table (`ARTIFACT_EFFECT_SLOTS`) rather than 48 authored choices.
 *
 * ## Every effect is rendered as a passive modifier, and several are approximations
 *
 * The pool describes machinery the engine does not have: buffs that ramp over a fight's duration,
 * procs on kill, a once-per-fight death save, cooldown refunds on crit. The averaged idle rate is
 * one frozen rate per window by construction (`tech-architecture.md` §4a) and has no notion of
 * "later in the fight" at all. Each such effect is rendered as the nearest honest modifier, with a
 * `note` saying what was dropped.
 */

import {
    ARTIFACT_COLLECTION_PASSIVE_FRACTION,
    ARTIFACT_ECONOMY_COEFFICIENT,
    ARTIFACT_EFFECT_PER_POINT
} from '../constants'
import {
    RARITIES,
    RARITY_EFFECT_LINES,
    RARITY_STAT_MULTIPLIER,
    investmentScalar
} from '../gacha'
import { COLLECTION_PASSIVE_KINDS, type HqModifier, type ModifierKind } from '../modifiers'
import type { HqStatKey, OwnedCopy, Rarity } from '../types'

/** The four effect categories — stat *domains*, deliberately not Champion archetypes (§2). */
export type ArtifactCategory = 'offense' | 'defense' | 'tempo' | 'fortune'

export const ARTIFACT_CATEGORIES: readonly ArtifactCategory[] = [
    'offense', 'defense', 'tempo', 'fortune'
]

export const ARTIFACT_CATEGORY_NAME: Readonly<Record<ArtifactCategory, string>> = {
    offense: 'Offense',
    defense: 'Defense',
    tempo: 'Tempo',
    fortune: 'Fortune'
}

/** §2's domain column, for the UI. */
export const ARTIFACT_CATEGORY_DOMAIN: Readonly<Record<ArtifactCategory, string>> = {
    offense: 'Damage output',
    defense: 'Survivability',
    tempo: 'Speed and uptime',
    fortune: 'Economy'
}

/**
 * One entry in a category's effect pool.
 *
 * `kind`/`stat` are the mechanical rendering; `shape` is §3's own description of what the effect
 * *is*, kept verbatim so the rendering can be checked against the intent rather than replacing
 * it. `note` is present only where the two differ.
 */
export interface ArtifactEffectDefinition {
    id: string
    name: string
    category: ArtifactCategory
    kind: ModifierKind
    stat?: HqStatKey
    /** §3's wording. */
    shape: string
    /** What the engine cannot express, when something was dropped. */
    note?: string
}

function effect(
    category: ArtifactCategory,
    name: string,
    kind: ModifierKind,
    shape: string,
    options: { stat?: HqStatKey; note?: string } = {}
): ArtifactEffectDefinition {
    return {
        id: `artifact_effect_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
        name,
        category,
        kind,
        stat: options.stat,
        shape,
        note: options.note
    }
}

/**
 * The full 33-effect pool — Offense 9, Defense 8, Tempo 9, Fortune 7 (§3).
 *
 * Order matters: `ARTIFACT_EFFECT_SLOTS` indexes into these arrays, so the distribution's
 * properties are a consequence of one table rather than 48 chances to break the reuse ceiling.
 */
export const ARTIFACT_EFFECT_POOL: Readonly<Record<ArtifactCategory, readonly ArtifactEffectDefinition[]>> = {
    offense: [
        effect('offense', 'Might Surge', 'stat', 'Flat +% party PWR', { stat: 'pwr' }),
        effect('offense', 'Precision Edge', 'critChance', '+% party crit chance'),
        effect('offense', 'Killing Blow', 'critDamage', '+% party crit damage'),
        effect('offense', 'Momentum', 'stat', 'PWR buff that ramps the longer the current fight runs', {
            stat: 'pwr',
            note: 'Rendered flat. The idle rate is one frozen average per window and has no '
                + '"later in the fight"; a ramp and its own time-average are the same number there.'
        }),
        effect('offense', 'Opening Strike', 'stat', 'Burst of bonus PWR at fight start, decaying over time', {
            stat: 'pwr',
            note: 'Rendered flat, same reason as Momentum — and note the two are mechanically '
                + 'identical once averaged. They stay separate entries because the distribution '
                + 'below counts uses per effect, and merging them would change the reuse arithmetic.'
        }),
        effect('offense', 'Last Stand', 'stat', 'PWR buff that grows the fewer party members remain alive', {
            stat: 'pwr',
            note: 'Rendered flat. Conditioning on living party size would make the projection '
                + 'reward being nearly dead, which the averaged model cannot represent honestly.'
        }),
        effect('offense', 'Shattering Blow', 'enemyDefShred', 'Chance on any party hit to apply a stacking armor-shred debuff', {
            note: 'Always-on rather than a proc, the same call Guardian\'s Reflect and Chain Bind '
                + 'made: a per-hit roll adds variance on top of crit for no gain.'
        }),
        effect('offense', 'Defense Penetration', 'enemyDefShred', 'Flat/% ignore of enemy DEF on all party damage'),
        effect('offense', 'Cull', 'stat', 'Bonus damage to enemies below a HP% threshold', {
            stat: 'pwr',
            note: 'Rendered as flat PWR. A real HP-threshold term exists on the ability side '
                + '(`AbilityEffect.executeBonus`) but nothing carries a passive one, and a wave '
                + 'pack\'s average HP fraction is not a quantity the frozen rate model tracks.'
        })
    ],
    defense: [
        effect('defense', 'Iron Ward', 'stat', 'Flat +% party DEF', { stat: 'def' }),
        effect('defense', 'Vital Bloom', 'maxHp', '+% party max HP'),
        effect('defense', 'Deflection', 'damageTaken', 'Chance to further reduce incoming hit damage on top of normal mitigation', {
            note: 'Always-on rather than a proc, as above.'
        }),
        effect('defense', 'Steady Ground', 'stat', 'DEF buff that ramps the longer the current fight runs', {
            stat: 'def',
            note: 'Rendered flat — the Momentum case on the defensive side.'
        }),
        effect('defense', "Bulwark's Legacy", 'damageTaken', 'Flat damage reduction on the first hit any party member takes each fight', {
            note: 'Rendered as continuous reduction. "First hit each fight" needs a per-fight '
                + 'trigger the idle rate does not have — and against 30 kills per stage, a '
                + 'once-per-encounter save averages out to a small continuous reduction anyway.'
        }),
        effect('defense', "Guardian's Echo", 'damageTaken', 'Small heal-over-time triggered whenever any party member drops below a HP threshold', {
            note: 'Rendered as damage reduction rather than sustain. Sustain and mitigation are '
                + 'the same axis in the averaged model (`sustainedIncoming` folds healing into '
                + 'exactly this), and routing it through mitigation keeps it under '
                + '`MAX_SUSTAIN_MITIGATION` — which exists to stop projected healing making a '
                + 'party immortal.'
        }),
        effect('defense', 'Unbroken', 'maxHp', 'Once per fight, prevents a killing blow from dropping a party member below 1 HP', {
            note: 'Rendered as extra max HP. A death save is survivability measured in one more '
                + 'hit taken, and max HP is how the model counts hits survived '
                + '(`killsBeforeWipe`). What is lost is the once-per-fight ceiling.'
        }),
        effect('defense', 'Crit Resistance', 'damageTaken', 'Reduced chance to be crit, and/or reduced crit damage taken', {
            note: 'Rendered as flat damage reduction: enemies have no crit stat at all — '
                + '`EnemyStats` is HP/PWR/DEF — so there is no incoming crit to resist yet. '
                + 'Reduction is the honest stand-in until enemies gain one.'
        })
    ],
    tempo: [
        effect('tempo', 'Swift Current', 'stat', 'Flat +% party SPD', { stat: 'spd' }),
        effect('tempo', 'Quickening', 'cooldown', 'All cooldowns start each fight partially pre-charged', {
            note: 'Rendered as a flat cooldown reduction. Pre-charging shifts the first cast '
                + 'earlier, which over any window longer than one cooldown is exactly a shorter '
                + 'cooldown — and settle resolves windows measured in hours.'
        }),
        effect('tempo', 'Flow State', 'stat', 'SPD buff that ramps the longer the current fight runs', {
            stat: 'spd',
            note: 'Rendered flat — the Momentum case on the speed axis.'
        }),
        effect('tempo', 'Alacrity Surge', 'stat', 'Burst of +SPD at fight start, decaying over time', {
            stat: 'spd',
            note: 'Rendered flat, as Opening Strike.'
        }),
        effect('tempo', 'Overdrive', 'stat', 'SPD buff that grows the fewer party members remain alive', {
            stat: 'spd',
            note: 'Rendered flat, as Last Stand.'
        }),
        effect('tempo', 'Slipstream', 'cooldown', "Small chance, on any skill's cooldown completing, to shave time off another near-ready cooldown", {
            note: 'Rendered as a flat cooldown reduction — which is what a chance to shave a '
                + 'cooldown amounts to once averaged.'
        }),
        effect('tempo', 'Chain Reaction', 'cooldown', "Landing a crit has a chance to instantly refresh part of the cooldown on that unit's next-soonest skill", {
            note: 'Rendered as a flat cooldown reduction. The crit dependency is dropped, which '
                + 'means it no longer scales with the party\'s crit rate — a real loss of '
                + 'identity, and the clearest candidate for revisiting if a proc channel is ever '
                + 'built.'
        }),
        effect('tempo', 'Double Cast', 'cooldown', 'Small chance any skill fires an immediate second activation', {
            note: 'Rendered as a flat cooldown reduction. A chance of an extra activation and a '
                + 'shorter cooldown are the same casts-per-minute; only the burstiness differs.'
        }),
        effect('tempo', 'Unshaken', 'controlResist', 'Reduces the duration of stuns/silences/freezes and other disables applied to the party', {
            note: 'Shortens every hostile status a boss special lands, debuffs and burns '
                + 'included. Only bosses have abilities, so it does nothing outside a boss fight.'
        })
    ],
    fortune: [
        effect('fortune', "Prospector's Fortune", 'gold', 'Flat +% Gold gain'),
        effect('fortune', "Scholar's Boon", 'xp', 'Flat +% XP gain'),
        effect('fortune', 'Night Owl', 'offlineEfficiency', 'Flat +% offline-efficiency'),
        effect('fortune', 'Lucky Dig', 'gold', 'Chance on kill for a bonus Gold burst', {
            note: 'Rendered as a Gold rate. A per-kill chance times a burst size *is* a rate '
                + 'when the model counts kills per hour, and `gold-economy.md` §6 already '
                + 'requires the burst to be denominated in income rather than a flat amount.'
        }),
        effect('fortune', 'Quick Study', 'xp', 'Chance on kill for a bonus XP burst', {
            note: 'Rendered as an XP rate, same reasoning as Lucky Dig.'
        }),
        effect('fortune', 'Compound Interest', 'gold', 'Gold gain% that ramps the longer the current fight runs', {
            note: 'Rendered flat — the Momentum case on the economy axis.'
        }),
        effect('fortune', 'Windfall', 'gold', 'On stage clear, small chance to instantly grant a Gold burst worth a few minutes of current income', {
            note: 'Rendered as a Gold rate. Stage clears are frequent enough (5 packs a stage) '
                + 'that a per-clear chance averages cleanly.'
        })
    ]
}

export const ARTIFACT_EFFECT_BY_ID: Readonly<Record<string, ArtifactEffectDefinition>> =
    Object.fromEntries(
        ARTIFACT_CATEGORIES.flatMap(category =>
            ARTIFACT_EFFECT_POOL[category].map(entry => [entry.id, entry])
        )
    )

// ── Roster ─────────────────────────────────────────────  §3

/** Two per rarity, ascending — the twelve slots each category fills. Same shape as Champions'. */
const ROSTER_RARITIES: readonly Rarity[] = [
    'common', 'common',
    'uncommon', 'uncommon',
    'rare', 'rare',
    'epic', 'epic',
    'legendary', 'legendary',
    'mythic', 'mythic'
]

/**
 * Which pool effects each of those twelve slots draws, as indices into its category's pool.
 *
 * ## The arithmetic, and why this exact distribution
 *
 * §3 fixes the budget: 12 Artifacts per category needing 20 effect-line fills (6 solo at
 * Common/Uncommon/Rare + 8 across the Epic/Legendary pairs + 6 across the Mythic triples), under
 * a **ceiling of 3 uses per effect**. Against pools of 9/8/9/7 that is comfortable — 20 fills
 * into 21–27 capacity — which is exactly what §3's correction says: the ceiling is the rule, not
 * a fixed count of 3 each.
 *
 *     common     {0}     / {1}
 *     uncommon   {2}     / {3}
 *     rare       {4}     / {5}
 *     epic       {0,6}   / {1,2}
 *     legendary  {3,6}   / {4,5}
 *     mythic     {0,1,2} / {3,4,5}
 *
 * Shared by all four categories, so the three structural rules — line count per rarity, the ≤3
 * reuse cap, and no two same-rarity Artifacts sharing a kit — are properties of one table.
 *
 * **Index 6 debuts at Epic**, which is §3's own "flavor device": each category's newest effect
 * (Shattering Blow, Unbroken, Chain Reaction, Windfall — all four listed at index 6) never
 * appears at a solo rarity. §3 notes that the larger pools made this optional rather than
 * required, and keeps it deliberately.
 *
 * **Fortune has only 7 effects and its slots reach index 6**, so the whole pool is used; the
 * other three categories have 8–9 and leave their tail unreached — Defense Penetration and Cull,
 * Crit Resistance, Double Cast and Unshaken sit in the pool but on no Artifact. That is the
 * consequence of one shared table rather than four bespoke ones; the assignment pass can promote
 * them.
 */
const ARTIFACT_EFFECT_SLOTS: readonly (readonly number[])[] = [
    [0], [1],
    [2], [3],
    [4], [5],
    [0, 6], [1, 2],
    [3, 6], [4, 5],
    [0, 1, 2], [3, 4, 5]
]

export interface ArtifactDefinition {
    /** Stable string ID. Save data references this, never an index. */
    id: string
    /** Authored in `ARTIFACT_NAMES`. Display only — saves reference `id`. */
    name: string
    category: ArtifactCategory
    rarity: Rarity
    /** Count equals `RARITY_EFFECT_LINES[rarity]` — asserted in `content.spec.ts`. */
    effects: readonly ArtifactEffectDefinition[]
}

/**
 * Artifact names, twelve per category, in `ROSTER_RARITIES` order — so each name sits beside the
 * effect slot in `ARTIFACT_EFFECT_SLOTS` it was written for.
 *
 * **Relics dug out of the ten worlds** (`content/worlds.ts`). Commons are frontier odds and ends
 * from Thornwick Vale and Mirewood; a relic that belonged to a world's boss or super boss sits
 * higher than that world's rank-and-file; and every Mythic comes from Duskspire (World 6) or
 * deeper. Each name points at what its effects do: the
 * war drum ramps, the distress bell is Overdrive's last-member-standing speed, the grave robber's
 * spade is a Gold-on-kill dig.
 *
 * **Rules, enforced in `content.spec.ts`:** every name is unique (§4 — one owned instance per named
 * Artifact), none repeats a pool effect's name, and none reuses a Champion given name or title.
 * No rarity epithet: the card already shows rarity as colour and label, and "Exalted Citadel" was
 * the Gear-style stand-in this replaces.
 *
 * Changing a name here never touches a save — collections and loadouts reference the ID.
 */
const ARTIFACT_NAMES: Readonly<Record<ArtifactCategory, readonly string[]>> = {
    offense: [
        'Goblin Cudgel', // Might Surge
        "Tracker's Flint", // Precision Edge
        "Slagjaw's Tooth", // Killing Blow
        'Frostbound War Drum', // Momentum
        'Dawnbreak Arrowhead', // Opening Strike
        'Last Legion Standard', // Last Stand
        "Hrimgar's Icebreaker", // Might Surge + Shattering Blow
        'Eye of Pyrrhax', // Precision Edge + Killing Blow
        'Stormcrown Talon', // Momentum + Shattering Blow
        'Banner of the Bonefields', // Opening Strike + Last Stand
        "Ithren's Burning Sigil", // Might Surge + Precision Edge + Killing Blow
        'Key to the Last Door' // Momentum + Opening Strike + Last Stand
    ],
    defense: [
        'Hedgeknight Buckler', // Iron Ward
        'Mireroot Charm', // Vital Bloom
        'Cinderscale Shard', // Deflection
        'Rimeholt Hearthstone', // Steady Ground
        'Tideglass Pendant', // Bulwark's Legacy
        "Mother Leech's Vial", // Guardian's Echo
        "Grave Marshal's Pauldron", // Iron Ward + Unbroken
        'Rotheart Barkshield', // Vital Bloom + Deflection
        "Glacier Titan's Heart", // Steady Ground + Unbroken
        "Maerith's Pearl", // Bulwark's Legacy + Guardian's Echo
        "Ossuar's Bone Mantle", // Iron Ward + Vital Bloom + Deflection
        "Vesper's Forgotten Hymn" // Steady Ground + Bulwark's Legacy + Guardian's Echo
    ],
    tempo: [
        'Bramblefoot Sandals', // Swift Current
        'Marsh Hourglass', // Quickening
        'Ashwalker Anklet', // Flow State
        'Frostbite Horn', // Alacrity Surge
        "Sailor's Distress Bell", // Overdrive
        "Acolyte's Prayer Beads", // Slipstream
        "Halvane's Spellglass", // Swift Current + Chain Reaction
        "Korr's Marching Drum", // Quickening + Flow State
        'Skyshard Prism', // Alacrity Surge + Chain Reaction
        'Zephyrax Wingbone', // Overdrive + Slipstream
        'Lodestone of the Brink', // Swift Current + Quickening + Flow State
        "Herald's Stopped Clock" // Alacrity Surge + Overdrive + Slipstream
    ],
    fortune: [
        'Thornwick Copper', // Prospector's Fortune
        'Hedge-Witch Almanac', // Scholar's Boon
        'Mirewood Night Lantern', // Night Owl
        'Kobold Prospecting Pick', // Lucky Dig
        'Rimeholt Saga Stone', // Quick Study
        'Amarath Tide Ledger', // Compound Interest
        'Sunken Doubloon', // Prospector's Fortune + Windfall
        'Duskspire Star Chart', // Scholar's Boon + Night Owl
        "Grave Robber's Spade", // Lucky Dig + Windfall
        'Tome of Unfinished Lessons', // Quick Study + Compound Interest
        'Hoard of the Shattered Sky', // Prospector's Fortune + Scholar's Boon + Night Owl
        'Last Coin of the Void' // Lucky Dig + Quick Study + Compound Interest
    ]
}

/** `offense` + slot 10 → `artifact_offense_10`. Stable across a retitle, which is the point. */
function artifactIdFor(category: ArtifactCategory, slot: number): string {
    return `artifact_${category}_${slot}`
}

/**
 * **All 48.** Four categories × two per rarity × six rarities (§3).
 *
 * Assembled from `ARTIFACT_NAMES` and `ARTIFACT_EFFECT_SLOTS` rather than written out — the same
 * two-table construction the Champion roster uses, and for the same reason: the structural rules
 * become consequences of one distribution instead of 48 opportunities to break one.
 */
export const ARTIFACTS: readonly ArtifactDefinition[] = ARTIFACT_CATEGORIES.flatMap(category =>
    ROSTER_RARITIES.map((rarity, slot) => {
        const pool = ARTIFACT_EFFECT_POOL[category]
        return {
            id: artifactIdFor(category, slot),
            name: ARTIFACT_NAMES[category][slot]!,
            category,
            rarity,
            effects: ARTIFACT_EFFECT_SLOTS[slot]!.map(index => pool[index]!)
        }
    })
)

export const ARTIFACT_BY_ID: Readonly<Record<string, ArtifactDefinition>> = Object.fromEntries(
    ARTIFACTS.map(entry => [entry.id, entry])
)

export function getArtifact(id: string): ArtifactDefinition {
    const entry = ARTIFACT_BY_ID[id]
    if (!entry) throw new Error(`Unknown artifact id: ${id}`)
    return entry
}

export function isArtifactId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(ARTIFACT_BY_ID, id)
}

export function artifactsOfRarity(rarity: Rarity): ArtifactDefinition[] {
    return ARTIFACTS.filter(entry => entry.rarity === rarity)
}

/** All six rarities carry eight Artifacts each. */
export function artifactRarityHasContent(rarity: Rarity): boolean {
    return ARTIFACTS.some(entry => entry.rarity === rarity)
}

export function artifactFromRoll(rarity: Rarity, roll: number): ArtifactDefinition {
    const pool = artifactsOfRarity(rarity)
    if (pool.length === 0) throw new Error(`No Artifact authored at rarity: ${rarity}`)
    const index = Math.min(pool.length - 1, Math.floor(Math.min(1, Math.max(0, roll)) * pool.length))
    return pool[index]!
}

// ── Effect magnitudes ──────────────────────────────────  §6

/**
 * One effect line's magnitude, from its rarity and the copy's investment scalar.
 *
 *     magnitude = ARTIFACT_EFFECT_PER_POINT × RARITY_STAT_MULTIPLIER[rarity] × (star×10+level)
 *
 * §6 states outright that Artifact effect-line magnitudes "scale with the same
 * `(star × 10 + level)` scalar already reused for Champion leveling and the Champion passive",
 * which is why this is proportional where a Skill's potency is identity-at-minimum.
 *
 * Economy lines are throttled by `ARTIFACT_ECONOMY_COEFFICIENT` — `gold-economy.md` §5's "keep
 * Gold-granting bonuses small".
 */
export function artifactLineMagnitude(
    kind: ModifierKind,
    rarity: Rarity,
    star: number,
    level: number
): number {
    const base = ARTIFACT_EFFECT_PER_POINT
        * RARITY_STAT_MULTIPLIER[rarity]
        * investmentScalar(star, level)
    const economic = kind === 'gold' || kind === 'xp' || kind === 'offlineEfficiency'
    return economic ? base * ARTIFACT_ECONOMY_COEFFICIENT : base
}

/**
 * Every equipped Artifact's effect lines, party-wide.
 *
 * **Equipped only, and no cap on category overlap** — §4 confirms a player may run five Offense
 * Artifacts at once, and different Artifacts sharing a category stack additively. `sumModifiers`
 * is additive by construction, so that rule needs no enforcement here; it is a property of the
 * pipeline rather than a check.
 *
 * Equipped only — every owned copy, this one included, also pays the smaller, Hero-only
 * `artifactCollectionModifiers`.
 */
export function artifactModifiers(equipped: readonly OwnedCopy[]): HqModifier[] {
    return equipped.flatMap((copy) => {
        if (!isArtifactId(copy.contentId)) return []
        const definition = getArtifact(copy.contentId)
        return definition.effects.map(line => ({
            kind: line.kind,
            stat: line.stat,
            magnitude: artifactLineMagnitude(line.kind, definition.rarity, copy.star, copy.level)
        }))
    })
}

/**
 * The collection passive: what every **owned** Artifact gives the Hero, equipped or not.
 *
 * Mirrors Gear's `passiveBonus` (decided 2026-09-15 — §1 granted an un-slotted Artifact nothing
 * before): `ARTIFACT_COLLECTION_PASSIVE_FRACTION` of each combat-stat line it would pay equipped
 * (`COLLECTION_PASSIVE_KINDS`), at its own rarity and investment. **Hero only** — the caller routes
 * it with Gear and Skills, not with the party-wide equipped Artifacts. Additive with equipping
 * (decided 2026-10-04): an equipped copy pays this as well as its party-wide lines.
 */
export function artifactCollectionModifiers(owned: readonly OwnedCopy[]): HqModifier[] {
    return owned.flatMap((copy) => {
        if (!isArtifactId(copy.contentId)) return []
        const definition = getArtifact(copy.contentId)
        return definition.effects.flatMap((line) => {
            const share = artifactCollectionShare(
                line.kind, artifactLineMagnitude(line.kind, definition.rarity, copy.star, copy.level)
            )
            return share === null ? [] : [{ kind: line.kind, stat: line.stat, magnitude: share }]
        })
    })
}

/**
 * What one effect line, at the magnitude it pays equipped, pays the Hero through the collection
 * passive while its copy is owned; null for a line that does not pass (`COLLECTION_PASSIVE_KINDS`).
 */
export function artifactCollectionShare(kind: ModifierKind, magnitude: number): number | null {
    return COLLECTION_PASSIVE_KINDS.has(kind) ? magnitude * ARTIFACT_COLLECTION_PASSIVE_FRACTION : null
}

/** Rarities and the line table, re-exported so an Artifact-facing caller has one import. */
export { RARITIES, RARITY_EFFECT_LINES }
