import { describe, expect, it } from 'vitest'
import { applyNavLayout, navLayoutOf, parseNavLayout } from '#shared/utils/nav-layout'

const catalog = [
    { id: 'a', items: [{ to: '/a1' }, { to: '/a2' }, { to: '/a3' }] },
    { id: 'b', items: [{ to: '/b1' }, { to: '/b2' }] }
]

describe('nav layout', () => {
    it('keeps the catalog order without a layout', () => {
        expect(applyNavLayout(catalog, null)).toEqual(catalog)
    })

    it('reorders sections and items', () => {
        const ordered = applyNavLayout(catalog, {
            sections: ['b', 'a'],
            items: { a: ['/a3', '/a1', '/a2'] },
            collapsed: []
        })
        expect(ordered.map(s => s.id)).toEqual(['b', 'a'])
        expect(ordered[1]!.items.map(i => i.to)).toEqual(['/a3', '/a1', '/a2'])
        expect(ordered[0]!.items.map(i => i.to)).toEqual(['/b1', '/b2'])
    })

    it('drops unknown ids and appends new links at the end', () => {
        const ordered = applyNavLayout(catalog, {
            sections: ['gone', 'b'],
            items: { a: ['/a2', '/removed'] },
            collapsed: []
        })
        expect(ordered.map(s => s.id)).toEqual(['b', 'a'])
        expect(ordered[1]!.items.map(i => i.to)).toEqual(['/a2', '/a1', '/a3'])
    })

    it('round-trips through navLayoutOf', () => {
        const layout = navLayoutOf(catalog, ['b', 'gone'])
        expect(layout).toEqual({
            sections: ['a', 'b'],
            items: { a: ['/a1', '/a2', '/a3'], b: ['/b1', '/b2'] },
            collapsed: ['b']
        })
        expect(parseNavLayout(layout)).toEqual(layout)
    })

    it('rejects malformed layouts', () => {
        expect(parseNavLayout(null)).toBeNull()
        expect(parseNavLayout({ sections: 'a' })).toBeNull()
        expect(parseNavLayout({ sections: [1] })).toBeNull()
        expect(parseNavLayout({ sections: [], items: { a: [{}] } })).toBeNull()
        expect(parseNavLayout({ sections: ['x'.repeat(65)] })).toBeNull()
        expect(parseNavLayout({ sections: Array.from({ length: 21 }, (_, i) => `s${i}`) })).toBeNull()
    })

    it('dedupes ids', () => {
        expect(parseNavLayout({ sections: ['a', 'a'], items: {}, collapsed: [] })?.sections).toEqual(['a'])
    })
})
