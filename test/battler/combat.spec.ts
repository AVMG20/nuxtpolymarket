/**
 * Combat (§12.5): deterministic, simultaneous, charge-driven. Pure — no
 * database, no CSPRNG.
 */
import { describe, expect, it } from 'vitest'
import { simulateBattle, applyModifiers } from '#shared/utils/battler/combat'
import type { BattleUnit } from '#shared/utils/battler/combat'
import type { BattlerUnitSpec } from '#shared/utils/battler/unit'

function spec(overrides: Partial<BattlerUnitSpec>): BattlerUnitSpec {
    return {
        cardId: 'c',
        name: 'Testling',
        hp: 10,
        type: 'Colorless',
        attacks: [{ attackId: 1, name: 'Hit', damage: 2, charge: 1 }],
        weaknesses: [],
        resistances: [],
        retreat: 1,
        bounty: 0,
        ...overrides
    }
}

function unit(key: string, overrides: Partial<BattlerUnitSpec> = {}, instances = 1): BattleUnit {
    const s = spec(overrides)
    return { key, spec: s, attackId: s.attacks[0]!.attackId, instances }
}

describe('simulateBattle', () => {
    it('replays identically from the same inputs', () => {
        const a = [unit('a1'), unit('a2', { hp: 6 })]
        const b = [unit('b1', { hp: 12 }), unit('b2')]
        const first = simulateBattle(a, b, 42)
        const second = simulateBattle(a, b, 42)
        expect(second).toEqual(first)
    })

    it('charge cadence: a 1-cost swings every round, a 4-cost every fourth', () => {
        const fast = unit('fast', { attacks: [{ attackId: 1, name: 'Jab', damage: 2, charge: 1 }], hp: 100 })
        const slow = unit('slow', { attacks: [{ attackId: 1, name: 'Nuke', damage: 18, charge: 4 }], hp: 100 })
        const replay = simulateBattle([fast], [slow], 1)
        const fastAttacks = replay.events.filter(e => e.kind === 'attack' && e.from === 'fast')
        const slowAttacks = replay.events.filter(e => e.kind === 'attack' && e.from === 'slow')
        expect(fastAttacks.length).toBeGreaterThan(slowAttacks.length * 2)
        expect((slowAttacks[0] as { round: number }).round).toBe(4)
    })

    it('the active shields the bench, and the bench slides forward on faint', () => {
        const sniperSide = [unit('atk', { attacks: [{ attackId: 1, name: 'Hit', damage: 5, charge: 1 }], hp: 100 })]
        const shieldSide = [unit('active', { hp: 5 }), unit('bench', { hp: 100 })]
        const replay = simulateBattle(sniperSide, shieldSide, 1)
        const targets = replay.events.filter(e => e.kind === 'attack' && e.from === 'atk').map(e => (e as { to: string }).to)
        expect(targets[0]).toBe('active')
        expect(targets).toContain('bench')
        expect(targets.indexOf('bench')).toBeGreaterThan(0)
    })

    it('bounty pays prizes to the side that felled the suffixed unit', () => {
        const exSide = [unit('chase', { hp: 3, bounty: 2, attacks: [{ attackId: 1, name: 'Big', damage: 1, charge: 3 }] })]
        const bulkSide = [unit('bulk1', { hp: 30 }), unit('bulk2', { hp: 30 })]
        const replay = simulateBattle(exSide, bulkSide, 1)
        const prizes = replay.events.filter(e => e.kind === 'prize')
        expect(prizes).toHaveLength(2)
        expect(prizes.every(p => p.side === 1)).toBe(true)
    })

    it('level multipliers apply to hp and attack', () => {
        const merged = unit('l3', {}, 6) // level 3: ×3.0
        const single = unit('l1', {}, 1)
        const replay = simulateBattle([merged], [single], 1)
        const hit = replay.events.find(e => e.kind === 'attack' && e.from === 'l3') as { amount: number }
        expect(hit.amount).toBe(6) // 2 × 3.0
        expect(replay.result).toBe('a')
    })

    it('caps at 30 rounds and decides by remaining HP fraction', () => {
        // Both un-killable within the cap; a keeps a larger fraction.
        const tanky = unit('a', { hp: 300, attacks: [{ attackId: 1, name: 'Tap', damage: 1, charge: 5 }] })
        const softer = unit('b', { hp: 100, attacks: [{ attackId: 1, name: 'Tap', damage: 1, charge: 5 }] })
        const replay = simulateBattle([tanky], [softer], 1)
        expect(replay.rounds).toBe(30)
        expect(replay.result).toBe('a')
        expect(replay.remaining[0]).toBeGreaterThan(replay.remaining[1])
    })

    it('mirror boards draw at the cap', () => {
        const a = unit('a', { hp: 500 })
        const b = unit('b', { hp: 500 })
        const replay = simulateBattle([a], [b], 7)
        expect(replay.result).toBe('draw')
    })
})

describe('applyModifiers', () => {
    const target = spec({
        weaknesses: [{ type: 'Fire', operator: 'x', value: 2 }],
        resistances: [{ type: 'Water', operator: 'add', value: -2 }]
    })

    it('multiplies weakness, adds resistance, floors at 1', () => {
        expect(applyModifiers(5, 'Fire', target)).toBe(10)
        expect(applyModifiers(5, 'Water', target)).toBe(3)
        expect(applyModifiers(1, 'Water', target)).toBe(1)
        expect(applyModifiers(5, 'Grass', target)).toBe(5)
    })

    it('dual weakness applies once per matching type', () => {
        const dual = spec({
            weaknesses: [
                { type: 'Fire', operator: 'x', value: 2 },
                { type: 'Fire', operator: 'add', value: 3 }
            ]
        })
        expect(applyModifiers(5, 'Fire', dual)).toBe(13)
    })
})
