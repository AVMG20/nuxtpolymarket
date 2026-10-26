import { describe, expect, it } from 'vitest'
import { NAV_CATALOG } from '#shared/utils/nav-catalog'
import {
    NAV_FOLDER_NAME_MAX,
    NAV_LAYOUT_MAX_FOLDERS,
    NAV_LAYOUT_MAX_ITEMS,
    cleanFolderName,
    NAV_ROOT,
    createNavFolder,
    defaultNavLayout,
    deleteNavFolder,
    locateNavEntry,
    moveNavEntry,
    newNavFolderId,
    normalizeNavLayout,
    removeNavLink,
    renameNavFolder,
    setNavFolderCollapsed,
    shiftNavEntry,
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
    it('makes a folder per non-fixed section in catalog order', () => {
        expect(defaultNavLayout(catalog)).toEqual(layoutOf({
            root: ['f-a', 'f-b'],
            folders: {
                'f-a': { name: 'Alpha', collapsed: false, items: ['/a1', '/a2', '/a3'] },
                'f-b': { name: 'Beta', collapsed: false, items: ['/b1', '/b2'] }
            }
        }))
    })

    it('is stable under normalisation for the real catalog', () => {
        const layout = defaultNavLayout(NAV_CATALOG)
        expect(normalizeNavLayout(layout, NAV_CATALOG)).toEqual(layout)
        expect(layout.root).not.toContain('f-platform')
        expect(layout.root).not.toContain('f-admin')
    })
})

describe('version 1 migration', () => {
    it('keeps the saved section and link order and folds', () => {
        const migrated = normalizeNavLayout({
            sections: ['b', 'platform', 'a'],
            items: { a: ['/a3', '/a1', '/a2'], platform: ['/bank', '/'] },
            collapsed: ['a', 'platform']
        }, catalog)
        expect(migrated).toEqual(layoutOf({
            root: ['f-b', 'f-a'],
            folders: {
                'f-b': { name: 'Beta', collapsed: false, items: ['/b1', '/b2'] },
                'f-a': { name: 'Alpha', collapsed: true, items: ['/a3', '/a1', '/a2'] }
            },
            platformCollapsed: true
        }))
    })

    it('appends sections and links the old layout never saw', () => {
        const migrated = normalizeNavLayout({ sections: ['b'], items: { a: ['/a2', '/gone'] }, collapsed: [] }, catalog)
        expect(migrated?.root).toEqual(['f-b', 'f-a'])
        expect(migrated?.folders['f-a']?.items).toEqual(['/a2', '/a1', '/a3'])
    })

    it('never yields an empty sidebar', () => {
        const migrated = normalizeNavLayout({ sections: [], items: {}, collapsed: [] }, catalog)
        expect(migrated).toEqual(defaultNavLayout(catalog))
    })

    it('rejects a malformed version 1 layout', () => {
        expect(normalizeNavLayout({ sections: 'a' }, catalog)).toBeNull()
        expect(normalizeNavLayout({ sections: [1] }, catalog)).toBeNull()
        expect(normalizeNavLayout({ sections: [], items: [] }, catalog)).toBeNull()
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

    it('keeps folders missing from the top level at the end', () => {
        const layout = normalizeNavLayout({
            version: 2,
            root: ['/a1'],
            folders: { 'f-x': { name: 'X', collapsed: false, items: ['/b1'] } }
        }, catalog)
        expect(layout?.root).toEqual(['/a1', 'f-x'])
    })

    it('cleans folder names', () => {
        const layout = normalizeNavLayout({
            version: 2,
            root: ['f-a', 'f-b', 'f-c'],
            folders: {
                'f-a': { name: '   ', items: [] },
                'f-b': { name: `  My   ${'x'.repeat(50)}`, items: [] },
                'f-c': { name: 42, items: [] }
            }
        }, catalog)!
        expect(layout.folders['f-a']!.name).toBe('New folder')
        expect(layout.folders['f-b']!.name.length).toBeLessThanOrEqual(NAV_FOLDER_NAME_MAX)
        expect(layout.folders['f-b']!.name.startsWith('My x')).toBe(true)
        expect(layout.folders['f-c']!.name).toBe('New folder')
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

    it('round-trips a clean layout', () => {
        const layout = layoutOf({
            root: ['/b2', 'f-x'],
            folders: { 'f-x': { name: 'Favs', collapsed: false, items: ['/a2', '/a1'] } },
            platformCollapsed: true
        })
        expect(normalizeNavLayout(JSON.parse(JSON.stringify(layout)), catalog)).toEqual(layout)
    })
})

describe('edits', () => {
    const base = defaultNavLayout(catalog)

    it('moves a link between lists and leaves the input alone', () => {
        const next = moveNavEntry(base, '/a2', 'f-b', 1)
        expect(next.folders['f-a']!.items).toEqual(['/a1', '/a3'])
        expect(next.folders['f-b']!.items).toEqual(['/b1', '/a2', '/b2'])
        expect(base.folders['f-a']!.items).toEqual(['/a1', '/a2', '/a3'])
    })

    it('adds an unplaced link and removes it again', () => {
        const without = removeNavLink(base, '/a1')
        expect(locateNavEntry(without, '/a1')).toBeNull()
        const back = moveNavEntry(without, '/a1', NAV_ROOT, 0)
        expect(back.root).toEqual(['/a1', 'f-a', 'f-b'])
    })

    it('reorders within a list counting from the removed position', () => {
        expect(moveNavEntry(base, '/a1', 'f-a', 2).folders['f-a']!.items).toEqual(['/a2', '/a3', '/a1'])
        expect(shiftNavEntry(base, '/a2', -1).folders['f-a']!.items).toEqual(['/a2', '/a1', '/a3'])
        expect(shiftNavEntry(base, '/a1', -1)).toBe(base)
        expect(shiftNavEntry(base, 'f-a', 1).root).toEqual(['f-b', 'f-a'])
    })

    it('keeps folders at the top level', () => {
        expect(moveNavEntry(base, 'f-a', 'f-b')).toBe(base)
        expect(moveNavEntry(base, '/a1', 'f-missing')).toBe(base)
    })

    it('creates, renames, folds and deletes folders', () => {
        let next = createNavFolder(base, 'f-new', '  Faves ', ['/b2', '/a1'], 0)
        expect(next.root).toEqual(['f-new', 'f-a', 'f-b'])
        expect(next.folders['f-new']).toEqual({ name: 'Faves', collapsed: false, items: ['/b2', '/a1'] })
        expect(next.folders['f-a']!.items).toEqual(['/a2', '/a3'])
        expect(createNavFolder(next, 'f-new', 'Again')).toBe(next)

        next = renameNavFolder(next, 'f-new', 'Best')
        next = setNavFolderCollapsed(next, 'f-new', true)
        expect(next.folders['f-new']).toMatchObject({ name: 'Best', collapsed: true })

        const ungrouped = deleteNavFolder(next, 'f-new')
        expect(ungrouped.root).toEqual(['/b2', '/a1', 'f-a', 'f-b'])
        const dropped = deleteNavFolder(next, 'f-new', false)
        expect(dropped.root).toEqual(['f-a', 'f-b'])
        expect(locateNavEntry(dropped, '/b2')).toBeNull()
    })

    it('makes unique folder ids', () => {
        const layout = layoutOf({ folders: { 'f-a': { name: 'x', collapsed: false, items: [] } } })
        expect(newNavFolderId(layout, 10)).toBe('f-b')
        expect(newNavFolderId(layout, 11)).toBe('f-b')
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

    it('drops a folder id listed inside another folder', () => {
        const layout = normalizeNavLayout(v2({
            root: ['f-a', 'f-b'],
            folders: { 'f-a': { name: 'A', items: ['f-b', '/a1'] }, 'f-b': { name: 'B', items: ['/b1'] } }
        }), catalog)!
        expect(layout.root).toEqual(['f-a', 'f-b'])
        expect(layout.folders['f-a']!.items).toEqual(['/a1'])
    })

    it('keeps a folder listed twice in root once', () => {
        const layout = normalizeNavLayout(v2({ root: ['f-a', '/b1', 'f-a'], folders: { 'f-a': { name: 'A', items: ['/a1'] } } }), catalog)!
        expect(layout.root).toEqual(['f-a', '/b1'])
        expect(layout.folders['f-a']!.items).toEqual(['/a1'])
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

    it('only takes a real true for the folded flags', () => {
        const layout = normalizeNavLayout(v2({
            root: ['f-a'],
            folders: { 'f-a': { name: 'A', collapsed: 'yes', items: [] } },
            platformCollapsed: 1
        }), catalog)!
        expect(layout.platformCollapsed).toBe(false)
        expect(layout.folders['f-a']!.collapsed).toBe(false)
    })

    it('accepts an empty version 2 layout as the player\'s choice', () => {
        expect(normalizeNavLayout(v2({}), catalog)).toEqual(layoutOf({}))
    })

    it('falls back to catalog order for malformed version 1 section items', () => {
        const migrated = normalizeNavLayout({ sections: ['a', 'b'], items: { a: 'x', b: [1, 2] }, collapsed: [] }, catalog)!
        expect(migrated.folders['f-a']!.items).toEqual(['/a1', '/a2', '/a3'])
        expect(migrated.folders['f-b']!.items).toEqual(['/b1', '/b2'])
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

