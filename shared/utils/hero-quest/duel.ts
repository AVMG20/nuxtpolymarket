/**
 * The Arena's fight (`arena.md` §1, `tech-architecture.md` §4d): the attacker's live party against
 * another player's `defenseLoadout`, resolved by the AI on both sides. Seeded and deterministic,
 * like a boss fight (`fight.ts`): the server runs it with a CSPRNG seed and hands the log to the
 * client, which replays it blow for blow and never decides anything.
 *
 * ## Both sides are parties
 *
 * `runFight` pits a party against enemies that only swing. Here the far side is a party too, so
 * both sides fight with everything a party has: autoattacks at each unit's own SPD, every
 * ability on its cooldown with its own targeting, statuses, heals, shields, revives, reflect,
 * taunt and crits. One rule set, written once and run for each side in turn. The helpers that
 * resolve a hit (`rollDamage`, `liveUnitStats`) are `fight.ts`'s own, so a hit lands the same in a
 * duel as on a boss.
 *
 * Decisions this module makes rather than transcribes (`build-log.md` #52):
 *
 * - **Who a unit hits** is the far side's front row first, within it the most threat, and a taunt
 *   outranks both: `fight.ts`'s rule for the enemy choosing a party member, now used both ways.
 *   An ability's pattern spreads from that focus over the far party's formation (front/back rows;
 *   a pierce runs through the body behind).
 * - **Control resist** shortens every hostile status an opposing ability lands, as it does a boss
 *   special's.
 * - **The clock**: the attacker has `ARENA_FIGHT_SECONDS` to bring the whole defending party down.
 *   A defence still standing then holds, and the attacker loses.
 * - **Who acts first** within a tick is a coin from the seed. `runFight` lets the party go first,
 *   which against a party is a real edge: with the attacker always first, a party attacking its own
 *   mirror won about three fights in four.
 *
 * ## The log, in `fight.ts`'s vocabulary
 *
 * The attacker is the party (`unitIndex`), the defender the enemy side (`enemyIndex`), so the
 * stage's replay reads a duel exactly as it reads a boss fight. A defender's ability hit is an
 * `enemy_special` naming the ability; a defender's own heals, shields and statuses carry
 * `onEnemy`; damage a defender reflects is an `enemy_reflect`.
 */

import { ARENA_DUMMY_SECONDS, ARENA_FIGHT_SECONDS, FIGHT_TICK_SECONDS, SKILL_STATUS_DURATION_SECONDS } from './constants'
import { attackIntervalFor, cooldownFor, partyDps, partyMitigation, targetingOrder, wealthFactorFor } from './combat'
import { partyUnitStats } from './stats'
import { heroKit } from './content/skills'
import { SINGLE_TARGET, executeMultiplier, isAllyTarget, resolveAllyTargets, resolveEnemyTargets, type AbilityEffect } from './effects'
import { absorbDamage, applyStatus, canAutoattack, canCastAbilities, cleanse, extendHostile, hasStatus, isHostile, reflectFraction, tickStatuses, type StatusApplication, type StatusInstance } from './status'
import { decMaxZero, liveUnitStats, rollDamage, runFight, seededRandom, type FightEvent, type FightResult } from './fight'
import { ONE, ZERO, decMax, type Decimal } from './numbers'
import type { ClassSkill, FormationRow, HeroSnapshot, RunPosition, UnitStats } from './types'

export interface DuelInput {
    /** The attacker's live party. */
    attacker: HeroSnapshot
    /** The defender, with their `defenseLoadout` in place of their live loadout. */
    defender: HeroSnapshot
    seed: number
    /** The clock; `ARENA_FIGHT_SECONDS` unless a test wants another. */
    seconds?: number
}

export interface DuelResult extends FightResult {
    /** The attacker's units' max HP, in `unitIndex` order, for the replay's frames. */
    partyMaxHps: string[]
}

type SideIndex = 0 | 1

interface Fighter {
    stats: UnitStats
    hp: Decimal
    attackTimer: number
    skills: { id: string, cooldownSeconds: number, timer: number, multiplier: number, effect: AbilityEffect }[]
    statuses: StatusInstance[]
    /** Its fall has been logged; a revive clears it, so a second fall logs again. */
    fallen: boolean
}

/** A side's fighters, Hero first, then each fielded Champion: `partyUnitStats`' order, the log's. */
function sideOf(hero: HeroSnapshot): Fighter[] {
    const units = partyUnitStats(hero)
    const kits: readonly (readonly ClassSkill[])[] = [heroKit(hero), ...(hero.champions ?? []).map(champion => champion.abilities)]
    // the Gambler's Strike family reads banked Gold once per fight, as in `runFight`
    const wealth = wealthFactorFor(hero.wealthHours)
    return units.map((stats, index) => ({
        stats,
        hp: stats.maxHp,
        attackTimer: 0,
        statuses: [],
        fallen: false,
        skills: (kits[index] ?? []).map((entry) => {
            const effect = entry.effect ?? SINGLE_TARGET
            return {
                id: entry.id,
                cooldownSeconds: entry.cooldownSeconds,
                timer: cooldownFor(entry.cooldownSeconds, stats.cooldownSpd, stats.cooldownFactor),
                multiplier: entry.abilityMultiplier * (effect.wealthScaled ? wealth : 1),
                effect
            }
        })
    }))
}

/** Where an event about a body on `side` points: `unitIndex` for the attacker's, `enemyIndex` for the defender's. */
function on(side: SideIndex, index: number): Pick<FightEvent, 'unitIndex' | 'enemyIndex' | 'onEnemy'> {
    return side === 0 ? { unitIndex: index } : { enemyIndex: index, onEnemy: true }
}

/**
 * Resolve an Arena fight. Bounded like `runFight`: `seconds / FIGHT_TICK_SECONDS` ticks, whatever
 * the parties' strength.
 */
export function runDuel(input: DuelInput): DuelResult {
    const random = seededRandom(input.seed)
    const seconds = input.seconds ?? ARENA_FIGHT_SECONDS
    const sides: [Fighter[], Fighter[]] = [sideOf(input.attacker), sideOf(input.defender)]
    const events: FightEvent[] = []
    let elapsed = 0

    const alive = (f: Fighter) => f.hp.gt(0)
    const allDown = (side: SideIndex) => !sides[side].some(alive)

    /** Log a body's fall once; a revive resets it. */
    const fall = (side: SideIndex, index: number) => {
        const f = sides[side][index]!
        if (f.fallen || f.hp.gt(0)) return
        f.fallen = true
        events.push(side === 0
            ? { at: elapsed, kind: 'unit_down', unitIndex: index, remainingHp: '0' }
            : { at: elapsed, kind: 'enemy_down', enemyIndex: index, remainingHp: '0' })
    }

    /** Who a unit on the far side of `side` hits: taunt first, then the front row, then threat. */
    const focusOn = (side: SideIndex): number | null => {
        const fighters = sides[side]
        const living = fighters.filter(alive)
        if (living.length === 0) return null
        const taunting = living.filter(f => hasStatus(f.statuses, 'taunt'))
        const pool = taunting.length > 0 ? taunting : living
        const front = pool.filter(f => f.stats.row === 'front')
        const eligible = front.length > 0 ? front : pool
        const first = targetingOrder(eligible.map(f => f.stats))[0]
        const chosen = eligible.find(f => f.stats === first)
        return chosen ? fighters.indexOf(chosen) : null
    }

    /** A party's formation as an ability's pattern reads it: rows, and a pierce through the body behind. */
    const geometryOf = (side: SideIndex) => {
        const fighters = sides[side]
        const rowOf = (row: FormationRow) => fighters.flatMap((f, i) => f.stats.row === row ? [i] : [])
        return {
            rowOf: (row: FormationRow) => rowOf(row),
            columnOf: (index: number) => {
                const row = fighters[index]?.stats.row ?? 'front'
                const rank = rowOf(row).indexOf(index)
                const other = rowOf(row === 'front' ? 'back' : 'front')[rank]
                const column = other === undefined ? [index] : [index, other]
                // front to back
                return column.sort((a, b) => Number(fighters[a]!.stats.row !== 'front') - Number(fighters[b]!.stats.row !== 'front'))
            }
        }
    }

    /** Pooled on the attacking side, against the one target's DEF, live statuses on both (`runFight`'s rule). */
    const penetration = (side: SideIndex, target: Fighter) => ONE.sub(partyMitigation(
        sides[side].map(f => liveUnitStats(f.stats, f.statuses)),
        liveUnitStats(target.stats, target.statuses).def
    ))

    /**
     * A hit from `side`'s unit reaches the far side's: shields first, then HP, then reflect back
     * onto the caster. Logs the hit (what reached HP), what a shield ate, and any fall.
     */
    const land = (side: SideIndex, caster: number, target: number, damage: Decimal, crit: boolean, skillId?: string) => {
        const far = (1 - side) as SideIndex
        const from = sides[side][caster]!
        const tgt = sides[far][target]!
        const { throughput, absorbed, broken } = absorbDamage(tgt.statuses, damage)
        tgt.hp = tgt.hp.sub(throughput)
        if (absorbed.gt(0)) events.push({ at: elapsed, kind: 'shield', ...on(far, target), damage: absorbed.toString() })
        const skill = skillId === undefined ? {} : { skillId }
        events.push(side === 0
            ? { at: elapsed, kind: skillId === undefined ? 'attack' : 'skill', unitIndex: caster, enemyIndex: target, ...skill, damage: throughput.toString(), crit, remainingHp: decMaxZero(tgt.hp).toString() }
            : { at: elapsed, kind: skillId === undefined ? 'enemy_attack' : 'enemy_special', enemyIndex: caster, unitIndex: target, ...skill, damage: throughput.toString(), crit, remainingHp: decMaxZero(tgt.hp).toString() })
        // reflect, off what actually landed: the timed status and the passive line, summed
        const reflected = reflectFraction(tgt.statuses).add(tgt.stats.reflectFraction).mul(throughput)
        if (reflected.gt(0) && from.hp.gt(0)) {
            from.hp = from.hp.sub(reflected)
            events.push(side === 0
                ? { at: elapsed, kind: 'enemy_reflect', enemyIndex: target, unitIndex: caster, damage: reflected.toString(), remainingHp: decMaxZero(from.hp).toString() }
                : { at: elapsed, kind: 'reflect', unitIndex: target, enemyIndex: caster, damage: reflected.toString(), remainingHp: decMaxZero(from.hp).toString() })
            fall(side, caster)
        }
        for (const shield of broken) events.push({ at: elapsed, kind: 'status_expired', ...on(far, target), statusId: shield.id })
        fall(far, target)
    }

    /** Statuses tick on every standing body before anyone acts: a burn can finish one first. */
    const advance = (side: SideIndex) => {
        sides[side].forEach((f, index) => {
            if (!alive(f) || f.statuses.length === 0) return
            const { damage, healing, expired } = tickStatuses(f.statuses, FIGHT_TICK_SECONDS)
            if (damage.gt(0)) {
                f.hp = f.hp.sub(damage)
                events.push({ at: elapsed, kind: 'status_tick', ...on(side, index), onEnemy: side === 1, damage: damage.toString(), remainingHp: decMaxZero(f.hp).toString() })
            }
            if (healing.gt(0) && f.hp.gt(0)) {
                const before = f.hp
                f.hp = f.hp.add(healing).gt(f.stats.maxHp) ? f.stats.maxHp : f.hp.add(healing)
                events.push({ at: elapsed, kind: 'heal', ...on(side, index), damage: f.hp.sub(before).toString(), remainingHp: f.hp.toString() })
            }
            for (const status of expired) events.push({ at: elapsed, kind: 'status_expired', ...on(side, index), statusId: status.id })
            fall(side, index)
        })
    }

    /** One side's turn: every standing unit swings when its timer is up and fires what is off cooldown. */
    const act = (side: SideIndex) => {
        const far = (1 - side) as SideIndex
        const own = sides[side]
        for (const [index, unit] of own.entries()) {
            if (!alive(unit)) continue

            /** One ability, or an autoattack (the single-target default). False once nothing on the far side stands. */
            const cast = (multiplier: number, effect: AbilityEffect, skillId?: string): boolean => {
                const foes = sides[far]
                const living = foes.flatMap((f, i) => alive(f) ? [i] : [])
                if (living.length === 0) return false

                const statusFrom = (spec: NonNullable<AbilityEffect['status']>): StatusApplication => ({
                    id: skillId ?? 'autoattack',
                    kind: spec.kind,
                    ...(spec.stat === undefined ? {} : { stat: spec.stat }),
                    duration: spec.duration,
                    magnitude: spec.scalesWithPwr ? unit.stats.pwr.mul(spec.magnitude ?? 0) : (spec.magnitude ?? 0),
                    ...(spec.stacks === undefined ? {} : { stacks: spec.stacks })
                })

                /** A hostile status on a far body, shortened by its control resist; logged when it lands. */
                const afflict = (target: number, application: StatusApplication) => {
                    const tgt = foes[target]!
                    const duration = isHostile(application.kind) ? application.duration * Math.max(0, 1 - tgt.stats.controlResist) : application.duration
                    if (duration <= 0) return
                    if (applyStatus(tgt.statuses, { ...application, duration })) {
                        events.push({ at: elapsed, kind: 'status_applied', ...on(far, target), statusId: application.id })
                    }
                }

                const landSelfStatus = () => {
                    if (!effect.selfStatus) return
                    applyStatus(unit.statuses, { ...statusFrom(effect.selfStatus), id: `${skillId ?? 'autoattack'}_self` })
                    events.push({ at: elapsed, kind: 'status_applied', ...on(side, index), statusId: skillId ?? 'autoattack' })
                }

                // a cast that dealt no damage still shows up, so a replay sees it fire
                let dealtDamage = false
                const noteUtilityCast = () => {
                    if (dealtDamage || skillId === undefined) return
                    events.push(side === 0
                        ? { at: elapsed, kind: 'skill', unitIndex: index, skillId, damage: '0' }
                        : { at: elapsed, kind: 'enemy_special', enemyIndex: index, skillId, damage: '0' })
                }

                if (isAllyTarget(effect.target)) {
                    const roster = own.map(member => ({
                        alive: alive(member),
                        hpFraction: member.stats.maxHp.lte(0) ? 0 : member.hp.div(member.stats.maxHp).toNumber(),
                        power: member.stats.pwr.toNumber()
                    }))
                    for (const allyIndex of resolveAllyTargets(effect.target, index, roster, Boolean(effect.revive))) {
                        const ally = own[allyIndex]!
                        const skill = skillId === undefined ? {} : { skillId }
                        if (effect.revive && ally.hp.lte(0)) {
                            ally.hp = ally.stats.maxHp.mul(effect.revive)
                            ally.fallen = false
                            events.push({ at: elapsed, kind: 'heal', ...on(side, allyIndex), ...skill, damage: ally.hp.toString(), remainingHp: ally.hp.toString() })
                        }
                        if (effect.cleanse) {
                            for (const removed of cleanse(ally.statuses)) {
                                events.push({ at: elapsed, kind: 'status_expired', ...on(side, allyIndex), statusId: removed.id })
                            }
                        }
                        if (effect.heal) {
                            const before = ally.hp
                            const healed = ally.hp.add(unit.stats.pwr.mul(effect.heal))
                            ally.hp = healed.gt(ally.stats.maxHp) ? ally.stats.maxHp : healed
                            events.push({ at: elapsed, kind: 'heal', ...on(side, allyIndex), ...skill, damage: ally.hp.sub(before).toString(), remainingHp: ally.hp.toString() })
                        }
                        if (effect.shield) {
                            const pool = unit.stats.pwr.mul(effect.shield)
                            applyStatus(ally.statuses, {
                                id: `${skillId ?? 'shield'}_shield`,
                                kind: 'shield',
                                duration: effect.status?.duration ?? SKILL_STATUS_DURATION_SECONDS,
                                magnitude: pool
                            })
                            events.push({ at: elapsed, kind: 'shield', ...on(side, allyIndex), damage: pool.toString() })
                        }
                        if (effect.status) {
                            applyStatus(ally.statuses, statusFrom(effect.status))
                            events.push({ at: elapsed, kind: 'status_applied', ...on(side, allyIndex), statusId: skillId ?? 'autoattack' })
                        }
                    }
                    landSelfStatus()
                    noteUtilityCast()
                    return true
                }

                const focus = focusOn(far)
                if (focus === null) return false
                const geometry = geometryOf(far)
                const targets = resolveEnemyTargets(effect.target, focus, living, foes.length, {
                    columnOf: index => geometry.columnOf(index),
                    rowOf: row => geometry.rowOf(row)
                })

                for (const target of targets) {
                    const tgt = foes[target]!
                    if (multiplier > 0) {
                        // split into separate rolls, each with its own crit (`runFight`'s rule)
                        const hits = Math.max(1, Math.floor(effect.hits ?? 1))
                        for (let hit = 0; hit < hits && alive(tgt) && alive(unit); hit++) {
                            const hpFraction = tgt.stats.maxHp.lte(0) ? 0 : decMaxZero(tgt.hp).div(tgt.stats.maxHp).toNumber()
                            const scaled = (multiplier / hits) * executeMultiplier(effect, hpFraction)
                            const { damage, crit } = rollDamage(liveUnitStats(unit.stats, unit.statuses), penetration(side, tgt), scaled, random, effect)
                            dealtDamage = true
                            land(side, index, target, damage, crit, skillId)
                        }
                    }
                    if (!alive(tgt)) continue
                    if (effect.extendDebuffs) extendHostile(tgt.statuses, effect.extendDebuffs)
                    if (effect.status) {
                        const id = skillId ?? 'autoattack'
                        afflict(target, statusFrom(effect.status))
                        // Frostbind's freeze: once its own debuff has built far enough on this body
                        const built = tgt.statuses.find(status => status.id === id)
                        if (effect.escalation && built && built.stacks >= effect.escalation.atStacks) {
                            afflict(target, { ...statusFrom(effect.escalation.status), id: `${id}_escalation` })
                        }
                    }
                }
                if (alive(unit)) landSelfStatus()
                noteUtilityCast()
                return true
            }

            unit.attackTimer -= FIGHT_TICK_SECONDS
            if (unit.attackTimer <= 0) {
                unit.attackTimer += attackIntervalFor(liveUnitStats(unit.stats, unit.statuses).spd)
                // a stun eats the swing; the timer still ran
                if (canAutoattack(unit.statuses)) {
                    for (let hit = 0; hit < unit.stats.strikesPerAttack && alive(unit); hit++) {
                        if (!cast(1, SINGLE_TARGET)) break
                    }
                }
            }
            if (allDown(far) || !alive(unit)) continue

            const silenced = !canCastAbilities(unit.statuses)
            for (const skill of unit.skills) {
                skill.timer -= FIGHT_TICK_SECONDS
                if (skill.timer > 0) continue
                skill.timer += cooldownFor(skill.cooldownSeconds, liveUnitStats(unit.stats, unit.statuses).cooldownSpd, unit.stats.cooldownFactor)
                if (silenced || !alive(unit)) continue
                if (!cast(skill.multiplier, skill.effect, skill.id)) break
            }
            if (allDown(far)) return
        }
    }

    const finish = (outcome: DuelResult['outcome'], at: number): DuelResult => {
        const defenders = sides[1]
        const maxHps = defenders.map(f => f.stats.maxHp)
        const total = maxHps.reduce((sum, hp) => sum.add(hp), ZERO)
        const left = defenders.reduce((sum, f) => sum.add(decMaxZero(f.hp)), ZERO)
        const dealt = total.lte(0) ? 1 : ONE.sub(left.div(total)).toNumber()
        return {
            outcome,
            secondsElapsed: at,
            events,
            enemyHpRemaining: left.toString(),
            enemyMaxHp: total.toString(),
            enemyMaxHps: maxHps.map(hp => hp.toString()),
            damageDealtPct: Math.min(1, Math.max(0, dealt)),
            seed: input.seed,
            partyMaxHps: sides[0].map(f => f.stats.maxHp.toString())
        }
    }

    // a side with nobody in it has lost before it starts
    if (allDown(1)) return finish('win', 0)
    if (allDown(0)) return finish('wipe', 0)

    for (let tick = 0; tick < Math.ceil(seconds / FIGHT_TICK_SECONDS - 1e-9); tick++) {
        elapsed = Math.min(seconds, (tick + 1) * FIGHT_TICK_SECONDS)
        advance(0)
        advance(1)
        if (allDown(1)) return finish('win', elapsed)
        if (allDown(0)) return finish('wipe', elapsed)

        // who acts first this tick is the seed's call: fixed, the attacker would win most mirror matches
        for (const side of (random() < 0.5 ? [0, 1] : [1, 0]) as SideIndex[]) {
            act(side)
            // the side that just acted wins a double knockout (a reflect can fell the striker too)
            const far = (1 - side) as SideIndex
            if (allDown(far)) return finish(far === 1 ? 'win' : 'wipe', elapsed)
            if (allDown(side)) return finish(side === 1 ? 'win' : 'wipe', elapsed)
        }
    }
    return finish('timeout', seconds)
}

/**
 * A Training Dummy fight (§2a): the attacker's party against a straw target that never swings and
 * has no DEF, its HP `ARENA_DUMMY_SECONDS` of the party's own autoattack DPS. A guaranteed win, so
 * the log is only the show of it: the abilities on top bring it down sooner, never later, and it is
 * down long before `ARENA_FIGHT_SECONDS` at any depth. `position` only satisfies `runFight`: an
 * encounter brings no gate boss with it.
 */
export function runArenaDummy(hero: HeroSnapshot, position: RunPosition, seed: number): DuelResult {
    const units = partyUnitStats(hero)
    const hp = decMax(ONE, partyDps(units, 0).mul(ARENA_DUMMY_SECONDS))
    const fight = runFight({
        hero,
        position,
        seed,
        encounter: { pack: { members: [{ hp, pwr: ZERO, def: ZERO }] }, seconds: ARENA_FIGHT_SECONDS, passive: true }
    })
    return { ...fight, partyMaxHps: units.map(unit => unit.maxHp.toString()) }
}
