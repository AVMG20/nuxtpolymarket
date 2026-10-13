/**
 * The Collections equip picker (`app/utils/hero-quest-equip.ts`): which spots a Champion, Skill or
 * Artifact can take, and the party, formation or slot list each pick comes to.
 */
import { describe, expect, it } from 'vitest'
import { hqApplyChampionPick, hqApplySlotPick, hqChampionPicker, hqSlotPicker, type HqPartyState } from '../../app/utils/hero-quest-equip'

const party = (over: Partial<HqPartyState> = {}): HqPartyState => ({
    party: ['a', 'b'],
    formation: { hero: 'front', a: 'front', b: 'back' },
    slots: 3,
    maxSlots: 5,
    capacity: 3,
    ...over
})

const picks = (picker: ReturnType<typeof hqChampionPicker>) =>
    picker.rows.map(row => row.spots.map(s => `${s.pick}${s.enabled ? '' : '-'}${s.current ? '*' : ''}`))

describe('champion picker', () => {
    it('lays out the formation, Hero first in its row, free spots after, all free spots open while a slot is', () => {
        expect(picks(hqChampionPicker('c', party()))).toEqual([
            ['hero-', 'with:a', 'row:front'],
            ['with:b', 'row:back', 'row:back']
        ])
        expect(hqChampionPicker('c', party()).remove).toBeNull()
    })

    it('leaves only replacing a fielded Champion when the party is full', () => {
        const picker = hqChampionPicker('c', party({ slots: 2 }))
        expect(picks(picker)).toEqual([
            ['hero-', 'with:a', 'row:front-'],
            ['with:b', 'row:back-', 'row:back-']
        ])
        expect(picker.title).toMatch(/replace/i)
    })

    it('lets a fielded Champion move to the other row, swap with anyone, or be benched', () => {
        const picker = hqChampionPicker('a', party({ slots: 2 }))
        expect(picks(picker)).toEqual([
            ['hero-', 'with:a-*', 'row:front-'],
            ['with:b', 'row:back', 'row:back']
        ])
        expect(picker.remove).toBe('Bench')
        expect(picks(hqChampionPicker('b', party()))[0]![0]).toBe('hero')
    })

    it('fields into a free spot, and moves a fielded one there', () => {
        expect(hqApplyChampionPick('c', 'row:back', party())).toEqual({
            championIds: ['a', 'b', 'c'],
            formation: { hero: 'front', a: 'front', b: 'back', c: 'back' }
        })
        expect(hqApplyChampionPick('a', 'row:back', party())?.formation.a).toBe('back')
        expect(hqApplyChampionPick('a', 'row:front', party())).toBeNull()
        expect(hqApplyChampionPick('c', 'row:back', party({ slots: 2 }))).toBeNull()
    })

    it('replaces a fielded Champion in its place and row', () => {
        expect(hqApplyChampionPick('c', 'with:b', party({ slots: 2 }))).toEqual({
            championIds: ['a', 'c'],
            formation: { hero: 'front', a: 'front', b: 'back', c: 'back' }
        })
    })

    it('swaps two fielded Champions, places and rows, and a Champion with the Hero', () => {
        expect(hqApplyChampionPick('a', 'with:b', party())).toEqual({
            championIds: ['b', 'a'],
            formation: { hero: 'front', a: 'back', b: 'front' }
        })
        expect(hqApplyChampionPick('b', 'hero', party())?.formation).toEqual({ hero: 'back', a: 'front', b: 'front' })
        expect(hqApplyChampionPick('c', 'hero', party())).toBeNull()
    })

    it('puts an x on every fielded Champion, never the Hero, that benches it and frees its spot', () => {
        const picker = hqChampionPicker('c', party({ slots: 2 }))
        expect(picker.rows.map(row => row.spots.map(s => s.unset ?? null))).toEqual([
            [null, 'bench:a', null],
            ['bench:b', null, null]
        ])
        const freed = hqApplyChampionPick('c', 'bench:b', party({ slots: 2 }))!
        expect(freed.championIds).toEqual(['a'])
        // the picker read again over the freed party offers the open spots
        expect(picks(hqChampionPicker('c', party({ slots: 2, party: freed.championIds })))[1]).toEqual(['row:back', 'row:back', 'row:back'])
        expect(hqApplyChampionPick('c', 'bench:x', party())).toBeNull()
    })

    it('says how many Champion slots are unlocked of the most', () => {
        expect(hqChampionPicker('c', party()).hint).toBe('3/5 slots unlocked')
    })

    it('benches a fielded Champion only', () => {
        expect(hqApplyChampionPick('a', 'remove', party())?.championIds).toEqual(['b'])
        expect(hqApplyChampionPick('c', 'remove', party())).toBeNull()
    })
})

describe('skill and artifact picker', () => {
    it('shows the held slots, then the free ones, open while it is off', () => {
        const picker = hqSlotPicker('z', ['x'], 3, 5, 'skill')
        expect(picker.rows[0]!.spots.map(s => [s.pick, s.enabled])).toEqual([['with:x', true], ['add', true], ['add', true]])
        expect(picker.remove).toBeNull()
        expect(picker.hint).toBe('3/5 slots unlocked')
    })

    it('asks which to replace when every slot is held', () => {
        const picker = hqSlotPicker('z', ['x', 'y'], 2, 5, 'skill')
        expect(picker.title).toBe('Slots full: replace which skill?')
        expect(picker.rows[0]!.spots.every(s => s.enabled)).toBe(true)
    })

    it('offers a swap and Unequip once it is on, its own slot marked', () => {
        const picker = hqSlotPicker('x', ['x', 'y'], 3, 5, 'artifact')
        expect(picker.rows[0]!.spots.map(s => [s.pick, s.enabled, s.current])).toEqual([
            ['with:x', false, true], ['with:y', true, false], ['add', false, false]
        ])
        expect(picker.remove).toBe('Unequip')
    })

    it('adds, replaces in place, swaps and removes', () => {
        expect(hqApplySlotPick('z', 'add', ['x'], 2)).toEqual(['x', 'z'])
        expect(hqApplySlotPick('z', 'add', ['x', 'y'], 2)).toBeNull()
        expect(hqApplySlotPick('z', 'with:x', ['x', 'y'], 2)).toEqual(['z', 'y'])
        expect(hqApplySlotPick('y', 'with:x', ['x', 'y'], 2)).toEqual(['y', 'x'])
        expect(hqApplySlotPick('x', 'remove', ['x', 'y'], 2)).toEqual(['y'])
        expect(hqApplySlotPick('z', 'remove', ['x', 'y'], 2)).toBeNull()
    })
})
