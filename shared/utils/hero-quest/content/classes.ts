/**
 * The 16-node class tree (`classes-and-combat.md` §1) with its stat spreads and
 * specialization deltas (§2).
 *
 * Spreads are the doc's own tier words; the numbers they resolve to live in
 * `STAT_TIER_VALUES`. Deltas are the doc's directional table, with its "modest" /
 * "extreme" qualifiers mapped onto the three DELTA_* magnitude constants. Both accumulate
 * down the path, so Berserker carries Warrior's and Barbarian's shifts.
 *
 * A skill's cooldown comes from its tier on the cooldown ladder (`CLASS_TIER_RANK`); what else
 * differs per skill is its effect shape — see `skill` below.
 */

import {
    ASCENDANT_KIT_SIZE,
    CONVERGENCE_COOLDOWN_FACTOR,
    DELTA_EXTREME,
    DELTA_MODEST,
    DELTA_NORMAL,
    ENRAGE_DEF_PENALTY,
    ENRAGE_PWR_BONUS,
    HASTE_SPD_BONUS,
    KILL_SHOT_CRIT_MULTIPLIER,
    SKILL_AOE_MULTIPLIER,
    SKILL_BASE_ABILITY_MULTIPLIER,
    SKILL_BASE_COOLDOWN_SECONDS,
    SKILL_BUFF_FRACTION,
    SKILL_CONTROL_DURATION_SECONDS,
    SKILL_DEBUFF_FRACTION,
    SKILL_DOT_MULTIPLIER,
    SKILL_HEAL_MULTIPLIER,
    SKILL_HOT_MULTIPLIER,
    SKILL_LINE_MULTIPLIER,
    SKILL_PIERCE_MULTIPLIER,
    SKILL_STATUS_DURATION_SECONDS,
    STAT_TIER_VALUES
} from '../constants'
import { onCooldownRank, SINGLE_TARGET } from '../effects'
import type { AbilityEffect } from '../effects'
import type { ClassId, ClassNode, ClassSkill, ClassTier, FormationRow, HqStatDelta, HqStatKey, StatTier } from '../types'

export const ROOT_CLASS_ID: ClassId = 'class_beginner'

/**
 * A class node's ability.
 *
 * Written at the base cooldown; `CLASS_NODES` moves each onto its tier's rank of the ladder, as
 * `classes-and-combat.md` §3 anticipates ("every skill's cooldown length will differ"). What
 * *is* authored here is each ability's **shape**: its target pattern, its damage relative
 * to a plain hit, and any status it carries.
 *
 * Nine of the sixteen have a one-clause behavioural hint in the docs; the other seven had only a
 * name and were specified here. Each carries a comment saying which ("Doc-specified" or
 * "Specified this pass"), so "the doc said this" and "we decided this" stay distinguishable.
 */
function skill(
    id: string,
    name: string,
    effect: AbilityEffect = SINGLE_TARGET,
    abilityMultiplier: number = SKILL_BASE_ABILITY_MULTIPLIER
): ClassSkill {
    return {
        id,
        name,
        cooldownSeconds: SKILL_BASE_COOLDOWN_SECONDS,
        abilityMultiplier,
        effect
    }
}

/** A pure-utility ability deals no weapon damage; its whole payload is the effect. */
const NO_DAMAGE = 0

/**
 * Front-row defaults, from `classes-and-combat.md` §6: Beginner, Warrior, Barbarian,
 * Berserker, Knight, Paladin — which is exactly the Beginner root plus the whole Warrior
 * line, and nothing else. Derived from the tree rather than restated per node, so adding a
 * Warrior specialization later cannot silently default it to the back row.
 *
 * A *default* only. Every slot stays manually reassignable, and the player's saved formation
 * overrides this whenever one exists.
 */
const FRONT_ROW_LINE: ClassId = 'class_warrior'

const CLASS_NODE_SPECS: readonly Omit<ClassNode, 'defaultRow'>[] = [
    {
        id: 'class_beginner',
        name: 'Beginner',
        parentId: null,
        tier: 'beginner',
        skill: skill('skill_haste', 'Haste', {
            // Doc-specified (§3): temporarily doubles SPD, shortening every owned cooldown.
            target: 'self',
            selfStatus: {
                kind: 'buff', stat: 'spd',
                duration: SKILL_STATUS_DURATION_SECONDS, magnitude: HASTE_SPD_BONUS
            }
        }, NO_DAMAGE),
        /**
         * Decided, not transcribed. The Beginner has no damage in its kit and a fresh account
         * fields it alone, so an all-`mid`, one-strike spread left it at a fraction of every base
         * class's DPS. `high` PWR matches the base classes; `high` SPD and the second strike are
         * the Beginner's own and node-local (spreads and strikes are not inherited), so no later
         * class carries them. See `BOSS_HP_MULT` for the gate that stops a solo Beginner at
         * Stage 5.
         */
        spread: { pwr: 'high', spd: 'high', lck: 'mid', imp: 'mid', vit: 'mid', def: 'mid' },
        delta: {},
        strikesPerAttack: 2,
        autoTarget: 'lowest_hp_pct'
    },

    // ── Warrior path ───────────────────────────────────────────────────────────────────
    {
        id: 'class_warrior',
        name: 'Warrior',
        parentId: 'class_beginner',
        tier: 'base',
        skill: skill('skill_whirlwind', 'Whirlwind', {
            // Specified this pass. A melee spin reaches what is adjacent, so it sweeps the
            // front line rather than the whole board — the Warrior's reach is its limit.
            target: 'enemy_front_line'
        }, SKILL_LINE_MULTIPLIER),
        spread: { pwr: 'high', spd: 'low', lck: 'low', imp: 'mid', vit: 'high', def: 'high' },
        delta: {},
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },
    {
        id: 'class_barbarian',
        name: 'Barbarian',
        parentId: 'class_warrior',
        tier: 'elite',
        skill: skill('skill_threatening_roar', 'Threatening Roar', {
            // Specified this pass. The Warrior path carries a threat modifier (§7) but had no
            // way to *use* it; this is that tool — a roar that cows the whole encounter and
            // pulls it onto the roarer. Utility rather than damage, which is what makes it
            // the path's aggro button instead of a second Whirlwind.
            target: 'enemy_all',
            status: {
                kind: 'debuff', stat: 'pwr',
                duration: SKILL_STATUS_DURATION_SECONDS, magnitude: SKILL_DEBUFF_FRACTION
            },
            selfStatus: { kind: 'taunt', duration: SKILL_STATUS_DURATION_SECONDS }
        }, NO_DAMAGE),
        spread: { pwr: 'high', spd: 'low', lck: 'low', imp: 'mid', vit: 'high', def: 'high' },
        // doubling down on Warrior's damage focus
        delta: { pwr: DELTA_NORMAL, def: -DELTA_NORMAL, vit: -DELTA_NORMAL },
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },
    {
        id: 'class_berserker',
        name: 'Berserker',
        parentId: 'class_barbarian',
        tier: 'master',
        skill: skill('skill_enrage', 'Enrage', {
            // Doc-specified (§2): trades incoming damage taken for output, as a skill-level
            // cost rather than a base-stat one. Both halves land on the Berserker itself —
            // the DEF debuff is the "cost" half and is what stops this being a free buff.
            target: 'self',
            selfStatus: {
                kind: 'buff', stat: 'pwr',
                duration: SKILL_STATUS_DURATION_SECONDS, magnitude: ENRAGE_PWR_BONUS
            },
            status: {
                kind: 'debuff', stat: 'def',
                duration: SKILL_STATUS_DURATION_SECONDS, magnitude: ENRAGE_DEF_PENALTY
            }
        }, NO_DAMAGE),
        spread: { pwr: 'high', spd: 'low', lck: 'low', imp: 'mid', vit: 'high', def: 'high' },
        // Enrage's DEF trade is a skill-level cost, not a base-stat one
        delta: { pwr: DELTA_EXTREME },
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },
    {
        id: 'class_knight',
        name: 'Knight',
        parentId: 'class_warrior',
        tier: 'elite',
        skill: skill('skill_shockwave', 'Shockwave', {
            // Specified this pass. A wave travels outward, so unlike Whirlwind it reaches the
            // whole encounter — and being a Knight tool it staggers rather than shreds. The
            // elite tier out-reaching its base tier is the intended progression.
            target: 'enemy_all',
            status: { kind: 'stun', duration: SKILL_CONTROL_DURATION_SECONDS }
        }, SKILL_AOE_MULTIPLIER),
        spread: { pwr: 'high', spd: 'low', lck: 'low', imp: 'mid', vit: 'high', def: 'high' },
        // near-opposite of Barbarian
        delta: { def: DELTA_NORMAL, vit: DELTA_NORMAL, pwr: -DELTA_NORMAL },
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },
    {
        id: 'class_paladin',
        name: 'Paladin',
        parentId: 'class_knight',
        tier: 'master',
        skill: skill('skill_disciple', 'Disciple', {
            // Doc calls this a summon (§2) — but a summon needs a unit lifecycle (own stats,
            // duration, formation slot) no doc designs, so the literal reading is deferred.
            // Rendered as the disciple's *effect* on the party: it tends them.
            target: 'ally_all',
            heal: SKILL_HEAL_MULTIPLIER,
            status: {
                kind: 'hot', duration: SKILL_STATUS_DURATION_SECONDS,
                magnitude: SKILL_HOT_MULTIPLIER, scalesWithPwr: true
            }
        }, NO_DAMAGE),
        spread: { pwr: 'high', spd: 'low', lck: 'low', imp: 'mid', vit: 'high', def: 'high' },
        // "raw damage output not enhanced very much" — utility-weighted via its summon
        delta: { pwr: DELTA_MODEST },
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },

    // ── Mage path ──────────────────────────────────────────────────────────────────────
    {
        id: 'class_mage',
        name: 'Mage',
        parentId: 'class_beginner',
        tier: 'base',
        skill: skill('skill_ethereal_bouncebolt', 'Ethereal Bouncebolt', {
            // Doc-specified (§7): chains between enemies. Modelled as bouncing along the front
            // line — a chain that spreads across rather than punching through, which is what
            // keeps it distinct from Piercing Arrow.
            target: 'enemy_front_line'
        }, SKILL_LINE_MULTIPLIER),
        spread: { pwr: 'high', spd: 'high', lck: 'mid', imp: 'mid', vit: 'low', def: 'low' },
        delta: {},
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },
    {
        id: 'class_wizard',
        name: 'Wizard',
        parentId: 'class_mage',
        tier: 'elite',
        skill: skill('skill_lightning_storm', 'Lightning Storm', {
            // Doc-specified (§7): hits multiple targets.
            target: 'enemy_all'
        }, SKILL_AOE_MULTIPLIER),
        spread: { pwr: 'high', spd: 'high', lck: 'mid', imp: 'mid', vit: 'low', def: 'low' },
        // "standard attack rate accelerated"
        delta: { pwr: DELTA_NORMAL, spd: DELTA_NORMAL },
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },
    {
        id: 'class_sorcerer',
        name: 'Sorcerer',
        parentId: 'class_wizard',
        tier: 'master',
        skill: skill('skill_meteor_shower', 'Meteor Shower', {
            // Doc-specified (§7): hits multiple targets. The Sorcerer is the master tier of the
            // same line, so it is Lightning Storm with a burn left behind.
            target: 'enemy_all',
            status: {
                kind: 'dot', duration: SKILL_STATUS_DURATION_SECONDS,
                magnitude: SKILL_DOT_MULTIPLIER, scalesWithPwr: true
            }
        }, SKILL_AOE_MULTIPLIER),
        spread: { pwr: 'high', spd: 'high', lck: 'mid', imp: 'mid', vit: 'low', def: 'low' },
        // most fragile class in the tree, by design — clamps to MIN_STAT_VALUE on VIT/DEF
        delta: { pwr: DELTA_EXTREME, vit: -DELTA_NORMAL, def: -DELTA_NORMAL },
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },
    {
        id: 'class_shaman',
        name: 'Shaman',
        parentId: 'class_mage',
        tier: 'elite',
        skill: skill('skill_totem_storm', 'Totem Storm', {
            // Doc-specified only as affecting "the party or battlefield" (§7) — deliberately
            // ambiguous between the two, resolved here as the party reading: a totem that
            // empowers allies. The battlefield reading is still open, see open-items.
            target: 'ally_all',
            status: {
                kind: 'buff', stat: 'pwr',
                duration: SKILL_STATUS_DURATION_SECONDS, magnitude: SKILL_BUFF_FRACTION
            }
        }, NO_DAMAGE),
        spread: { pwr: 'high', spd: 'high', lck: 'mid', imp: 'mid', vit: 'low', def: 'low' },
        // "tougher... slightly more defensive" than Wizard
        delta: { vit: DELTA_NORMAL, def: DELTA_NORMAL },
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },
    {
        id: 'class_witch_doctor',
        name: 'Witch Doctor',
        parentId: 'class_shaman',
        tier: 'master',
        skill: skill('skill_raise_dead', 'Raise Dead', {
            // Grouped with Totem Storm as party-or-battlefield (§7) while the name implies a
            // summon. Both readings need machinery no doc provides, so it lands as the party
            // reading with a revival flavour: the fallen fight on as sustained healing.
            target: 'ally_all',
            heal: SKILL_HEAL_MULTIPLIER,
            status: {
                kind: 'hot', duration: SKILL_STATUS_DURATION_SECONDS,
                magnitude: SKILL_HOT_MULTIPLIER, scalesWithPwr: true
            }
        }, NO_DAMAGE),
        spread: { pwr: 'high', spd: 'high', lck: 'mid', imp: 'mid', vit: 'low', def: 'low' },
        // inherits Shaman's spread, utility-weighted via Raise Dead
        delta: {},
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    },

    // ── Archer path ────────────────────────────────────────────────────────────────────
    {
        id: 'class_archer',
        name: 'Archer',
        parentId: 'class_beginner',
        tier: 'base',
        skill: skill('skill_piercing_arrow', 'Piercing Arrow', {
            // Specified this pass: hits everything in a line running away from the shooter,
            // for slightly more than a basic attack — piercing exactly once on a two-deep grid.
            target: 'enemy_pierce'
        }, SKILL_PIERCE_MULTIPLIER),
        spread: { pwr: 'high', spd: 'mid_high', lck: 'high', imp: 'mid', vit: 'mid', def: 'mid' },
        delta: {},
        strikesPerAttack: 1,
        autoTarget: 'highest_pwr'
    },
    {
        id: 'class_bowman',
        name: 'Bowman',
        parentId: 'class_archer',
        tier: 'elite',
        skill: skill('skill_fan_of_arrows', 'Fan of Arrows', {
            // Specified this pass: a fan spreads across the front-most line.
            target: 'enemy_front_line'
        }, SKILL_LINE_MULTIPLIER),
        spread: { pwr: 'high', spd: 'mid_high', lck: 'high', imp: 'mid', vit: 'mid', def: 'mid' },
        // multi-attack focus
        delta: { spd: DELTA_NORMAL },
        strikesPerAttack: 1,
        autoTarget: 'highest_pwr'
    },
    {
        id: 'class_marksman',
        name: 'Marksman',
        parentId: 'class_bowman',
        tier: 'master',
        skill: skill('skill_arrow_rain', 'Arrow Rain', {
            // Specified this pass: falls on every occupied spot. The Archer line escalates
            // pierce (2) → line (3) → board (6) across base, elite and master.
            target: 'enemy_all'
        }, SKILL_AOE_MULTIPLIER),
        spread: { pwr: 'high', spd: 'mid_high', lck: 'high', imp: 'mid', vit: 'mid', def: 'mid' },
        delta: { spd: DELTA_NORMAL },
        strikesPerAttack: 1,
        autoTarget: 'highest_pwr'
    },
    {
        id: 'class_hunter',
        name: 'Hunter',
        parentId: 'class_archer',
        tier: 'elite',
        skill: skill('skill_kill_shot', 'Kill Shot', {
            // Specified this pass: a guaranteed crit that hits for double crit damage. Single
            // target by design — the Hunter's multi-strike lives on its autoattack (§7), not
            // here, which is how the stale "(triple-strike)" tag in §1 was resolved.
            target: 'enemy_single',
            alwaysCrits: true,
            critDamageMultiplier: KILL_SHOT_CRIT_MULTIPLIER
        }),
        spread: { pwr: 'high', spd: 'mid_high', lck: 'high', imp: 'mid', vit: 'mid', def: 'mid' },
        // single-target crit focus, reinforced by Kill Shot
        delta: { pwr: DELTA_NORMAL, lck: DELTA_NORMAL },
        strikesPerAttack: 3,
        autoTarget: 'highest_pwr'
    },
    {
        id: 'class_beast_master',
        name: 'Beast Master',
        parentId: 'class_hunter',
        tier: 'master',
        skill: skill('skill_mans_best_friend', "Man's Best Friend", {
            // Doc calls this a wolf summon (§2). Same deferral as Disciple — no unit lifecycle
            // exists — so the wolf is rendered as what it contributes: the Beast Master hits
            // harder while it fights alongside.
            target: 'self',
            selfStatus: {
                kind: 'buff', stat: 'pwr',
                duration: SKILL_STATUS_DURATION_SECONDS, magnitude: SKILL_BUFF_FRACTION
            }
        }, NO_DAMAGE),
        spread: { pwr: 'high', spd: 'mid_high', lck: 'high', imp: 'mid', vit: 'mid', def: 'mid' },
        // inherits Hunter's spread, utility-weighted via its wolf summon
        delta: {},
        strikesPerAttack: 4,
        autoTarget: 'highest_pwr'
    },

    // ── The capstone ───────────────────────────────────────────────────────────────────
    {
        id: 'class_ascendant',
        name: 'Ascendant',
        // Joined to all six masters rather than one (`capstone-class.md`), so it has no single
        // parent: `childrenOf` leaves it out, and the class pick reaches it by its own rule.
        parentId: null,
        tier: 'capstone',
        // Its own skill. Convergence is never cast as this entry: `kitFor` puts every master's skill
        // in its place, on one cooldown (`CONVERGENCE`).
        skill: skill('skill_convergence', 'Convergence', SINGLE_TARGET, NO_DAMAGE),
        // Both replaced in `CLASS_NODES` (`bestOfMasters`): the best of the six masters in each
        // stat, deltas included (the user's call).
        spread: { pwr: 'mid', spd: 'mid', lck: 'mid', imp: 'mid', vit: 'mid', def: 'mid' },
        delta: {},
        // Decided, not specified: best-of-each covers the stats only, and strikes are kit, not a
        // stat, so it swings once rather than taking the Beast Master's four.
        strikesPerAttack: 1,
        autoTarget: 'lowest_hp_pct'
    }
]

const SPEC_BY_ID = new Map(CLASS_NODE_SPECS.map(spec => [spec.id, spec]))

/**
 * Walks the spec array rather than calling `isDescendantOf`, which would be circular — that
 * helper reads `CLASS_BY_ID`, which is built from the very array this feeds.
 *
 * Note the root is checked *before* the walk: every node descends from Beginner, so folding
 * it into the loop condition would default the whole tree to the front row.
 */
function defaultRowFor(id: ClassId): FormationRow {
    if (id === ROOT_CLASS_ID) return 'front'
    let current = SPEC_BY_ID.get(id)
    while (current) {
        if (current.id === FRONT_ROW_LINE) return 'front'
        current = current.parentId ? SPEC_BY_ID.get(current.parentId) : undefined
    }
    return 'back'
}

/** Tree depth as a rank on the cooldown ladder: a deeper class's skill fires slower and harder. */
const CLASS_TIER_RANK: Readonly<Record<ClassTier, number>> = {
    beginner: 0,
    base: 1,
    elite: 2,
    master: 3,
    capstone: 4
}

const MASTER_SPECS = CLASS_NODE_SPECS.filter(spec => spec.tier === 'master')

/** A master's level-1 stat before scaling: its tier value plus every delta down its path. */
function masterRaw(spec: Omit<ClassNode, 'defaultRow'>, key: HqStatKey): number {
    let raw = STAT_TIER_VALUES[spec.spread[key]]
    for (let at: typeof spec | undefined = spec; at; at = at.parentId ? SPEC_BY_ID.get(at.parentId) : undefined) {
        raw += at.delta[key] ?? 0
    }
    return raw
}

/**
 * The Ascendant's stats: in each, the best of the six masters', deltas included. Written as the
 * best master's tier plus a delta that makes up the rest, so `stats.baseSpreadFor` and the stat
 * breakdown read it like any other class and arrive at that same best block.
 */
function bestOfMasters(): { spread: Record<HqStatKey, StatTier>, delta: HqStatDelta } {
    const spread = {} as Record<HqStatKey, StatTier>
    const delta: HqStatDelta = {}
    for (const key of Object.keys(MASTER_SPECS[0]!.spread) as HqStatKey[]) {
        const raw = Math.max(...MASTER_SPECS.map(m => masterRaw(m, key)))
        spread[key] = MASTER_SPECS.map(m => m.spread[key]).reduce((a, b) => STAT_TIER_VALUES[b] > STAT_TIER_VALUES[a] ? b : a)
        if (raw !== STAT_TIER_VALUES[spread[key]]) delta[key] = raw - STAT_TIER_VALUES[spread[key]]
    }
    return { spread, delta }
}

export const CLASS_NODES: readonly ClassNode[] = CLASS_NODE_SPECS.map(spec => ({
    ...spec,
    skill: onCooldownRank(spec.skill, CLASS_TIER_RANK[spec.tier]),
    ...(spec.tier === 'capstone' ? bestOfMasters() : {}),
    defaultRow: defaultRowFor(spec.id)
}))

export const CLASS_BY_ID: Readonly<Record<ClassId, ClassNode>> = Object.fromEntries(
    CLASS_NODES.map(node => [node.id, node])
) as Record<ClassId, ClassNode>

export const CLASS_IDS: readonly ClassId[] = CLASS_NODES.map(node => node.id)

export function getClass(id: ClassId): ClassNode {
    const node = CLASS_BY_ID[id]
    if (!node) throw new Error(`Unknown class id: ${id}`)
    return node
}

/** Root → node, inclusive. The order specialization deltas accumulate in. */
export function classPath(id: ClassId): ClassNode[] {
    const path: ClassNode[] = []
    let current: ClassNode | undefined = getClass(id)
    while (current) {
        path.unshift(current)
        current = current.parentId ? getClass(current.parentId) : undefined
    }
    return path
}

/** A node's children. The capstone is nobody's child: it is reached by its own rule. */
export function childrenOf(id: ClassId | null): ClassNode[] {
    return CLASS_NODES.filter(node => node.parentId === id && node.tier !== 'capstone')
}

export function isDescendantOf(id: ClassId, ancestor: ClassId): boolean {
    return classPath(id).some(node => node.id === ancestor) && id !== ancestor
}

/**
 * Every skill a node owns — its own plus every ancestor's, root first.
 *
 * Kits are cumulative and never replaced (`classes-and-combat.md` §4), which is also why
 * re-picking a deep node at a later prestige restores the whole chain rather than just that
 * node's skill: a Berserker owns Haste, Whirlwind, Threatening Roar and Enrage together.
 */
export function kitFor(id: ClassId, ascendantSkillIds: readonly string[] = []): ClassSkill[] {
    if (id === ASCENDANT_ID) return [...ascendantPicks(ascendantSkillIds), ...CONVERGENCE]
    return classPath(id).map(node => node.skill)
}

// ── The Ascendant ──────────────────────────────────────────────────────────────────────

export const ASCENDANT_ID: ClassId = 'class_ascendant'

/** The six masters, in tree order: the Ascendant's unlock prestiges once with each. */
export const MASTER_IDS: readonly ClassId[] = CLASS_NODES.filter(node => node.tier === 'master').map(node => node.id)

/** Every class skill the Ascendant can pick from: one per class below it, Haste to the masters'. */
export const ASCENDANT_PICKABLE: readonly ClassSkill[] = CLASS_NODES.filter(node => node.tier !== 'capstone').map(node => node.skill)

const PICKABLE_BY_ID = new Map(ASCENDANT_PICKABLE.map(skill => [skill.id, skill]))

export function isAscendantPick(id: string): boolean {
    return PICKABLE_BY_ID.has(id)
}

/** The class a pickable skill belongs to. */
export function classOfSkill(id: string): ClassId | undefined {
    return CLASS_NODES.find(node => node.skill.id === id)?.id
}

/**
 * The picked skills a kit fires, each on its own class's rung of the cooldown ladder. Unknown ids
 * and repeats are dropped and the count capped, so a stored pick can never field more.
 */
export function ascendantPicks(ids: readonly string[]): ClassSkill[] {
    return [...new Set(ids)].filter(isAscendantPick).slice(0, ASCENDANT_KIT_SIZE).map(id => PICKABLE_BY_ID.get(id)!)
}

/**
 * Convergence: every master's skill at once (`capstone-class.md`). Each keeps its own hit, and all
 * six share one cooldown, `CONVERGENCE_COOLDOWN_FACTOR` times a master's, so they come ready on the
 * same tick and fire together.
 */
export const CONVERGENCE: readonly ClassSkill[] = MASTER_IDS.map((id) => {
    const own = getClass(id).skill
    return { ...own, cooldownSeconds: own.cooldownSeconds * CONVERGENCE_COOLDOWN_FACTOR }
})
