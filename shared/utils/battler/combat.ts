/**
 * Deterministic combat (§12.5). The same inputs always produce the same
 * replay — the server resolves it authoritatively and the client re-runs
 * the identical code to animate it. The seed is threaded for future traits;
 * today's loop is fully deterministic without it.
 */
import { BATTLER, levelFor } from './shop'
import type { BattlerUnitSpec, BattlerModifier } from './unit'

export interface BattleUnit {
    /** Stable identity within the battle, for the replay events. */
    key: string
    spec: BattlerUnitSpec
    attackId: number
    instances: number
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
}

function toLive(unit: BattleUnit): LiveUnit {
    const level = levelFor(unit.instances)
    const multiplier = BATTLER.levelMultiplier[level] ?? 1
    const chosen = unit.spec.attacks.find(attack => attack.attackId === unit.attackId)
        ?? unit.spec.attacks[0]!
    const hp = Math.max(1, Math.round(unit.spec.hp * multiplier))
    return {
        key: unit.key,
        spec: unit.spec,
        attack: Math.max(1, Math.round(chosen.damage * multiplier)),
        charge: 0,
        chargeMax: chosen.charge,
        hp,
        maxHp: hp,
        bounty: unit.spec.bounty
    }
}

/**
 * Printed order, honoured as-is (§12.3): every matching weakness entry by
 * its operator, then every matching resistance entry, floor at 1. Dual
 * weakness applies once per matching type.
 */
export function applyModifiers(amount: number, attackerType: string | null, target: BattlerUnitSpec): number {
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

export function simulateBattle(a: BattleUnit[], b: BattleUnit[], _seed: number): BattleReplay {
    const sides: [LiveUnit[], LiveUnit[]] = [a.map(toLive), b.map(toLive)]
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
        // 3–4. Simultaneous declarations at full charge; the enemy active
        // (front-most living unit) is the shield.
        const declarations: { attacker: LiveUnit, sideIndex: 0 | 1, target: LiveUnit }[] = []
        for (const sideIndex of [0, 1] as const) {
            const enemies = sides[1 - sideIndex]!
            const active = enemies.find(unit => unit.hp > 0)
            if (!active) continue
            for (const unit of sides[sideIndex]!) {
                if (unit.hp > 0 && unit.charge >= unit.chargeMax) {
                    declarations.push({ attacker: unit, sideIndex, target: active })
                }
            }
        }
        for (const { attacker, sideIndex, target } of declarations) {
            const amount = applyModifiers(attacker.attack, attacker.spec.type, target.spec)
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
