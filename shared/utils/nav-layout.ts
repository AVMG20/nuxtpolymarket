/*
 * A player's sidebar: which games they keep there, in which order, grouped
 * into folders they name themselves. The fixed sections of the catalog
 * (platform, admin) are always shown and never part of the layout.
 *
 * `root` is the top level, in order: game routes ('/xeno') and folder ids
 * ('f-…'). Each folder holds its own ordered list of routes. A route lives in
 * at most one place. Anything the catalog doesn't offer is dropped.
 *
 * Version 1 layouts ({ sections, items, collapsed }) only reordered the
 * catalog; they migrate to one folder per catalog section in the same order.
 */

export interface NavFolder {
    name: string
    collapsed: boolean
    items: string[]
}

export interface NavLayout {
    version: 2
    root: string[]
    folders: Record<string, NavFolder>
    /** The fixed platform section is folded shut */
    platformCollapsed: boolean
}

export interface NavCatalogSection<T extends { to: string } = { to: string }> {
    id: string
    label: string
    items: T[]
    fixed?: boolean
}

/** A list in the layout: the top level, or a folder by id */
export type NavListId = 'root' | string

export const NAV_ROOT = 'root'
export const NAV_LAYOUT_MAX_FOLDERS = 20
export const NAV_LAYOUT_MAX_ITEMS = 80
export const NAV_FOLDER_NAME_MAX = 32
export const NAV_FOLDER_DEFAULT_NAME = 'New folder'
// Bounds the work done on untrusted input before anything is filtered
const MAX_RAW_ENTRIES = 200
const MAX_ID_LENGTH = 64
const FOLDER_ID = /^f-[a-z0-9-]{1,40}$/

export function isNavFolderId(id: string): boolean {
    return FOLDER_ID.test(id)
}

/** Folder id used for a catalog section's folder */
export function sectionFolderId(sectionId: string): string {
    return `f-${sectionId}`
}

/** Routes the player can place: every link outside the fixed sections */
export function customizableRoutes(catalog: NavCatalogSection[]): Set<string> {
    const routes = new Set<string>()
    for (const section of catalog) {
        if (section.fixed) continue
        for (const item of section.items) routes.add(item.to)
    }
    return routes
}

/** A safe display name: no control or format characters (NUL, bidi marks, lone
 *  surrogates), collapsed whitespace, at most NAV_FOLDER_NAME_MAX code points. */
export function cleanFolderName(name: unknown): string {
    if (typeof name !== 'string') return NAV_FOLDER_DEFAULT_NAME
    const clean = name
        .slice(0, NAV_FOLDER_NAME_MAX * 8)
        .replace(/[\p{Cc}\p{Cs}]/gu, ' ')
        // Format characters (bidi overrides, zero-width marks) go, except the joiner inside emoji
        .replace(/(?!\u200D)\p{Cf}/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
    return Array.from(clean).slice(0, NAV_FOLDER_NAME_MAX).join('').trim() || NAV_FOLDER_DEFAULT_NAME
}

/** The layout a player starts with: one folder per catalog section. */
export function defaultNavLayout(catalog: NavCatalogSection[]): NavLayout {
    const layout: NavLayout = { version: 2, root: [], folders: {}, platformCollapsed: false }
    for (const section of catalog) {
        if (section.fixed || !section.items.length) continue
        const id = sectionFolderId(section.id)
        layout.root.push(id)
        layout.folders[id] = { name: cleanFolderName(section.label), collapsed: false, items: section.items.map(item => item.to) }
    }
    return layout
}

function stringList(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length > MAX_RAW_ENTRIES) return null
    for (const id of value) {
        if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH) return null
    }
    return value as string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function orderBy<T>(list: T[], order: string[] | undefined, key: (entry: T) => string): T[] {
    if (!order?.length) return [...list]
    const rank = new Map(order.map((id, i) => [id, i]))
    return list
        .map((entry, i) => ({ entry, i, r: rank.get(key(entry)) }))
        .sort((a, b) => {
            if (a.r !== undefined && b.r !== undefined) return a.r - b.r
            if (a.r !== undefined) return -1
            if (b.r !== undefined) return 1
            return a.i - b.i
        })
        .map(({ entry }) => entry)
}

/** Converts a version 1 layout: the catalog sections in the saved order,
 *  each as a folder holding its links in the saved order. */
function migrateV1(raw: Record<string, unknown>, catalog: NavCatalogSection[]): NavLayout | null {
    const sections = stringList(raw.sections)
    const collapsed = stringList(raw.collapsed ?? [])
    if (!sections || !collapsed) return null
    const rawItems = raw.items ?? {}
    if (!isRecord(rawItems)) return null

    const folded = new Set(collapsed)
    const layout: NavLayout = { version: 2, root: [], folders: {}, platformCollapsed: folded.has('platform') }
    for (const section of orderBy(catalog, sections, s => s.id)) {
        if (section.fixed || !section.items.length) continue
        const order = stringList(rawItems[section.id]) ?? undefined
        const id = sectionFolderId(section.id)
        layout.root.push(id)
        layout.folders[id] = {
            name: cleanFolderName(section.label),
            collapsed: folded.has(section.id),
            items: orderBy(section.items, order, item => item.to).map(item => item.to)
        }
    }
    return layout
}

/**
 * Validates and cleans an untrusted layout of either version. Returns null
 * when the top-level shape is wrong; otherwise drops unknown links and broken
 * folders, dedupes routes and folders (first place wins), caps folders and
 * items and tidies folder names.
 */
export function normalizeNavLayout(value: unknown, catalog: NavCatalogSection[]): NavLayout | null {
    if (!isRecord(value)) return null
    if (value.version === undefined && 'sections' in value) return migrateV1(value, catalog)
    if (value.version !== 2) return null

    const root = stringList(value.root)
    if (!root || !isRecord(value.folders)) return null
    const rawFolders = Object.entries(value.folders)
    if (rawFolders.length > MAX_RAW_ENTRIES) return null

    // Broken folders are dropped rather than failing the whole layout
    const folders = new Map<string, { name: unknown, collapsed: boolean, items: string[] }>()
    for (const [id, folder] of rawFolders) {
        if (!isNavFolderId(id) || !isRecord(folder)) continue
        const items = Array.isArray(folder.items)
            ? folder.items.slice(0, MAX_RAW_ENTRIES).filter((to): to is string => typeof to === 'string')
            : []
        folders.set(id, { name: folder.name, collapsed: folder.collapsed === true, items })
    }

    const allowed = customizableRoutes(catalog)
    const placed = new Set<string>()
    const outRoot: string[] = []
    const outFolders = new Map<string, NavFolder>()

    function take(list: string[]): string[] {
        const kept: string[] = []
        for (const to of list) {
            if (kept.length >= NAV_LAYOUT_MAX_ITEMS) break
            if (!allowed.has(to) || placed.has(to)) continue
            placed.add(to)
            kept.push(to)
        }
        return kept
    }

    function addFolder(id: string) {
        const folder = folders.get(id)
        if (!folder || outFolders.has(id) || outRoot.length >= NAV_LAYOUT_MAX_ITEMS) return
        if (outFolders.size >= NAV_LAYOUT_MAX_FOLDERS) return
        outRoot.push(id)
        outFolders.set(id, { name: cleanFolderName(folder.name), collapsed: folder.collapsed, items: take(folder.items) })
    }

    for (const entry of root) {
        if (isNavFolderId(entry)) addFolder(entry)
        else if (outRoot.length < NAV_LAYOUT_MAX_ITEMS) outRoot.push(...take([entry]))
    }
    // Folders missing from the top level are kept at the end, not lost
    for (const id of folders.keys()) addFolder(id)

    return {
        version: 2,
        root: outRoot,
        folders: Object.fromEntries(outFolders),
        platformCollapsed: value.platformCollapsed === true
    }
}

// ── Edits ───────────────────────────────────────────────────────────────────
// Each returns a new layout and leaves the input untouched.

function clone(layout: NavLayout): NavLayout {
    return {
        version: 2,
        root: [...layout.root],
        folders: Object.fromEntries(Object.entries(layout.folders).map(([id, f]) => [id, { ...f, items: [...f.items] }])),
        platformCollapsed: layout.platformCollapsed
    }
}

/** A folder by id, ignoring anything inherited from Object.prototype */
export function navFolder(layout: NavLayout, id: string): NavFolder | undefined {
    return isNavFolderId(id) && Object.hasOwn(layout.folders, id) ? layout.folders[id] : undefined
}

function listOf(layout: NavLayout, list: NavListId): string[] | undefined {
    return list === NAV_ROOT ? layout.root : navFolder(layout, list)?.items
}

/** Where a route or folder sits, or null when it isn't in the layout */
export function locateNavEntry(layout: NavLayout, key: string): { list: NavListId, index: number } | null {
    const top = layout.root.indexOf(key)
    if (top >= 0) return { list: NAV_ROOT, index: top }
    for (const [id, folder] of Object.entries(layout.folders)) {
        const index = folder.items.indexOf(key)
        if (index >= 0) return { list: id, index }
    }
    return null
}

export function isNavPinned(layout: NavLayout, to: string): boolean {
    return locateNavEntry(layout, to) !== null
}

/**
 * Puts a route or folder at `index` of `list` (the end when omitted), taking
 * it out of wherever it was. `index` counts positions with the entry already
 * removed. Folders only live at the top level; a route only goes into a
 * folder that exists.
 */
export function moveNavEntry(layout: NavLayout, key: string, list: NavListId, index?: number): NavLayout {
    const next = clone(layout)
    const isFolder = isNavFolderId(key)
    if (isFolder && (list !== NAV_ROOT || !navFolder(next, key))) return layout
    const target = listOf(next, list)
    if (!target) return layout

    const from = locateNavEntry(next, key)
    if (from) listOf(next, from.list)!.splice(from.index, 1)
    if (target.length >= NAV_LAYOUT_MAX_ITEMS) return layout
    const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length))
    target.splice(at, 0, key)
    return next
}

/** Moves an entry one step up (-1) or down (1) within its own list */
export function shiftNavEntry(layout: NavLayout, key: string, delta: -1 | 1): NavLayout {
    const at = locateNavEntry(layout, key)
    if (!at) return layout
    const index = at.index + delta
    if (index < 0 || index >= listOf(layout, at.list)!.length) return layout
    return moveNavEntry(layout, key, at.list, index)
}

export function removeNavLink(layout: NavLayout, to: string): NavLayout {
    const at = locateNavEntry(layout, to)
    if (!at || isNavFolderId(to)) return layout
    const next = clone(layout)
    listOf(next, at.list)!.splice(at.index, 1)
    return next
}

/** Adds a folder (at `index` of the top level, the end by default) holding `items`. */
export function createNavFolder(
    layout: NavLayout,
    id: string,
    name: string,
    items: string[] = [],
    index?: number
): NavLayout {
    if (!isNavFolderId(id) || navFolder(layout, id)) return layout
    if (Object.keys(layout.folders).length >= NAV_LAYOUT_MAX_FOLDERS) return layout
    let next = clone(layout)
    next.folders[id] = { name: cleanFolderName(name), collapsed: false, items: [] }
    next.root.splice(index === undefined ? next.root.length : Math.max(0, Math.min(index, next.root.length)), 0, id)
    for (const to of items) next = moveNavEntry(next, to, id)
    return next
}

export function renameNavFolder(layout: NavLayout, id: string, name: string): NavLayout {
    if (!navFolder(layout, id)) return layout
    const next = clone(layout)
    next.folders[id]!.name = cleanFolderName(name)
    return next
}

export function setNavFolderCollapsed(layout: NavLayout, id: string, collapsed: boolean): NavLayout {
    if (!navFolder(layout, id)) return layout
    const next = clone(layout)
    next.folders[id]!.collapsed = collapsed
    return next
}

/** Removes a folder. Its games move to the top level in its place, or leave
 *  the sidebar with it when `keepItems` is false. */
export function deleteNavFolder(layout: NavLayout, id: string, keepItems = true): NavLayout {
    const folder = navFolder(layout, id)
    if (!folder) return layout
    const next = clone(layout)
    const at = next.root.indexOf(id)
    next.root.splice(at, 1, ...(keepItems ? folder.items : []))
    next.folders = Object.fromEntries(Object.entries(next.folders).filter(([key]) => key !== id))
    return next
}

export function newNavFolderId(layout: NavLayout, seed: number = Date.now()): string {
    let n = seed
    let id = `f-${n.toString(36)}`
    while (navFolder(layout, id)) id = `f-${(++n).toString(36)}`
    return id
}
