/**
 * Deterministic combat (§12.5). The same inputs always produce the same
 * replay — the server resolves it authoritatively and the client re-runs
 * the identical code to animate it. The seed is threaded for future traits;
 * today's loop is fully deterministic without it.
 */
import { BATTLER, levelFor } from './shop'
import type { BattlerUnitSpec, BattlerModifier } from './unit'
import type { BattlerAttachEffect, BattlerStadiumEffect } from './items'

export interface BattleItem {
    name: string
    effect: BattlerAttachEffect
}

export interface BattleUnit {
    /** Stable identity within the battle, for the replay events. */
    key: string
    spec: BattlerUnitSpec
    attackId: number
    instances: number
    /** Attached tools (§12.6) — applied on top of the level multiplier. */
    items?: BattleItem[]
}

export type BattleEvent =
    | { kind: 'attack', round: number, side: 0 | 1, from: string, to: string, amount: number }
    | { kind: 'faint', round: number, side: 0 | 1, unit: string }
    | { kind: 'prize', round: number, side: 0 | 1, unit: string, bonus: number }

export interface BattleReplay {
    result: 'a' | 'b' | 'draw'
    rounds: number
    events: BattleEvent[]
    /** Remaining HP fraction per side at the end, for the cap decision. */
    remaining: [number, number]
}

interface LiveUnit {
    key: string
    spec: BattlerUnitSpec
    attack: number
    charge: number
    chargeMax: number
    hp: number
    maxHp: number
    bounty: number
    /** Effective modifiers — attachments and the stadium can strip these. */
    weaknesses: BattlerModifier[]
    resistances: BattlerModifier[]
}

function toLive(unit: BattleUnit, stadium: BattlerStadiumEffect | null): LiveUnit {
    const level = levelFor(unit.instances)
    const multiplier = BATTLER.levelMultiplier[level] ?? 1
    const chosen = unit.spec.attacks.find(attack => attack.attackId === unit.attackId)
        ?? unit.spec.attacks[0]!
    let hp = Math.max(1, Math.round(unit.spec.hp * multiplier))
    let attack = Math.max(1, Math.round(chosen.damage * multiplier))
    let chargeMax = chosen.charge
    let noWeakness = false
    for (const item of unit.items ?? []) {
        hp += item.effect.hp ?? 0
        attack += item.effect.atk ?? 0
        chargeMax += item.effect.charge ?? 0
        if (item.effect.noWeakness) noWeakness = true
    }
    if (stadium) {
        hp += stadium.allHp ?? 0
        attack += stadium.allAtk ?? 0
        chargeMax += stadium.allCharge ?? 0
        if (stadium.noWeakness) noWeakness = true
    }
    return {
        key: unit.key,
        spec: unit.spec,
        attack: Math.max(1, attack),
        charge: 0,
        chargeMax: Math.max(1, chargeMax),
        hp: Math.max(1, hp),
        maxHp: Math.max(1, hp),
        bounty: unit.spec.bounty,
        weaknesses: noWeakness ? [] : unit.spec.weaknesses,
        resistances: unit.spec.resistances
    }
}

/**
 * Printed order, honoured as-is (§12.3): every matching weakness entry by
 * its operator, then every matching resistance entry, floor at 1. Dual
 * weakness applies once per matching type.
 */
export function applyModifiers(amount: number, attackerType: string | null, target: { weaknesses: BattlerModifier[], resistances: BattlerModifier[] }): number {
    let damage = amount
    const applies = (entry: BattlerModifier) => attackerType !== null && entry.type === attackerType
    for (const weakness of target.weaknesses) {
        if (!applies(weakness)) continue
        damage = weakness.operator === 'x' ? damage * weakness.value : damage + weakness.value
    }
    for (const resistance of target.resistances) {
        if (!applies(resistance)) continue
        damage = resistance.operator === 'x' ? damage * resistance.value : damage + resistance.value
    }
    return Math.max(1, Math.round(damage))
}

/** Prizes buff the collecting side: +1 attack each, highest attackers first. */
function awardPrizes(side: LiveUnit[], count: number, round: number, sideIndex: 0 | 1, events: BattleEvent[]) {
    const alive = side.filter(unit => unit.hp > 0)
    if (alive.length === 0) return
    const ordered = [...alive].sort((a, b) => b.attack - a.attack || a.key.localeCompare(b.key))
    for (let i = 0; i < count; i++) {
        const unit = ordered[i % ordered.length]!
        unit.attack += 1
        events.push({ kind: 'prize', round, side: sideIndex, unit: unit.key, bonus: 1 })
    }
}

export function simulateBattle(a: BattleUnit[], b: BattleUnit[], _seed: number, stadium: BattlerStadiumEffect | null = null): BattleReplay {
    const sides: [LiveUnit[], LiveUnit[]] = [a.map(unit => toLive(unit, stadium)), b.map(unit => toLive(unit, stadium))]
    const events: BattleEvent[] = []

    const totalHp = (side: LiveUnit[]) => side.reduce((sum, unit) => sum + Math.max(0, unit.hp), 0)
    const startHp: [number, number] = [totalHp(sides[0]), totalHp(sides[1])]

    let round = 0
    while (round < BATTLER.roundCap) {
        round++
        // 2. Charge.
        for (const side of sides) {
            for (const unit of side) {
                if (unit.hp > 0) unit.charge += 1
            }
        }
        // 3–4. Simultaneous declarations at full charge. Each resolves in
        // declaration order against the enemy's front-most LIVING unit — when
        // the shield falls mid-round the remaining declarations carry to the
        // next unit instead of overkilling the corpse. (A dying attacker
        // still lands its declared attack: trades are real.)
        const declarations: { attacker: LiveUnit, sideIndex: 0 | 1 }[] = []
        for (const sideIndex of [0, 1] as const) {
            for (const unit of sides[sideIndex]!) {
                if (unit.hp > 0 && unit.charge >= unit.chargeMax) {
                    declarations.push({ attacker: unit, sideIndex })
                }
            }
        }
        for (const { attacker, sideIndex } of declarations) {
            const target = sides[1 - sideIndex]!.find(unit => unit.hp > 0)
            if (!target) continue
            const amount = applyModifiers(attacker.attack, attacker.spec.type, target)
            target.hp -= amount
            attacker.charge = 0
            events.push({ kind: 'attack', round, side: sideIndex, from: attacker.key, to: target.key, amount })
        }
        // 6. Faints resolve; bounty pays the opposing side.
        for (const sideIndex of [0, 1] as const) {
            for (const unit of sides[sideIndex]!) {
                if (unit.hp <= 0 && unit.maxHp > 0 && !events.some(event => event.kind === 'faint' && event.unit === unit.key)) {
                    events.push({ kind: 'faint', round, side: sideIndex, unit: unit.key })
                    if (unit.bounty > 0) {
                        awardPrizes(sides[1 - sideIndex]!, unit.bounty, round, (1 - sideIndex) as 0 | 1, events)
                    }
                }
            }
        }
        const aliveA = sides[0].some(unit => unit.hp > 0)
        const aliveB = sides[1].some(unit => unit.hp > 0)
        if (!aliveA || !aliveB) {
            return {
                result: aliveA ? 'a' : aliveB ? 'b' : 'draw',
                rounds: round,
                events,
                remaining: [totalHp(sides[0]) / startHp[0], totalHp(sides[1]) / startHp[1]]
            }
        }
    }

    // Round cap: higher remaining fraction of starting HP wins (§12.5).
    const remaining: [number, number] = [totalHp(sides[0]) / startHp[0], totalHp(sides[1]) / startHp[1]]
    const result = remaining[0] > remaining[1] ? 'a' : remaining[1] > remaining[0] ? 'b' : 'draw'
    return { result, rounds: round, events, remaining }
}
