import { describe, expect, it } from 'vitest'
import { NAV_CATALOG } from '#shared/utils/nav-catalog'
import {
    NAV_FOLDER_NAME_MAX,
    NAV_LAYOUT_MAX_FOLDERS,
    NAV_LAYOUT_MAX_ITEMS,
    cleanFolderName,
    defaultNavLayout,
    locateNavEntry,
    normalizeNavLayout,
    type NavLayout
} from '#shared/utils/nav-layout'

const catalog = [
    { id: 'platform', label: 'Platform', fixed: true, items: [{ to: '/' }, { to: '/bank' }] },
    { id: 'a', label: 'Alpha', items: [{ to: '/a1' }, { to: '/a2' }, { to: '/a3' }] },
    { id: 'b', label: 'Beta', items: [{ to: '/b1' }, { to: '/b2' }] }
]

function layoutOf(partial: Partial<NavLayout>): NavLayout {
    return { version: 2, root: [], folders: {}, platformCollapsed: false, ...partial }
}

describe('default layout', () => {
    it('is stable under normalisation for the real catalog', () => {
        const layout = defaultNavLayout(NAV_CATALOG)
        expect(normalizeNavLayout(layout, NAV_CATALOG)).toEqual(layout)
        expect(layout.root).not.toContain('f-platform')
        expect(layout.root).not.toContain('f-admin')
    })
})

describe('version 1 migration', () => {
    it('never yields an empty sidebar', () => {
        const migrated = normalizeNavLayout({ sections: [], items: {}, collapsed: [] }, catalog)
        expect(migrated).toEqual(defaultNavLayout(catalog))
    })
})

describe('normalisation', () => {
    it('rejects the wrong shape', () => {
        expect(normalizeNavLayout(null, catalog)).toBeNull()
        expect(normalizeNavLayout([], catalog)).toBeNull()
        expect(normalizeNavLayout({ version: 3, root: [], folders: {} }, catalog)).toBeNull()
        expect(normalizeNavLayout({ version: 2, root: 'x', folders: {} }, catalog)).toBeNull()
        expect(normalizeNavLayout({ version: 2, root: [], folders: [] }, catalog)).toBeNull()
        expect(normalizeNavLayout({ version: 2, root: [1], folders: {} }, catalog)).toBeNull()
        expect(normalizeNavLayout({ version: 2, root: Array.from({ length: 201 }, () => '/a1'), folders: {} }, catalog)).toBeNull()
    })

    it('drops unknown and fixed links and dedupes across lists', () => {
        const layout = normalizeNavLayout({
            version: 2,
            root: ['/a1', '/', '/nope', 'f-x', '/a1', 'f-gone'],
            folders: { 'f-x': { name: 'X', collapsed: true, items: ['/a1', '/b1', '/bank', '/b1'] } }
        }, catalog)
        expect(layout).toEqual(layoutOf({
            root: ['/a1', 'f-x'],
            folders: { 'f-x': { name: 'X', collapsed: true, items: ['/b1'] } }
        }))
    })

    it('caps the number of folders', () => {
        const ids = Array.from({ length: 30 }, (_, i) => `f-${i}`)
        const layout = normalizeNavLayout({
            version: 2,
            root: ids,
            folders: Object.fromEntries(ids.map(id => [id, { name: id, items: [] }]))
        }, catalog)!
        expect(Object.keys(layout.folders)).toHaveLength(NAV_LAYOUT_MAX_FOLDERS)
        expect(layout.root).toEqual(ids.slice(0, NAV_LAYOUT_MAX_FOLDERS))
    })
})

describe('normalisation of hostile input', () => {
    const v2 = (partial: Record<string, unknown>) => ({ version: 2, root: [], folders: {}, ...partial })

    it('ignores __proto__ and constructor folder ids', () => {
        const raw = JSON.parse('{"version":2,"root":["__proto__","constructor","f-ok"],"folders":{"__proto__":{"name":"x","items":["/a1"]},"constructor":{"name":"y","items":["/a2"]},"f-ok":{"name":"Ok","items":["/a3"]}}}')
        const layout = normalizeNavLayout(raw, catalog)!
        expect(layout.root).toEqual(['f-ok'])
        expect(Object.keys(layout.folders)).toEqual(['f-ok'])
        expect(Object.getPrototypeOf(layout.folders)).toBe(Object.prototype)
        expect(locateNavEntry(layout, 'constructor')).toBeNull()
    })

    it('caps a list at the item limit', () => {
        const many = Array.from({ length: 120 }, (_, i) => ({ to: `/g${i}` }))
        const big = [{ id: 'g', label: 'G', items: many }]
        const layout = normalizeNavLayout(v2({ root: ['f-x'], folders: { 'f-x': { name: 'X', items: many.map(m => m.to) } } }), big)!
        expect(layout.folders['f-x']!.items).toHaveLength(NAV_LAYOUT_MAX_ITEMS)
        const loose = normalizeNavLayout(v2({ root: many.map(m => m.to) }), big)!
        expect(loose.root).toHaveLength(NAV_LAYOUT_MAX_ITEMS)
    })

    it('rejects oversize arrays, oversize ids and empty strings in root', () => {
        expect(normalizeNavLayout(v2({ root: Array.from({ length: 201 }, () => '/a1') }), catalog)).toBeNull()
        expect(normalizeNavLayout(v2({ root: ['/' + 'x'.repeat(80)] }), catalog)).toBeNull()
        expect(normalizeNavLayout(v2({ root: [''] }), catalog)).toBeNull()
        expect(normalizeNavLayout(v2({ root: [null] }), catalog)).toBeNull()
    })

    it('drops broken folders instead of failing', () => {
        const layout = normalizeNavLayout(v2({
            root: ['f-a', 'f-b', 'f-c', 'f-d'],
            folders: {
                'f-a': null,
                'f-b': 'folder',
                'f-c': { name: 'C', items: 'nope' },
                'f-d': { name: 'D', items: [1, null, '/a1', '', '/zzz'] },
                'Bad Id': { name: 'x', items: ['/a2'] }
            }
        }), catalog)!
        expect(layout.root).toEqual(['f-c', 'f-d'])
        expect(layout.folders['f-c']!.items).toEqual([])
        expect(layout.folders['f-d']!.items).toEqual(['/a1'])
    })

    it('cleans hostile folder names', () => {
        expect(cleanFolderName('a\u0000b\u0007c')).toBe('a b c')
        expect(cleanFolderName('\u202Eevil\u200B')).toBe('evil')
        expect(cleanFolderName('x\uD800y')).toBe('x y')
        expect(cleanFolderName('\u0000\u0000')).toBe('New folder')
        const emoji = '😀'.repeat(40)
        const cut = cleanFolderName(emoji)
        expect(Array.from(cut)).toHaveLength(NAV_FOLDER_NAME_MAX)
        expect(cut).toBe('😀'.repeat(NAV_FOLDER_NAME_MAX))
        expect(cleanFolderName('👩‍💻 dev')).toBe('👩‍💻 dev')
        // Survives a JSON round trip, which jsonb needs
        expect(JSON.parse(JSON.stringify(cut))).toBe(cut)
    })
})

