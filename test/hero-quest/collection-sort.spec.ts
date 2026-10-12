/**
 * Collection grid ordering (session-1 playtest, finding 5).
 *
 * The sort is the only part of the UI restructure that is real logic rather than layout, and it
 * is shared by all four grids — so a bug here is a bug in four places at once, which is exactly
 * what makes it worth pinning.
 *
 * The properties asserted are the ones a future content edit could quietly break: that ordering
 * comes from the rarity ladder rather than array order, that the tiebreak chain is total, and
 * that an unknown value sorts somewhere defined instead of throwing at render time.
 */

import { describe, expect, it } from 'vitest'
import { hqRarityRank, hqSortCollection, type HqSortableEntry } from '../../app/utils/hero-quest-collection'

const AXIS = ['damage', 'tank', 'support', 'control'] as const
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']

function entry(name: string, rarity: string, axis: string): HqSortableEntry & { axis: string } {
    return { id: name.toLowerCase(), name, rarity, owned: false, axis }
}

function sort(entries: (HqSortableEntry & { axis: string })[]) {
    return hqSortCollection(entries, item => item.axis, AXIS).map(item => item.name)
}

describe('hqRarityRank', () => {
    it('ranks the six tiers in ladder order', () => {
        expect(hqRarityRank('common')).toBe(0)
        expect(hqRarityRank('mythic')).toBe(5)
        expect(hqRarityRank('rare')).toBeLessThan(hqRarityRank('legendary'))
    })

    it('puts an unknown rarity last rather than throwing', () => {
        // A roster edit that introduces a tier the UI has not learned yet must degrade to a
        // funny-looking grid, never to a blank page.
        expect(hqRarityRank('transcendent')).toBeGreaterThan(hqRarityRank('mythic'))
    })
})

describe('hqSortCollection', () => {
    it('orders by rarity low to high, ignoring the order it was given', () => {
        const sorted = sort([
            entry('Mythic one', 'mythic', 'damage'),
            entry('Common one', 'common', 'damage'),
            entry('Epic one', 'epic', 'damage')
        ])
        expect(sorted).toEqual(['Common one', 'Epic one', 'Mythic one'])
    })

    it('falls to the system axis inside a rarity, in the order the system declares it', () => {
        // Not alphabetical: `damage` before `control` is the roster's own ordering, and the grid
        // has to match the filter chips beside it.
        const sorted = sort([
            entry('C', 'rare', 'control'),
            entry('A', 'rare', 'damage'),
            entry('B', 'rare', 'tank')
        ])
        expect(sorted).toEqual(['A', 'B', 'C'])
    })

    it('breaks a full tie by name, so array order never leaks into the grid', () => {
        // The reason this matters: without it, reordering a content array reshuffles a grid the
        // player has learned the shape of, for no reason they can see.
        const sorted = sort([
            entry('Zephyr', 'epic', 'tank'),
            entry('Anvil', 'epic', 'tank'),
            entry('Morrow', 'epic', 'tank')
        ])
        expect(sorted).toEqual(['Anvil', 'Morrow', 'Zephyr'])
    })

    it('applies the three keys in that priority', () => {
        const sorted = sort([
            entry('Rare tank', 'rare', 'tank'),
            entry('Common control', 'common', 'control'),
            entry('Rare damage', 'rare', 'damage'),
            entry('Common damage', 'common', 'damage')
        ])
        expect(sorted).toEqual(['Common damage', 'Common control', 'Rare damage', 'Rare tank'])
    })

    it('sorts an entry off the axis last instead of dropping it', () => {
        const sorted = sort([
            entry('Off axis', 'rare', 'summoner'),
            entry('On axis', 'rare', 'control')
        ])
        expect(sorted).toEqual(['On axis', 'Off axis'])
    })

    it('does not mutate the roster it was handed', () => {
        // The grids pass a server payload straight in; sorting it in place would reorder the
        // reactive source and make every other reader of it depend on render order.
        const source = [
            entry('Mythic', 'mythic', 'damage'),
            entry('Common', 'common', 'damage')
        ]
        const before = source.map(item => item.name)
        hqSortCollection(source, item => item.axis, AXIS)
        expect(source.map(item => item.name)).toEqual(before)
    })

    it('keeps every entry — a sort is not a filter', () => {
        const source = Array.from({ length: 48 }, (_, index) =>
            entry(`Item ${index}`, RARITIES[index % 6]!, AXIS[index % 4]!))
        expect(hqSortCollection(source, item => item.axis, AXIS)).toHaveLength(48)
    })
})
