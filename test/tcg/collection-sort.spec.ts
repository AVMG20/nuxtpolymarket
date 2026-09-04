/**
 * Collection gallery ordering (§10): four modes, both directions, and the
 * rule that an unknown price or serial is not a zero.
 */
import { describe, expect, it } from 'vitest'
import { sortPrintings } from '#shared/utils/tcg/collection-sort'
import type { SortablePrinting } from '#shared/utils/tcg/collection-sort'

interface Tile extends SortablePrinting {
    id: string
    price: number | null
}

function tile(id: string, fields: Partial<Tile> = {}): Tile {
    return {
        id,
        sortOrder: 0,
        finish: 'nonholo',
        pattern: null,
        rarity: 'Common',
        serialNo: null,
        price: null,
        ...fields
    }
}

const priceOf = (t: Tile) => t.price
const ids = (rows: Tile[]) => rows.map(row => row.id)

describe('sortPrintings', () => {
    it('defaults to the set order: number, then finish, then pattern', () => {
        const rows = [
            tile('c-reverse', { sortOrder: 3, finish: 'reverse' }),
            tile('a', { sortOrder: 1 }),
            tile('c-holo', { sortOrder: 3, finish: 'holo' }),
            tile('b', { sortOrder: 2 })
        ]
        expect(ids(sortPrintings(rows, 'number', 'asc'))).toEqual(['a', 'b', 'c-holo', 'c-reverse'])
        expect(ids(sortPrintings(rows, 'number', 'desc'))).toEqual(['c-reverse', 'c-holo', 'b', 'a'])
    })

    it('sorts by real-world value in both directions', () => {
        const rows = [
            tile('mid', { sortOrder: 1, price: 12.5 }),
            tile('dear', { sortOrder: 2, price: 620.52 }),
            tile('cheap', { sortOrder: 3, price: 0.4 })
        ]
        expect(ids(sortPrintings(rows, 'value', 'asc', priceOf))).toEqual(['cheap', 'mid', 'dear'])
        expect(ids(sortPrintings(rows, 'value', 'desc', priceOf))).toEqual(['dear', 'mid', 'cheap'])
    })

    // Unknown is not zero: an unpriced card (or one the sidecar could not be
    // reached for) is not the cheapest thing you own, so it sits at the end
    // whichever way the arrow points.
    it('keeps unpriced tiles last in both directions', () => {
        const rows = [
            tile('unknown', { sortOrder: 1, price: null }),
            tile('dear', { sortOrder: 2, price: 100 }),
            tile('cheap', { sortOrder: 3, price: 1 })
        ]
        expect(ids(sortPrintings(rows, 'value', 'asc', priceOf))).toEqual(['cheap', 'dear', 'unknown'])
        expect(ids(sortPrintings(rows, 'value', 'desc', priceOf))).toEqual(['dear', 'cheap', 'unknown'])
    })

    it('sorts by earliest owned serial, unserialled last', () => {
        const rows = [
            tile('late', { sortOrder: 1, serialNo: 891 }),
            tile('none', { sortOrder: 2, serialNo: null }),
            tile('early', { sortOrder: 3, serialNo: 7 })
        ]
        expect(ids(sortPrintings(rows, 'serial', 'asc'))).toEqual(['early', 'late', 'none'])
        expect(ids(sortPrintings(rows, 'serial', 'desc'))).toEqual(['late', 'early', 'none'])
    })

    it('sorts by the rarity ladder, not the label', () => {
        const rows = [
            tile('bwr', { sortOrder: 1, rarity: 'BWR' }),
            tile('common', { sortOrder: 2, rarity: 'Common' }),
            tile('ir', { sortOrder: 3, rarity: 'Illustration Rare' })
        ]
        expect(ids(sortPrintings(rows, 'rarity', 'asc'))).toEqual(['common', 'ir', 'bwr'])
        expect(ids(sortPrintings(rows, 'rarity', 'desc'))).toEqual(['bwr', 'ir', 'common'])
    })

    it('breaks every tie with the set order, so the result is stable', () => {
        const rows = [
            tile('third', { sortOrder: 3, rarity: 'Common' }),
            tile('first', { sortOrder: 1, rarity: 'Common' }),
            tile('second', { sortOrder: 2, rarity: 'Common' })
        ]
        expect(ids(sortPrintings(rows, 'rarity', 'asc'))).toEqual(['first', 'second', 'third'])
        expect(ids(sortPrintings(rows, 'value', 'asc', priceOf))).toEqual(['first', 'second', 'third'])
    })

    it('leaves the caller array untouched', () => {
        const rows = [tile('b', { sortOrder: 2 }), tile('a', { sortOrder: 1 })]
        sortPrintings(rows, 'number', 'asc')
        expect(ids(rows)).toEqual(['b', 'a'])
    })
})
