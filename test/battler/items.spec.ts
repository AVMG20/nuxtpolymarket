/**
 * Trainers as items (§12.6): name-keyed authoring, the stadium name
 * heuristic, the generic tool fallback, and their combat effects. Pure —
 * no database.
 */
import { describe, expect, it } from 'vitest'
import { deriveItem, itemCostFor, normalizeItemName } from '#shared/utils/battler/items'
import { simulateBattle } from '#shared/utils/battler/combat'
import type { BattleUnit } from '#shared/utils/battler/combat'
import type { BattlerUnitSpec } from '#shared/utils/battler/unit'

const trainer = (name: string, extra: Record<string, unknown> = {}) => ({ category: 'Trainer', name, ...extra })

const spec = (over: Partial<BattlerUnitSpec> = {}): BattlerUnitSpec => ({
    cardId: 'c',
    name: 'Unit',
    hp: 10,
    type: 'Fire',
    attacks: [{ attackId: 1, name: 'Hit', damage: 2, charge: 1 }],
    weaknesses: [],
    resistances: [],
    retreat: 1,
    bounty: 0,
    ...over
})

const battler = (key: string, over: Partial<BattlerUnitSpec> = {}, items: BattleUnit['items'] = []): BattleUnit =>
    ({ key, spec: spec(over), attackId: 1, instances: 1, items })

describe('deriveItem', () => {
    it('resolves authored names, apostrophes and all', () => {
        const policy = deriveItem('t1', trainer('Weakness Policy'))!
        expect(policy.subtype).toBe('tool')
        expect(policy.attach).toEqual({ noWeakness: true })

        const boss = deriveItem('t2', trainer("Boss's Orders"))!
        expect(boss.subtype).toBe('supporter')
        expect(boss.consume?.teamAtk).toBe(2)

        const ball = deriveItem('t3', trainer('Ultra Ball'))!
        expect(ball.consume?.freeRerolls).toBe(1)
        expect(normalizeItemName("Boss’s   Orders")).toBe('bosss orders')
    })

    it('classifies gyms and stadiums by name', () => {
        const gym = deriveItem('t4', trainer('Broken Ground Gym'))!
        expect(gym.subtype).toBe('stadium')
        expect(gym.stadium).toBeTruthy()
    })

    it('falls back to a deterministic tool scaled by tier', () => {
        const a = deriveItem('t5', trainer('Tremendous Bomb'), 'Common')!
        const b = deriveItem('t5', trainer('Tremendous Bomb'), 'Common')!
        expect(a.subtype).toBe('tool')
        expect(a.attach).toEqual(b.attach) // stable per name
        expect(deriveItem('x', { category: 'Pokemon', name: 'Nope' })).toBeNull()
    })

    it('prices one step under the unit tier, floor ₱2', () => {
        expect(itemCostFor('Common')).toBe(2)
        expect(itemCostFor('Double Rare')).toBe(5)
        expect(itemCostFor('Hyper Rare')).toBe(9)
    })
})

describe('items in combat', () => {
    it('attachments buff the holder', () => {
        const armed = battler('armed', {}, [{ name: 'Muscle Band', effect: { atk: 2 } }])
        const plain = battler('plain')
        const replay = simulateBattle([armed], [plain], 1)
        const hit = replay.events.find(e => e.kind === 'attack' && e.from === 'armed') as { amount: number }
        expect(hit.amount).toBe(4) // 2 base + 2 item
    })

    it('weakness policy cancels the printed weakness', () => {
        const target = (items: BattleUnit['items']) =>
            battler('t', { weaknesses: [{ type: 'Fire', operator: 'x', value: 2 }], hp: 100 }, items)
        const attacker = battler('a', { type: 'Fire', hp: 100 })
        const naked = simulateBattle([attacker], [target([])], 1)
            .events.find(e => e.kind === 'attack' && e.from === 'a') as { amount: number }
        const shielded = simulateBattle([attacker], [target([{ name: 'Weakness Policy', effect: { noWeakness: true } }])], 1)
            .events.find(e => e.kind === 'attack' && e.from === 'a') as { amount: number }
        expect(naked.amount).toBe(4) // 2 × 2 weakness
        expect(shielded.amount).toBe(2)
    })

    it('a stadium affects both boards', () => {
        const a = battler('a', { hp: 100 })
        const b = battler('b', { hp: 100 })
        const replay = simulateBattle([a], [b], 1, { allAtk: 1 })
        const hits = replay.events.filter(e => e.kind === 'attack') as { amount: number }[]
        expect(hits.length).toBeGreaterThan(1)
        for (const hit of hits.slice(0, 2)) expect(hit.amount).toBe(3) // 2 + 1 for everyone
    })

    it('charge modifiers floor at one round', () => {
        const speedy = battler('s', { hp: 100 }, [{ name: 'Magnifier', effect: { charge: -1 } }])
        const replay = simulateBattle([speedy], [battler('d', { hp: 100 })], 1)
        const first = replay.events.find(e => e.kind === 'attack' && e.from === 's') as { round: number }
        expect(first.round).toBe(1) // 1-charge attack, -1 floored at 1
    })
})
