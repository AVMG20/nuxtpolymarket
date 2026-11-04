/**
 * The Collections equip picker (`app/utils/hero-quest-equip.ts`): the party, formation or slot
 * list each pick comes to, and the picks it refuses.
 */
import { describe, expect, it } from 'vitest'
import { hqApplyChampionPick, hqApplySlotPick, type HqPartyState } from '../../app/utils/hero-quest-equip'

const party = (over: Partial<HqPartyState> = {}): HqPartyState => ({
    party: ['a', 'b'],
    formation: { hero: 'front', a: 'front', b: 'back' },
    slots: 3,
    maxSlots: 5,
    capacity: 3,
    ...over
})

describe('champion picker', () => {
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

    it('benches a fielded Champion only', () => {
        expect(hqApplyChampionPick('a', 'remove', party())?.championIds).toEqual(['b'])
        expect(hqApplyChampionPick('c', 'remove', party())).toBeNull()
    })
})

describe('skill and artifact picker', () => {
    it('adds, replaces in place, swaps and removes', () => {
        expect(hqApplySlotPick('z', 'add', ['x'], 2)).toEqual(['x', 'z'])
        expect(hqApplySlotPick('z', 'add', ['x', 'y'], 2)).toBeNull()
        expect(hqApplySlotPick('z', 'with:x', ['x', 'y'], 2)).toEqual(['z', 'y'])
        expect(hqApplySlotPick('y', 'with:x', ['x', 'y'], 2)).toEqual(['y', 'x'])
        expect(hqApplySlotPick('x', 'remove', ['x', 'y'], 2)).toEqual(['y'])
        expect(hqApplySlotPick('z', 'remove', ['x', 'y'], 2)).toBeNull()
    })
})
