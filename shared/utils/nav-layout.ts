/*
 * A player's sidebar arrangement: the order of the sections, the order of the
 * links inside each section, and which sections are folded shut. Items are
 * keyed by route, sections by id. The layout only ever reorders what the
 * catalog offers: unknown ids are dropped and links added since the layout
 * was saved slot in at the end of their section.
 */

export interface NavLayout {
    sections: string[]
    items: Record<string, string[]>
    collapsed: string[]
}

export interface NavCatalogSection<T extends { to: string } = { to: string }> {
    id: string
    items: T[]
}

export const NAV_LAYOUT_MAX_SECTIONS = 20
export const NAV_LAYOUT_MAX_ITEMS = 60
const MAX_ID_LENGTH = 64

function idList(value: unknown, max: number): string[] | null {
    if (!Array.isArray(value) || value.length > max) return null
    const seen = new Set<string>()
    for (const id of value) {
        if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH) return null
        seen.add(id)
    }
    return [...seen]
}

/** Validates an untrusted layout. Returns null when the shape is wrong. */
export function parseNavLayout(value: unknown): NavLayout | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const raw = value as Record<string, unknown>

    const sections = idList(raw.sections, NAV_LAYOUT_MAX_SECTIONS)
    const collapsed = idList(raw.collapsed ?? [], NAV_LAYOUT_MAX_SECTIONS)
    if (!sections || !collapsed) return null

    const rawItems = raw.items ?? {}
    if (!rawItems || typeof rawItems !== 'object' || Array.isArray(rawItems)) return null
    const entries = Object.entries(rawItems as Record<string, unknown>)
    if (entries.length > NAV_LAYOUT_MAX_SECTIONS) return null

    const items: Record<string, string[]> = {}
    for (const [sectionId, list] of entries) {
        if (!sectionId || sectionId.length > MAX_ID_LENGTH) return null
        const ids = idList(list, NAV_LAYOUT_MAX_ITEMS)
        if (!ids) return null
        items[sectionId] = ids
    }

    return { sections, items, collapsed }
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

/** Orders the catalog by the saved layout. The catalog is never mutated. */
export function applyNavLayout<S extends NavCatalogSection>(
    catalog: S[],
    layout: NavLayout | null | undefined
): S[] {
    return orderBy(catalog, layout?.sections, section => section.id).map(section => ({
        ...section,
        items: orderBy(section.items, layout?.items[section.id], item => item.to)
    }))
}

/** Snapshot of an arranged catalog, ready to save. */
export function navLayoutOf(
    sections: NavCatalogSection[],
    collapsed: string[]
): NavLayout {
    const ids = new Set(sections.map(section => section.id))
    return {
        sections: sections.map(section => section.id),
        items: Object.fromEntries(sections.map(section => [section.id, section.items.map(item => item.to)])),
        collapsed: collapsed.filter(id => ids.has(id))
    }
}
