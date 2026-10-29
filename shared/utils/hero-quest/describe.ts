/**
 * What a collection entry does, in exact numbers (#26).
 *
 * Every sentence here is generated from the data the fight and the idle rate run on: an ability's
 * `ClassSkill` (its cooldown, its multiplier and its `AbilityEffect`), a modifier line's kind and
 * magnitude. The authored prose (`SkillDefinition.lines`, the docs' "a moderate share") says what
 * an entry is *for*; this says what it *does*, so a retune in `constants.ts` reaches the player's
 * screen with nothing to rewrite, and the two can never disagree.
 *
 * Numbers are rounded to at most two decimals, trailing zeros dropped. No brackets: the stage's
 * pixel font has none.
 *
 * Pure, like everything in `shared/`.
 */

import { STATUS_MAX_STACKS, STATUS_TICK_SECONDS, SKILL_STATUS_DURATION_SECONDS, WEALTH_FACTOR_MAX, WEALTH_FACTOR_MIN, WEALTH_NEUTRAL_HOURS } from './constants'
import { wealthFactorFor } from './combat'
import { SINGLE_TARGET, isAllyTarget, type EffectTarget, type StatusSpec } from './effects'
import type { ModifierKind } from './modifiers'
import type { ClassSkill } from './types'
import { hqNumber, hqPct } from './numbers'

// the rounding helpers live with the rest of the number formatting; re-exported for this module's callers
export { hqNumber, hqPct }

/** What each non-stat modifier kind is called on a line. */
export const MODIFIER_LABELS: Readonly<Record<Exclude<ModifierKind, 'stat'>, string>> = {
    maxHp: 'Max HP',
    critChance: 'Crit chance',
    critDamage: 'Crit damage',
    enemyDefShred: 'Enemy DEF ignored',
    damageTaken: 'Damage taken',
    gold: 'Gold',
    xp: 'XP',
    offlineEfficiency: 'Offline gain',
    cooldown: 'Cooldowns',
    controlResist: 'Control resist',
    reflect: 'Damage reflected',
    evasion: 'Evasion',
    skillDamage: 'Hero skill DMG',
    basicAttack: 'Basic attack DMG',
    regen: 'Max HP regen/s'
}

/** Kinds whose magnitude takes something away, so they read with a minus. */
export const REDUCING_MODIFIERS: ReadonlySet<ModifierKind> = new Set<ModifierKind>(['damageTaken', 'cooldown'])

/** One modifier line, exact: "PWR +1.25%", "Cooldowns -4.5%". */
export function modifierLine(kind: ModifierKind, stat: string | undefined, magnitude: number): string {
    const label = kind === 'stat' ? (stat ?? '').toUpperCase() : MODIFIER_LABELS[kind]
    return `${label} ${REDUCING_MODIFIERS.has(kind) ? '-' : '+'}${hqPct(Math.abs(magnitude))}`
}

/** Who casts an ability, which decides how a sentence names them. */
export type AbilityCaster = 'hero' | 'champion'

export interface AbilityDescribeOptions {
    caster: AbilityCaster
    /**
     * The wealth factor a wealth-scaled hit carries right now (`wealthFactorFor`). Omitted, the
     * hit is described at its base and said to scale with banked Gold.
     */
    wealthFactor?: number
}

const ENEMY_TARGET: Readonly<Record<Exclude<EffectTarget, 'self' | 'ally_lowest_hp' | 'ally_strongest' | 'ally_all'>, string>> = {
    enemy_single: 'the target',
    enemy_pierce: 'the target and the enemy behind it',
    enemy_front_line: 'every enemy in the front row',
    enemy_all: 'every enemy'
}

const ALLY_TARGET: Readonly<Record<'ally_lowest_hp' | 'ally_strongest' | 'ally_all', string>> = {
    ally_lowest_hp: 'the most wounded ally',
    ally_strongest: 'the ally with the most PWR',
    ally_all: 'every ally'
}

/** The words a sentence uses for the caster. */
function voice(caster: AbilityCaster) {
    return caster === 'hero'
        ? { pwr: 'your PWR', self: 'you', own: 'your', subject: 'you', takes: 'you take' }
        : { pwr: 'its PWR', self: 'itself', own: 'its', subject: 'it', takes: 'it takes' }
}

function seconds(value: number): string {
    return `${hqNumber(value)}s`
}

/** "a second" while the status tick is one second, "every 2s" otherwise. */
function perTick(): string {
    return STATUS_TICK_SECONDS === 1 ? 'a second' : `every ${seconds(STATUS_TICK_SECONDS)}`
}

/** How a status builds on recast, mirroring `status.applyStatus`: stat effects only stack when asked to. */
function stacking(spec: StatusSpec): string {
    const statKind = spec.kind === 'buff' || spec.kind === 'debuff'
    if (statKind && spec.stacks === undefined) return ''
    if (spec.kind === 'shield' || spec.kind === 'taunt' || spec.kind === 'silence' || spec.kind === 'stun' || spec.kind === 'immunity') return ''
    const added = Math.max(1, Math.floor(spec.stacks ?? 1))
    return added === 1
        ? `, stacking up to ${STATUS_MAX_STACKS} times`
        : `, adding ${added} stacks a cast, up to ${STATUS_MAX_STACKS}`
}

/**
 * A status landing on `who`. `own` is set when it lands on the caster, so a stat change reads
 * "Raises your DEF" rather than "Raises DEF on you".
 */
function statusSentence(spec: StatusSpec, who: string, pwr: string, own: { possessive: string, takes: string, subject: string } | null): string {
    const magnitude = spec.magnitude ?? 0
    const lasts = `for ${seconds(spec.duration)}`
    const amount = spec.scalesWithPwr ? `${hqPct(magnitude)} of ${pwr}` : hqPct(magnitude)
    switch (spec.kind) {
        case 'dot':
            return `Burns ${who} for ${amount} ${perTick()} ${lasts}${stacking(spec)}.`
        case 'hot':
            return `Heals ${who} for ${amount} ${perTick()} ${lasts}${stacking(spec)}.`
        case 'shield':
            return `Shields ${who} for ${amount} ${lasts}.`
        case 'buff':
        case 'debuff': {
            const verb = spec.kind === 'buff' ? 'Raises' : 'Lowers'
            const stat = (spec.stat ?? '').toUpperCase()
            return own
                ? `${verb} ${own.possessive} ${stat} by ${amount} ${lasts}${stacking(spec)}.`
                : `${verb} ${stat} by ${amount} ${lasts} on ${who}${stacking(spec)}.`
        }
        case 'taunt':
            return `Draws enemy attacks onto ${who} ${lasts}.`
        case 'silence':
            return `Silences ${who} ${lasts}: no abilities.`
        case 'stun':
            return `Stuns ${who} ${lasts}: no attacks or abilities.`
        case 'reflect':
            return own
                ? `Reflects ${amount} of the damage ${own.takes} ${lasts}${stacking(spec)}.`
                : `Reflects ${amount} of the damage ${who} takes ${lasts}${stacking(spec)}.`
        case 'redirect': {
            const taker = own ? `${capitalize(own.subject)} ${own.subject === 'you' ? 'take' : 'takes'}` : `${capitalize(who)} takes`
            return `${taker} ${amount} of the damage aimed at the other allies ${lasts}${stacking(spec)}.`
        }
        case 'immunity':
            return `Makes ${who} immune to debuffs ${lasts}.`
    }
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * One ability, the way the fight resolves it: "Every 7.68s: hits the target for 240% of its PWR."
 *
 * The cooldown is the base, before SPD and cooldown lines shorten it; the multipliers are the
 * entry's own at its star and level (a Skill Active's potency is already in `skill`), before the
 * caster's crit and the target's DEF.
 */
export function describeAbility(skill: ClassSkill, options: AbilityDescribeOptions): string {
    const e = skill.effect ?? SINGLE_TARGET
    const v = voice(options.caster)
    const own = { possessive: v.own, takes: v.takes, subject: v.subject }
    const parts: string[] = []

    if (!isAllyTarget(e.target)) {
        const target = ENEMY_TARGET[e.target as keyof typeof ENEMY_TARGET]
        if (skill.abilityMultiplier > 0) {
            const hits = Math.max(1, Math.floor(e.hits ?? 1))
            let hit = `Hits ${target} for ${hqPct(skill.abilityMultiplier)} of ${v.pwr}`
            if (e.wealthScaled) {
                hit += options.wealthFactor === undefined
                    ? ', scaled by your banked Gold'
                    : `, ×${hqNumber(options.wealthFactor)} for your banked Gold: ${hqPct(skill.abilityMultiplier * options.wealthFactor)}`
            }
            if (hits > 1) hit += `, split into ${hits} hits that each roll their own crit`
            if (e.executeBonus) hit += `, up to +${hqPct(e.executeBonus)} more as the target's HP runs out`
            parts.push(`${hit}.`)
            if (e.alwaysCrits) parts.push('Always crits.')
            if (e.critDamageMultiplier !== undefined && e.critDamageMultiplier !== 1) {
                parts.push(`Its crits deal ×${hqNumber(e.critDamageMultiplier)} crit damage.`)
            }
        }
        if (e.extendDebuffs) {
            parts.push(`Extends every debuff, burn, stun and silence on ${target} by ${seconds(e.extendDebuffs)}.`)
        }
        if (e.status) parts.push(statusSentence(e.status, target, v.pwr, null))
        if (e.escalation) {
            const then = statusSentence(e.escalation.status, target, v.pwr, null)
            parts.push(`At ${e.escalation.atStacks} stacks it also ${then.charAt(0).toLowerCase()}${then.slice(1)}`)
        }
    } else {
        const self = e.target === 'self'
        const who = self ? v.self : ALLY_TARGET[e.target as keyof typeof ALLY_TARGET]
        if (e.revive) parts.push(`Revives every fallen ally at ${hqPct(e.revive)} of their max HP.`)
        if (e.cleanse) parts.push(`Removes every debuff, burn, stun and silence from ${who}.`)
        if (e.heal) parts.push(`Heals ${who} for ${hqPct(e.heal)} of ${v.pwr}.`)
        if (e.shield) {
            parts.push(`Shields ${who} for ${hqPct(e.shield)} of ${v.pwr} for ${seconds(e.status?.duration ?? SKILL_STATUS_DURATION_SECONDS)}.`)
        }
        if (e.status) parts.push(statusSentence(e.status, who, v.pwr, self ? own : null))
    }
    if (e.selfStatus) parts.push(statusSentence(e.selfStatus, v.self, v.pwr, own))
    if (e.partyHeal) parts.push(`Heals ${ALLY_TARGET.ally_all} for ${hqPct(e.partyHeal)} of ${v.pwr}.`)
    if (e.partyStatus) parts.push(statusSentence(e.partyStatus, ALLY_TARGET.ally_all, v.pwr, null))
    if (e.goldBurstMinutes) parts.push(`Grants ${incomeSpan(e.goldBurstMinutes)} of your Gold income.`)
    if (e.xpBurstMinutes) parts.push(`Grants ${incomeSpan(e.xpBurstMinutes)} of your XP income.`)
    if (parts.length === 0) parts.push('Does nothing.')

    const [first, ...rest] = parts
    return [`Every ${seconds(skill.cooldownSeconds)}: ${first!.charAt(0).toLowerCase()}${first!.slice(1)}`, ...rest].join(' ')
}

/** A burst's size in income: seconds under a minute, so a small one doesn't read as "0.01 minutes". */
function incomeSpan(minutes: number): string {
    return minutes < 1 ? `${hqNumber(minutes * 60)} seconds` : `${hqNumber(minutes)} minutes`
}

/** Whether an ability's hit is modulated by banked Gold (the Gambler's Strike family). */
export function isWealthScaled(skill: ClassSkill): boolean {
    return skill.effect?.wealthScaled === true && skill.abilityMultiplier > 0
}

/**
 * The Gambler's Strike family's wealth term, spelled out: the hours of income banked now and the
 * multiplier that puts on the hit (`combat.wealthFactorFor`).
 */
export function describeWealth(bankedHours: number): string {
    const factor = wealthFactorFor(bankedHours)
    return `You have ${hqNumber(Math.max(0, bankedHours))}h of income banked in Gold, so the hit is ×${hqNumber(factor)}.`
        + ` ×1 at ${hqNumber(WEALTH_NEUTRAL_HOURS)}h, from ×${hqNumber(WEALTH_FACTOR_MIN)} to ×${hqNumber(WEALTH_FACTOR_MAX)}.`
}
