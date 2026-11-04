/**
 * Collection grid ordering, shared by all four grids: rarity, then the system axis, then name;
 * an unknown value sorts somewhere defined instead of throwing at render time, and the reactive
 * source is never reordered in place.
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
    it('puts an unknown rarity last rather than throwing', () => {
        // A roster edit that introduces a tier the UI has not learned yet must degrade to a
        // funny-looking grid, never to a blank page.
        expect(hqRarityRank('transcendent')).toBeGreaterThan(hqRarityRank('mythic'))
    })
})

describe('hqSortCollection', () => {
    it('applies the three keys in that priority', () => {
        const sorted = sort([
            entry('Rare tank', 'rare', 'tank'),
            entry('Common control', 'common', 'control'),
            entry('Rare damage', 'rare', 'damage'),
            entry('Common damage', 'common', 'damage')
        ])
        expect(sorted).toEqual(['Common damage', 'Common control', 'Rare damage', 'Rare tank'])
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
