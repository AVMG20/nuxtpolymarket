import { edgeTile, edgeTiles, FIELD_EDGES, gateAcross, FIELD_MAX, FIELD_MAX_ITEMS, FIELD_TILE, defaultFieldPlan, isBlocking, tileMap, type FieldDir, type FieldPlan, type FieldPort, type FieldTile } from './field'
import type { CustomBranch, SectionId, SectionSpot } from './custom'

/** How a player's course stores its fields, and the checks a stored one has to pass. */

/** A field section's size and tiles, by the spot of its section. */
export interface CustomField extends FieldPlan {
    at: SectionSpot
}

/** A spot a branch leaves from: a split, or a field and the mouth on its edge it leaves through. */
export interface FieldSpot extends SectionSpot {
    port?: FieldPort
}

/** Field items that count as one section toward the course's cap, so a crowded field can't dodge it. */
export const FIELD_ITEMS_PER_SECTION = 4

/** What a course's field items add to its section count. */
export const fieldItemsCost = (fields: readonly CustomField[] | undefined) => (fields ?? []).reduce((n, f) => n + Math.ceil(f.tiles.length / FIELD_ITEMS_PER_SECTION), 0)

const TILE_KINDS: readonly FieldTile['kind'][] = ['boost', 'checkpoint', 'block', 'pillar']
const isCount = (v: unknown, max = Infinity): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < max

/** A stored mouth, its tile still to be checked against its field's size; null if it isn't one. */
export function sanitizePort(raw: unknown): FieldPort | null {
    if (!raw || typeof raw !== 'object') return null
    const { edge, tile } = raw as Record<string, unknown>
    return FIELD_EDGES.includes(edge as FieldPort['edge']) && isCount(tile) ? { edge: edge as FieldPort['edge'], tile: tile as number } : null
}

const onGrid = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= FIELD_TILE && (v as number) <= FIELD_MAX && (v as number) % FIELD_TILE === 0

/** A stored field's tiles inside its grid, one item each, in row order so equal fields store alike; null if any isn't one. */
function sanitizeTiles(raw: unknown, cols: number, rows: number): FieldTile[] | null {
    if (raw === undefined) return []
    if (!Array.isArray(raw) || raw.length > FIELD_MAX_ITEMS) return null
    const out: FieldTile[] = []
    for (const t of raw) {
        if (!t || typeof t !== 'object') return null
        const { col, row, kind, dir } = t as Record<string, unknown>
        if (!isCount(col, cols) || !isCount(row, rows) || !TILE_KINDS.includes(kind as FieldTile['kind'])) return null
        if (out.some(o => o.col === col && o.row === row)) return null
        if (kind === 'block' || kind === 'pillar') out.push({ col, row, kind })
        else if (isCount(dir, 4)) out.push({ col, row, kind: kind as 'boost' | 'checkpoint', dir: dir as FieldDir })
        else return null
    }
    return out.sort((a, b) => a.row - b.row || a.col - b.col)
}

/** Whether a field's mouths fit on its edges: not off them, a tile apart or more on one edge, never onto a blocked tile, nor a gate whose posts stand across it. */
export function mouthsFit(plan: FieldPlan, mouths: readonly FieldPort[]): boolean {
    const map = tileMap(plan)
    const cols = plan.width / FIELD_TILE
    return mouths.every((m, i) => {
        if (m.tile >= edgeTiles(plan, m.edge)) return false
        // A road with its walls is wider than a tile, so mouths on neighbouring tiles would overlap.
        if (mouths.slice(i + 1).some(o => o.edge === m.edge && Math.abs(o.tile - m.tile) <= 1)) return false
        const { col, row } = edgeTile(plan, m)
        const tile = map.get(col + row * cols)
        return !isBlocking(tile?.kind) && !gateAcross(tile, m.edge)
    })
}

/** A stored course's fields, one per field section in course order with missing ones at the default size; null if any doesn't fit. */
export function sanitizeFields(raw: unknown, lines: readonly (readonly SectionId[])[], branches: readonly CustomBranch[]): CustomField[] | null {
    if (raw === undefined || raw === null) raw = []
    if (!Array.isArray(raw)) return null
    const stored = new Map<string, unknown>()
    for (const f of raw) {
        const at = f && typeof f === 'object' ? (f as Record<string, unknown>).at : null
        const { branch, at: k } = (at && typeof at === 'object' ? at : {}) as Record<string, unknown>
        if (!isCount(branch, lines.length) || !isCount(k) || lines[branch]![k] !== 'field') return null
        const key = `${branch}:${k}`
        if (stored.has(key)) return null
        stored.set(key, f)
    }
    const out: CustomField[] = []
    for (const [line, sections] of lines.entries()) {
        for (const [k, id] of sections.entries()) {
            if (id !== 'field') continue
            const at = { branch: line, at: k }
            const f = stored.get(`${line}:${k}`)
            const plan = f === undefined ? defaultFieldPlan() : sanitizePlan(f)
            if (!plan) return null
            const ports = branches.flatMap(b => b.from.port && b.from.branch === line && b.from.at === k ? [b.from.port] : [])
            if (!mouthsFit(plan, [{ edge: 'entry', tile: plan.entry }, plan.exit, ...ports])) return null
            out.push({ at, ...plan })
        }
    }
    return out
}

/** A stored field's plan, or null if it isn't one. */
function sanitizePlan(raw: unknown): FieldPlan | null {
    const { width, length, entry, exit, tiles } = raw as Record<string, unknown>
    if (!onGrid(width) || !onGrid(length) || !isCount(entry, width / FIELD_TILE)) return null
    const port = sanitizePort(exit)
    const items = sanitizeTiles(tiles, width / FIELD_TILE, length / FIELD_TILE)
    return port && items ? { width, length, entry, exit: port, tiles: items } : null
}
