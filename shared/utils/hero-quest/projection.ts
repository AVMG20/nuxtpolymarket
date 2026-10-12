/**
 * Ability effects, averaged into the idle rate.
 *
 * `fight.ts` resolves abilities for real on boss stages. Without this, a Support's heal and a
 * Control's armour shred would do nothing during idle wave farming, which is most of playtime.
 *
 * ## The hard constraint: settle is rate math, not a tick loop
 *
 * `settle()` computes **one frozen rate** and holds it for a whole window — that is the entire
 * lazy-settle contract (`tech-architecture.md` §4a), and it is what lets a 72-hour offline
 * window resolve in constant time instead of simulating 259,200 seconds. So nothing here may
 * iterate time. Every effect collapses to a scalar:
 *
 *     uptime(effect) = min(1, duration / cooldown)
 *
 * An ability with a 6s buff on an 8s cooldown is up 75% of the time, so its +25% PWR is worth
 * +18.75% averaged. A target pattern that reaches 3 of 6 enemies counts for half. Nothing else.
 *
 * ## This is an approximation, and it is allowed to be wrong
 *
 * `fight.ts` rolls crits, resolves statuses on a grid, and lets a stun land on a body that was
 * about to swing. None of that survives averaging. What is guaranteed is that the projection
 * stays within a stated tolerance of a real fight over the same party and stage — asserted in
 * `test/hero-quest/projection.spec.ts`, which is the contract. If the tolerance cannot be met,
 * the approximation is wrong, not the test.
 */

import {
    FORMATION_ROW_CAPACITY,
    MAX_SUSTAIN_MITIGATION,
    MIN_DAMAGE,
    STATUS_MAX_STACKS,
    STATUS_TICK_SECONDS
} from './constants'
import { attackIntervalFor, cooldownFor, expectedCritFactor, partyMitigation, wealthFactorFor } from './combat'
import { heroKit } from './content/skills'
import { heroModifierTotals, partyModifierTotals } from './stats'
import { mergeTotals } from './modifiers'
import { D, ONE, ZERO, decMax } from './numbers'
import type { Decimal, DecimalSource } from './numbers'
import { SINGLE_TARGET, isAllyTarget } from './effects'
import type { AbilityEffect, StatusSpec } from './effects'
import type { ClassSkill, HeroSnapshot, UnitStats } from './types'

/** One unit's kit, paired with the stats that decide how fast it cycles. */
interface ArmedUnit {
    stats: UnitStats
    kit: readonly ClassSkill[]
}

/**
 * The party's kits, in the order `partyUnitStats` builds them — Hero first, then Champions.
 *
 * Deliberately mirrors `fight.ts`: the same two sources in the same order, and the same
 * `heroKit` for the Hero's half. If these disagreed, the projection and the fight would be
 * describing different parties.
 */
export function armedParty(hero: HeroSnapshot, units: readonly UnitStats[]): ArmedUnit[] {
    const kits: readonly (readonly ClassSkill[])[] = [
        heroKit(hero),
        ...(hero.champions ?? []).map(champion => champion.abilities)
    ]
    return units.map((stats, index) => ({ stats, kit: kits[index] ?? [] }))
}

/**
 * Every unit's kit with each ability's live cooldown and its attack speed, in fight order and keyed
 * by the Hero's class or the Champion's id — what the battle stage swings and casts on. The
 * cooldown and the attack interval are the ones `runFight` times them by, from the same stat
 * block; `damaging` is false for an ability that only lands on allies, so the stage shows no blow.
 */
export function partyKits(hero: HeroSnapshot, units: readonly UnitStats[]): {
    id: string
    /** Seconds between basic attacks, from the unit's own SPD, and the strikes each one lands. */
    attackSeconds: number
    strikesPerAttack: number
    skills: { id: string, cooldownSeconds: number, damaging: boolean }[]
}[] {
    return armedParty(hero, units).map((unit, index) => ({
        id: index === 0 ? hero.classId : hero.champions?.[index - 1]?.championId ?? '',
        attackSeconds: attackIntervalFor(unit.stats.spd),
        strikesPerAttack: unit.stats.strikesPerAttack,
        skills: unit.kit.map(skill => ({
            id: skill.id,
            cooldownSeconds: cooldownFor(skill.cooldownSeconds, unit.stats.cooldownSpd, unit.stats.cooldownFactor),
            damaging: skill.abilityMultiplier > 0 && !isAllyTarget((skill.effect ?? SINGLE_TARGET).target)
        }))
    }))
}

/** Fraction of the time an ability's effect is live, from its own duration and cooldown. */
export function uptimeOf(durationSeconds: number, cooldownSeconds: number): number {
    if (cooldownSeconds <= 0) return 1
    return Math.min(1, Math.max(0, durationSeconds) / cooldownSeconds)
}

/**
 * How many bodies a target pattern reaches, as a fraction of the pack.
 *
 * A single-target debuff on a six-strong pack is worth a sixth of a pack-wide one, and the
 * averaged model has to say so or every Control ability would read as pack-wide.
 */
export function coverageOf(effect: AbilityEffect, packSize: number): number {
    const size = Math.max(1, packSize)
    switch (effect.target) {
        case 'enemy_all':
            return 1
        case 'enemy_front_line':
            return Math.min(size, Math.ceil(size / 2)) / size
        case 'enemy_pierce': {
            // **Average** column depth, not the deepest one. A six-strong pack is three
            // columns of two, but a three-body boss encounter is one column of two and one of
            // one — assuming every pierce catches two would over-count it by a third, and the
            // boss encounter is exactly where pierce abilities get measured.
            const columns = Math.max(1, Math.min(FORMATION_ROW_CAPACITY, Math.ceil(size / 2)))
            return (size / columns) / size
        }
        case 'enemy_single':
            return 1 / size
        default:
            return 0
    }
}

/** Ally-side coverage: what fraction of the party an ally pattern reaches. */
function allyCoverage(effect: AbilityEffect, partySize: number): number {
    const size = Math.max(1, partySize)
    switch (effect.target) {
        case 'ally_all':
            return 1
        case 'self':
        case 'ally_lowest_hp':
        case 'ally_strongest':
            return 1 / size
        default:
            return 0
    }
}

/**
 * Scalar factors the whole party's kits average out to.
 *
 * Every field is a plain multiplier so `settle` applies them without knowing what produced
 * them — which is what keeps the rate model from growing an effect system of its own.
 */
export interface AbilityModifiers {
    /** Multiplier on party PWR from buff uptime. */
    pwrFactor: number
    /**
     * Multiplier on party SPD from buff uptime.
     *
     * SPD does two jobs (`classes-and-combat.md` §3): it shortens cooldowns and it raises the
     * autoattack rate. `settle.buffedUnits` recomputes the attack rate from the buffed SPD.
     */
    spdFactor: number
    /**
     * Multiplier on enemy DEF, from armour-shred uptime **and** from passive shred lines
     * (Artifacts' Shattering Blow and Defense Penetration). Below 1 means shredded.
     *
     * The two sources multiply rather than adding, deliberately: §4's additive rule governs
     * Artifacts stacking *with each other* — which `sumModifiers` already does — not an always-on
     * passive composing with a timed debuff's uptime. Those are independent mechanisms.
     */
    enemyDefFactor: number
    /** Multiplier on incoming damage from enemy PWR debuffs and hard control. */
    incomingFactor: number
    /**
     * Multiplier on the damage the party actually takes, from passive `damageTaken` lines.
     *
     * Kept apart from `incomingFactor` on purpose. `incomingFactor` scales the enemy's *PWR*, so
     * it interacts with mitigation non-linearly — halving enemy PWR more than halves damage taken
     * once mitigation is factored in. A damage-reduction passive is a flat cut to the finished
     * number, so it is applied at the one place damage taken is derived (`secondsToDie`) rather
     * than pushed back into the enemy's stat line where it would be worth more than it says.
     */
    damageTakenFactor: number
    /** Healing per second the party sustains itself for, as a Decimal. */
    healingPerSecond: Decimal
    /**
     * Multiplier on Gold income from ability-driven Gold bursts (Coin Toss and family).
     *
     * Separate from the passive Gold% that `stats.economyBonuses` sums, because the two have
     * genuinely different sources: a passive is a rate by definition, while a burst is a lump
     * denominated in minutes of income (`gold-economy.md` §6) that only becomes a rate once
     * divided by the cooldown it waits through.
     */
    goldFactor: number
    /** The same, for XP — King's Ransom's third line. */
    xpFactor: number
}

export const NO_ABILITIES: AbilityModifiers = {
    pwrFactor: 1,
    spdFactor: 1,
    enemyDefFactor: 1,
    incomingFactor: 1,
    damageTakenFactor: 1,
    healingPerSecond: ZERO,
    goldFactor: 1,
    xpFactor: 1
}

/**
 * Collapse every kit in the party into the scalars of `AbilityModifiers`.
 *
 * Stacking counts **one application's stacks**, not a built-up `STATUS_MAX_STACKS`: an averaged
 * model cannot know how long a fight runs, and assuming every stacking effect sits at its cap
 * would flatter the projection badly on a wave that dies in two swings. The projection should
 * under-promise against a real fight rather than over-promise.
 */
export function projectAbilities(
    hero: HeroSnapshot,
    units: readonly UnitStats[],
    packSize: number
): AbilityModifiers {
    const party = armedParty(hero, units)
    // Passive lines that land outside the stat block. `stats.ts` already folded the stat and crit
    // lines into `units`; these two are the ones that describe the *pack* and the *incoming
    // stream* rather than a party member, so they belong here.
    const passives = mergeTotals(heroModifierTotals(hero), partyModifierTotals(hero))
    if (party.every(unit => unit.kit.length === 0)) {
        return {
            ...NO_ABILITIES,
            enemyDefFactor: passives.enemyDefFactor,
            damageTakenFactor: passives.damageTakenFactor
        }
    }

    let pwrFactor = 1
    let spdFactor = 1
    let enemyDefFactor = passives.enemyDefFactor
    let incomingFactor = 1
    let healingPerSecond = ZERO
    let goldFactor = 1
    let xpFactor = 1

    for (const { stats, kit } of party) {
        for (const entry of kit) {
            const effect = entry.effect ?? SINGLE_TARGET
            const cooldown = cooldownFor(entry.cooldownSeconds, stats.cooldownSpd, stats.cooldownFactor)
            if (cooldown <= 0) continue

            // A burst worth M minutes of income, every `cooldown` seconds, is a rate increase of
            // `M × 60 / cooldown`. That conversion is the whole reason §6 insists bursts be
            // denominated in income rather than a flat amount: expressed this way the effect is
            // correctly sized at every point on the Gold curve with no per-stage retuning ever.
            if (effect.goldBurstMinutes) goldFactor += (effect.goldBurstMinutes * 60) / cooldown
            if (effect.xpBurstMinutes) xpFactor += (effect.xpBurstMinutes * 60) / cooldown

            const applyStatusSpec = (spec: StatusSpec | undefined, coverage: number) => {
                if (!spec) return
                const live = uptimeOf(spec.duration, cooldown) * coverage
                const magnitude = (spec.magnitude ?? 0) * Math.min(STATUS_MAX_STACKS, spec.stacks ?? 1)

                switch (spec.kind) {
                    case 'buff':
                        if (spec.stat === 'pwr') pwrFactor *= 1 + magnitude * live
                        else if (spec.stat === 'spd') spdFactor *= 1 + magnitude * live
                        break
                    case 'debuff':
                        if (spec.stat === 'def') enemyDefFactor *= 1 - magnitude * live
                        else if (spec.stat === 'pwr') incomingFactor *= 1 - magnitude * live
                        break
                    case 'stun':
                    case 'silence':
                        // A stunned enemy is not swinging; a silenced one still is. Only the
                        // former shows up in an autoattack-driven incoming rate.
                        if (spec.kind === 'stun') incomingFactor *= 1 - live
                        break
                    case 'hot':
                        healingPerSecond = healingPerSecond.add(
                            healPerCast(stats, spec.magnitude ?? 0, spec.scalesWithPwr)
                                .mul(spec.duration / STATUS_TICK_SECONDS)
                                .div(cooldown)
                                .mul(coverage * units.length)
                        )
                        break
                    default:
                        break
                }
            }

            const enemyCoverage = coverageOf(effect, packSize)
            const friendlyCoverage = allyCoverage(effect, units.length)

            applyStatusSpec(effect.status, effect.status
                ? (isEnemyStatus(effect) ? enemyCoverage : friendlyCoverage)
                : 0)
            applyStatusSpec(effect.selfStatus, 1 / Math.max(1, units.length))

            // A cast heal is worth its amount spread over the cooldown it waits through.
            if (effect.heal) {
                healingPerSecond = healingPerSecond.add(
                    stats.pwr.mul(effect.heal)
                        .div(cooldown)
                        .mul(friendlyCoverage * units.length)
                )
            }
            // A shield is healing that arrives before the damage does. Same rate, and the
            // averaged model has no way to value the timing difference.
            if (effect.shield) {
                healingPerSecond = healingPerSecond.add(
                    stats.pwr.mul(effect.shield)
                        .div(cooldown)
                        .mul(friendlyCoverage * units.length)
                )
            }
        }
    }

    return {
        pwrFactor,
        spdFactor,
        enemyDefFactor: Math.max(0, enemyDefFactor),
        incomingFactor: Math.max(0, incomingFactor),
        damageTakenFactor: passives.damageTakenFactor,
        healingPerSecond,
        goldFactor,
        xpFactor
    }
}

/** Whether an effect's `status` lands on enemies rather than allies. */
function isEnemyStatus(effect: AbilityEffect): boolean {
    return effect.target.startsWith('enemy_')
}

function healPerCast(stats: UnitStats, magnitude: number, scalesWithPwr?: boolean): Decimal {
    return scalesWithPwr ? stats.pwr.mul(magnitude) : D(magnitude)
}

/**
 * Damage per second the party's abilities add, on top of autoattacks.
 *
 * Mirrors `partyDps` deliberately — same pooled penetration, same per-unit crit factor, same
 * `MIN_DAMAGE` floor — so the two are directly comparable and a change to one is obviously a
 * change to the other. What differs is the rate: an ability lands `targets` hits every
 * `cooldown` seconds rather than `strikesPerAttack` every `attackInterval`.
 */
export function partyAbilityDps(
    hero: HeroSnapshot,
    units: readonly UnitStats[],
    defenderDef: DecimalSource,
    packSize: number
): Decimal {
    return partyAbilityDpsByUnit(hero, units, defenderDef, packSize)
        .reduce((total, unitDps) => total.add(unitDps), ZERO)
}

/**
 * `partyAbilityDps`, one entry per unit in `partyUnitStats` order — for callers that itemise a
 * party (the Global Power Number) and need each body's share rather than only the total.
 */
export function partyAbilityDpsByUnit(
    hero: HeroSnapshot,
    units: readonly UnitStats[],
    defenderDef: DecimalSource,
    packSize: number
): Decimal[] {
    if (units.length === 0) return []
    const party = armedParty(hero, units)
    const penetration = ONE.sub(partyMitigation(units, defenderDef))
    const wealth = wealthFactorFor(hero.wealthHours)

    return party.map(({ stats, kit }) => {
        if (stats.pwr.lte(0)) return ZERO
        const critFactor = expectedCritFactor(stats)

        return kit.reduce((unitTotal, entry) => {
            if (entry.abilityMultiplier <= 0) return unitTotal
            const effect = entry.effect ?? SINGLE_TARGET
            const cooldown = cooldownFor(entry.cooldownSeconds, stats.cooldownSpd, stats.cooldownFactor)
            if (cooldown <= 0) return unitTotal

            // The floor applies to the **finished** hit, multiplier included — exactly as
            // `rawHitDamage` and `fight.rollDamage` do it. Flooring the base and then
            // multiplying would pay `MIN_DAMAGE × multiplier` for a fully-mitigated ability,
            // inflating every kit whose damage sits near the floor.
            // the unit's own ability damage, which Traits' Hero Skill DMG raises on the Hero alone
            const multiplier = entry.abilityMultiplier * (effect.wealthScaled ? wealth : 1) * stats.skillDamageFactor
            const perHit = decMax(MIN_DAMAGE, stats.pwr.mul(penetration).mul(multiplier))

            // Bodies struck per cast. An AoE that reaches the whole pack does `packSize` times
            // the work of a single-target hit of the same multiplier — which is exactly why
            // AoE multipliers are authored lower than single-target ones.
            const bodies = Math.max(1, coverageOf(effect, packSize) * Math.max(1, packSize))
            const crit = effect.alwaysCrits
                ? stats.critMultiplier.mul(effect.critDamageMultiplier ?? 1)
                : critFactor

            return unitTotal.add(perHit.mul(crit).mul(bodies).div(cooldown))
        }, ZERO)
    })
}

/**
 * Incoming damage after the party's own sustain is subtracted.
 *
 * Healing may cancel at most `MAX_SUSTAIN_MITIGATION` of the stream, so it can never fully
 * cancel a wave — see that constant for why an immortal projection is the failure mode.
 */
export function sustainedIncoming(incoming: Decimal, healingPerSecond: Decimal): Decimal {
    if (healingPerSecond.lte(0) || incoming.lte(0)) return incoming
    const floor = incoming.mul(1 - MAX_SUSTAIN_MITIGATION)
    const net = incoming.sub(healingPerSecond)
    return net.lt(floor) ? floor : net
}
