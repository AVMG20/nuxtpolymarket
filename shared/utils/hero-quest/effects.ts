/**
 * Ability effects: what an ability actually *does*, and to whom — the vocabulary class skills,
 * Champion abilities and Skill Actives are written in.
 *
 * ## Targeting is per-ability, and that is doc-mandated
 *
 * `champions-guild-gacha.md` §8.3 is explicit: the autoattack targeting table "only governs
 * the plain autoattack — any ability whose design calls for something else (AoE, party-wide,
 * chain, ally-targeted) overrides it whenever that ability fires", and that this "will apply
 * often, not as a rare exception". So an ability carries its own target pattern rather than
 * inheriting the caster's.
 *
 * ## A note on the vocabulary
 *
 * The Archer path's abilities are specified in terms of the enemy formation — "hits all
 * enemies in a row", "all enemies in the front column", "all enemies in each spot". Those
 * words describe the shape from the *player's* side of the board, where a "row" runs away from
 * you (so piercing) and a "column" runs across. The code deliberately uses unambiguous names
 * instead — `enemy_pierce`, `enemy_front_line`, `enemy_all` — because the encounter grid already
 * has a `row: 'front' | 'back'` axis (`settle.enemyPosition`) and reusing the word for the
 * perpendicular one would be a standing trap.
 *
 * Pure, like everything in `shared/`: this module decides *which* targets and *how much*, and
 * hands back indices. Applying anything is the caller's job.
 */

import { SKILL_COOLDOWN_RANK_STEP } from './constants'
import type { ClassSkill, HqStatKey } from './types'
import type { StatusKind } from './status'

/**
 * Who an ability lands on.
 *
 * `enemy_*` patterns resolve against the encounter's grid (`settle.enemyPosition`); `self` and
 * `ally_*` against the fielded party.
 */
export type EffectTarget =
    /** The focus target alone — the default (`SINGLE_TARGET`). */
    | 'enemy_single'
    /** The focus target and everything sharing its column, front to back. Pierce. */
    | 'enemy_pierce'
    /** Every living enemy in the front row. */
    | 'enemy_front_line'
    /** Everything standing. */
    | 'enemy_all'
    | 'self'
    /** The most wounded living ally by HP fraction — Support's own autoattack rule (§8.2). */
    | 'ally_lowest_hp'
    /** The living ally with the most PWR — where a damage or speed buff is worth the most. */
    | 'ally_strongest'
    | 'ally_all'

export function isAllyTarget(target: EffectTarget): boolean {
    return target === 'self'
        || target === 'ally_lowest_hp'
        || target === 'ally_strongest'
        || target === 'ally_all'
}

/**
 * A status an ability applies.
 *
 * `magnitude` means different things per kind, exactly as `StatusInstance.magnitude` does: a
 * fraction for `buff` / `debuff` / `reflect` / `redirect`, and a multiple of the caster's PWR
 * for `dot` / `hot` / `shield`. The `scalesWithPwr` flag is what tells the caller which, so
 * content can stay declarative and the PWR lookup stays in one place.
 */
export interface StatusSpec {
    kind: StatusKind
    stat?: HqStatKey
    duration: number
    magnitude?: number
    /** True when `magnitude` is a multiple of PWR rather than a flat fraction. */
    scalesWithPwr?: boolean
    /**
     * Stacks added per application. ⚠ Setting it on a `buff` / `debuff` is what makes the effect
     * build on recast — without it a stat effect only refreshes (`status.applyStatus`).
     */
    stacks?: number
}

export interface AbilityEffect {
    target: EffectTarget
    /** Healing as a multiple of the caster's PWR (`champions-guild-gacha.md` §2). */
    heal?: number
    /** Shield pool as a multiple of the caster's PWR. */
    shield?: number
    /** Skips the crit roll and always crits — Kill Shot. */
    alwaysCrits?: boolean
    /** Extra multiplier on top of the crit multiplier, when this ability crits. */
    critDamageMultiplier?: number
    /** Landed on every target the pattern selects. */
    status?: StatusSpec
    /** Landed on the caster, whatever the pattern selected. */
    selfStatus?: StatusSpec
    /** Damage scales up as the target's HP falls — Execute Strike. Fraction at 0% HP. */
    executeBonus?: number
    /**
     * Split the damage into this many separate hits — Focused Barrage's "several smaller hits
     * on one target instead of one big hit, more crit rolls per cast".
     *
     * Each hit rolls its own crit, which is the entire point: the total is the same but the
     * variance collapses, so a barrage is worth more to a high-crit build than a single swing.
     */
    hits?: number
    /** Restore a fallen ally to this fraction of max HP — Second Wind. */
    revive?: number
    /** Strip hostile statuses from every target — Purify and the cleanse family. */
    cleanse?: boolean
    /**
     * A Gold burst on cast, **denominated in minutes of the player's current income**.
     *
     * `gold-economy.md` §6 is explicit that every flat-Gold effect must be a duration of income
     * rather than a fixed amount — Coin Toss, Prospector's Instinct, Treasure Hunter's Gambit and
     * King's Ransom on the Skills side, Lucky Dig and Windfall on the Artifacts side. That is what
     * keeps a burst correctly sized at prestige 0 and at prestige 20 with no per-stage retuning
     * ever, and what makes it inherit Gold's own bounded curve for free.
     *
     * **Resolved in the idle rate only** (`projection.ts` folds it into a Gold% factor), not in
     * `fight.ts`. Boss fights grant no Gold at all, so there is nothing for a burst to add there —
     * which is why this is a rate contribution rather than a fight event.
     */
    goldBurstMinutes?: number
    /** The same, for XP — King's Ransom's third line. */
    xpBurstMinutes?: number
    /**
     * Damage is modulated by how many hours of income the player has banked in Gold — the
     * Gambler's Strike family (`skills-gacha.md` §4¹, `gold-economy.md` §8).
     *
     * A flag rather than a magnitude: the factor is bounded by `WEALTH_FACTOR_MIN/MAX` for every
     * skill that carries it, so the family differs only in base multiplier. Scaling off PWR with a
     * *bounded* wealth modulation keeps it relevant at every prestige, where a literal "% of
     * current Gold" would decay as enemy stats kept compounding.
     */
    wealthScaled?: boolean
    /** Extend every hostile status already on the target — Unraveling Curse, exactly. */
    extendDebuffs?: number
    /**
     * A second effect that lands only once `status` has built to a stack threshold.
     *
     * Frostbind's "stacking slow; **at max stacks**, fully disables (freezes) the target" is
     * the case this exists for, and it is written generically rather than as a Frostbind branch
     * because "build a debuff, then it does something worse" is an obvious shape for later
     * content to reuse.
     *
     * The threshold is checked **after** the application lands, against the stacks actually on
     * the target — so it fires on whichever cast crosses the line, however many casts that
     * takes, and it keeps firing while the target stays at or above it.
     */
    escalation?: {
        /** Stacks of this ability's own `status` required. */
        atStacks: number
        /** What lands on the target once the threshold is met. */
        status: StatusSpec
    }
}

/** The default: a single-target hit. Also what an autoattack resolves as. */
export const SINGLE_TARGET: AbilityEffect = { target: 'enemy_single' }

/**
 * Which enemies an ability hits, as indices into the pack.
 *
 * `focus` is the ability's anchor — the front-most living enemy, the same body an autoattack
 * would strike. Patterns spread out from there. Dead bodies are never returned, so an AoE
 * landing on a half-cleared pack hits what is left rather than swinging at corpses.
 */
export function resolveEnemyTargets(
    target: EffectTarget,
    focus: number,
    living: readonly number[],
    size: number,
    geometry: {
        columnOf: (index: number, size: number) => number[]
        rowOf: (row: 'front' | 'back', size: number) => number[]
    }
): number[] {
    if (isAllyTarget(target)) return []
    const alive = new Set(living)
    const keep = (indices: number[]) => indices.filter(index => alive.has(index))

    switch (target) {
        case 'enemy_pierce':
            return keep(geometry.columnOf(focus, size))
        case 'enemy_front_line': {
            const front = keep(geometry.rowOf('front', size))
            // An empty front row means the back row *is* the front line — the same fallthrough
            // the enemy's own targeting uses against the party.
            return front.length > 0 ? front : keep(geometry.rowOf('back', size))
        }
        case 'enemy_all':
            return [...living]
        default:
            return alive.has(focus) ? [focus] : []
    }
}

/** Which allies an ability lands on, as indices into the party. */
export function resolveAllyTargets(
    target: EffectTarget,
    caster: number,
    party: readonly { alive: boolean; hpFraction: number; power?: number }[],
    /** Revives target the *fallen*, which is the one case where "ally" means a corpse. */
    wantsFallen = false
): number[] {
    if (wantsFallen) {
        return party.flatMap((unit, index) => unit.alive ? [] : [index])
    }

    const living = party
        .map((unit, index) => ({ ...unit, index }))
        .filter(unit => unit.alive)

    switch (target) {
        case 'self':
            return party[caster]?.alive ? [caster] : []
        case 'ally_lowest_hp': {
            if (living.length === 0) return []
            const neediest = living.reduce((worst, unit) =>
                unit.hpFraction < worst.hpFraction ? unit : worst)
            return [neediest.index]
        }
        case 'ally_strongest': {
            if (living.length === 0) return []
            const strongest = living.reduce((best, unit) =>
                (unit.power ?? 0) > (best.power ?? 0) ? unit : best)
            return [strongest.index]
        }
        case 'ally_all':
            return living.map(unit => unit.index)
        default:
            return []
    }
}

/**
 * The damage multiplier an execute-style ability earns against a wounded target.
 *
 * "Bonus damage that scales up the lower the target's HP% is" (Execute Strike, Executioner's
 * Edge, Kill Shot's family). Linear in missing HP: full bonus at 0% HP, none at full.
 */
export function executeMultiplier(effect: AbilityEffect, hpFraction: number): number {
    if (!effect.executeBonus) return 1
    const missing = Math.min(1, Math.max(0, 1 - hpFraction))
    return 1 + effect.executeBonus * missing
}

/**
 * Scale an effect's **magnitudes** by a potency multiplier, leaving its shape alone.
 *
 * Used to make a levelled Skill copy genuinely stronger than a freshly-pulled one
 * (`SKILL_POTENCY_PER_POINT`). Written here rather than in `content/skills.ts` because it is a
 * statement about what an `AbilityEffect`'s fields *mean*, and that belongs with the type.
 *
 * ## What scales, and what deliberately does not
 *
 * **Scales** — every field that answers "how much": `heal`, `shield`, `executeBonus`, the two
 * burst durations-of-income, `critDamageMultiplier`, and the `magnitude` of both status specs
 * (including an escalation's).
 *
 * **Does not scale**, and each for its own reason:
 *
 * - `duration` — a longer buff is a different effect from a stronger one, and §4 describes
 *   durations as fixed ("a short duration", "brief"). Scaling both would double-count levelling,
 *   since the idle projection already multiplies magnitude by `duration / cooldown` uptime.
 * - `stacks` and `escalation.atStacks` — counts and thresholds, not amounts. Scaling the threshold
 *   would make a levelled Frostbind *slower* to freeze, which is backwards.
 * - `hits` — Focused Barrage's split exists to add crit rolls at constant total damage; scaling it
 *   would change the shape of the ability rather than its strength.
 * - `revive` — a fraction of max HP, so it is scaled but **clamped at 1**: reviving an ally above
 *   full HP is not a stronger revive, it is a bug.
 * - `target`, `cleanse`, `alwaysCrits`, `extendDebuffs` — a pattern, two booleans and a duration.
 *
 * Returns the input unchanged at potency 1, object identity included, so an unlevelled copy costs
 * nothing.
 */
export function scaleEffect(effect: AbilityEffect, potency: number): AbilityEffect {
    if (potency === 1 || !Number.isFinite(potency)) return effect

    const scaleStatus = (spec: StatusSpec | undefined): StatusSpec | undefined =>
        spec === undefined || spec.magnitude === undefined
            ? spec
            : { ...spec, magnitude: spec.magnitude * potency }

    return {
        ...effect,
        ...(effect.heal === undefined ? {} : { heal: effect.heal * potency }),
        ...(effect.shield === undefined ? {} : { shield: effect.shield * potency }),
        ...(effect.executeBonus === undefined ? {} : { executeBonus: effect.executeBonus * potency }),
        ...(effect.critDamageMultiplier === undefined
            ? {}
            : { critDamageMultiplier: effect.critDamageMultiplier * potency }),
        ...(effect.goldBurstMinutes === undefined
            ? {}
            : { goldBurstMinutes: effect.goldBurstMinutes * potency }),
        ...(effect.xpBurstMinutes === undefined
            ? {}
            : { xpBurstMinutes: effect.xpBurstMinutes * potency }),
        ...(effect.revive === undefined
            ? {}
            : { revive: Math.min(1, effect.revive * potency) }),
        ...(effect.status === undefined ? {} : { status: scaleStatus(effect.status)! }),
        ...(effect.selfStatus === undefined ? {} : { selfStatus: scaleStatus(effect.selfStatus)! }),
        ...(effect.escalation === undefined
            ? {}
            : {
                escalation: {
                    // The threshold is a count — only what lands past it gets stronger.
                    atStacks: effect.escalation.atStacks,
                    status: scaleStatus(effect.escalation.status)!
                }
            })
    }
}

/**
 * The same effect on a cadence `factor` times slower, worth the same per second.
 *
 * Per-cast payloads grow by `factor` (`heal`, `shield`, the income bursts, `extendDebuffs`, a
 * shield status's pool) and every status lasts `factor` times longer, so its uptime is unchanged
 * and a DoT or HoT delivers the larger total through its fixed per-tick rate.
 *
 * Status `magnitude` deliberately does **not** grow: debuffs clamp at zero, so a stronger Weaken
 * on a slower cadence would delete an enemy's PWR rather than average out. `stacks`, `hits`,
 * `revive` and the per-hit multipliers (`critDamageMultiplier`, `executeBonus`) stay put too.
 */
export function stretchEffect(effect: AbilityEffect, factor: number): AbilityEffect {
    if (factor === 1 || !Number.isFinite(factor)) return effect

    const stretchStatus = (spec: StatusSpec): StatusSpec => ({
        ...spec,
        duration: spec.duration * factor,
        ...(spec.kind === 'shield' && spec.magnitude !== undefined
            ? { magnitude: spec.magnitude * factor }
            : {})
    })
    const scaled = (value: number | undefined) => value === undefined ? undefined : value * factor

    return {
        ...effect,
        ...(effect.heal === undefined ? {} : { heal: scaled(effect.heal) }),
        ...(effect.shield === undefined ? {} : { shield: scaled(effect.shield) }),
        ...(effect.goldBurstMinutes === undefined ? {} : { goldBurstMinutes: scaled(effect.goldBurstMinutes) }),
        ...(effect.xpBurstMinutes === undefined ? {} : { xpBurstMinutes: scaled(effect.xpBurstMinutes) }),
        ...(effect.extendDebuffs === undefined ? {} : { extendDebuffs: scaled(effect.extendDebuffs) }),
        ...(effect.status === undefined ? {} : { status: stretchStatus(effect.status) }),
        ...(effect.selfStatus === undefined ? {} : { selfStatus: stretchStatus(effect.selfStatus) }),
        ...(effect.escalation === undefined
            ? {}
            : { escalation: { ...effect.escalation, status: stretchStatus(effect.escalation.status) } })
    }
}

/**
 * Places an ability on the cooldown ladder: `rank` steps of `SKILL_COOLDOWN_RANK_STEP` longer,
 * hitting proportionally harder. Rank is rarity for Skills and Champion abilities, tree depth for
 * class skills, and 0 is the base.
 */
export function onCooldownRank<T extends Pick<ClassSkill, 'cooldownSeconds' | 'abilityMultiplier' | 'effect'>>(
    skill: T,
    rank: number
): T {
    const factor = SKILL_COOLDOWN_RANK_STEP ** Math.max(0, rank)
    if (factor === 1) return skill
    return {
        ...skill,
        cooldownSeconds: skill.cooldownSeconds * factor,
        abilityMultiplier: skill.abilityMultiplier * factor,
        ...(skill.effect === undefined ? {} : { effect: stretchEffect(skill.effect, factor) })
    }
}
