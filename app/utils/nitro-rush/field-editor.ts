import type { SectionSpot } from '#shared/utils/nitro-rush/custom'
import type { GrowEdge } from '#shared/utils/nitro-rush/field-edit'
import { edgeLength, edgePoint, edgeTiles, FIELD_EDGES, FIELD_TILE, fieldLocal, fieldPoint, portLocal, type FieldDir, type FieldEdge, type FieldPort, type FieldTileKind } from '#shared/utils/nitro-rush/field'
import { inFrame, insideField, quarterTurns, type WalkedFieldSection } from '#shared/utils/nitro-rush/field-group'

/** The field editor's picture: fields joined edge to edge, from above in the first one's frame with its entry at the bottom; x runs right and y down, in metres. */

const T = FIELD_TILE
const GROW_EDGES: readonly GrowEdge[] = ['exit', 'left', 'right']
/** A field's own (u, v) step, and the picture's step, per quarter turn out of an edge. */
const FIELD_STEP: readonly [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]
const PICTURE_STEP: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]

export interface FieldEditorPicture {
    width: number
    height: number
    /** Room round the fields for edge slots and grow buttons. */
    margin: number
    /** How much the marks round the fields (slots, labels, lines) scale, so they read alike on a small field and a big group. */
    unit: number
    slot: number
    font: number
    floors: { key: string, x: number, y: number, width: number, height: number, selected: boolean, cols: number[], rows: number[] }[]
    items: { key: string, kind: FieldTileKind, x: number, y: number, turn: number }[]
    slots: { edge: FieldEdge, tile: number, x: number, y: number, width: number, height: number, label: string, taken: boolean }[]
    grow: { edge: GrowEdge, x: number, y: number, radius: number }[]
    arrivals: { line: number, x: number, y: number }[]
}

/** A tile under the pointer: its field, and the way a new pad or gate faces there to point up the picture. */
export interface PictureTile {
    spot: SectionSpot
    col: number
    row: number
    facing: FieldDir
}

/** The picture's corner in the first field's (u, v): its leftmost u and topmost v. */
function frameOf(group: readonly WalkedFieldSection[]) {
    const base = group[0]!
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (const f of group) {
        for (const [u, v] of [[0, 0], [f.plan.width, f.plan.length]] as const) {
            const p = inFrame(base, f, u, v)
            u0 = Math.min(u0, p.u)
            u1 = Math.max(u1, p.u)
            v0 = Math.min(v0, p.v)
            v1 = Math.max(v1, p.v)
        }
    }
    return { base, u0, v1, width: u1 - u0, height: v1 - v0 }
}

/** Whether (u, v) just off field `f` lies on another field of the group: a stretch of edge they share. */
function covered(group: readonly WalkedFieldSection[], f: WalkedFieldSection, u: number, v: number) {
    const [x, z] = fieldPoint(f, u, v)
    return group.some(g => g !== f && insideField(g, x, z))
}

/**
 * The group drawn round its `selected` field, which alone shows its edge slots, and its grow buttons when it `grows`;
 * `ports` label the roads leaving it, and `arrivals` are where roads drive into the group, in the world.
 */
export function fieldEditorPicture(
    group: readonly WalkedFieldSection[],
    selected: number,
    ports: readonly { line: number, port: FieldPort }[],
    arrivals: readonly { line: number, x: number, z: number }[],
    grows = true
): FieldEditorPicture {
    const { base, u0, v1, width, height } = frameOf(group)
    const at = (f: WalkedFieldSection, u: number, v: number) => {
        const p = inFrame(base, f, u, v)
        return { x: p.u - u0, y: v1 - p.v }
    }
    const unit = Math.max(1, Math.max(width, height) / 160)
    const slot = 8 * unit
    const gap = unit
    const radius = 5 * unit

    const floors = group.map((f, i) => {
        const a = at(f, 0, 0)
        const b = at(f, f.plan.width, f.plan.length)
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        const w = Math.abs(b.x - a.x)
        const h = Math.abs(b.y - a.y)
        const lines = (from: number, span: number) => Array.from({ length: Math.round(span / T) - 1 }, (_, k) => from + (k + 1) * T)
        return { key: `${f.spot.branch}:${f.spot.at}`, x, y, width: w, height: h, selected: i === selected, cols: lines(x, w), rows: lines(y, h) }
    })

    const items = group.flatMap((f) => {
        const q = quarterTurns(base, f)
        return f.plan.tiles.map((t) => {
            const { x, y } = at(f, (t.col + 0.5) * T, (t.row + 0.5) * T)
            return { key: `${f.spot.branch}:${f.spot.at}:${t.col},${t.row}`, kind: t.kind, x, y, turn: 'dir' in t ? ((t.dir + q) % 4) * 90 : 0 }
        })
    })

    const f = group[selected]!
    const q = quarterTurns(base, f)
    /** A point `out` metres off edge point (u, v) of `f`, heading out of it on `dir`: in the picture, or null when another field covers it. */
    const outside = (u: number, v: number, dir: FieldDir, out: number) => {
        const [du, dv] = FIELD_STEP[dir]!
        if (covered(group, f, u + du, v + dv)) return null
        const p = at(f, u, v)
        const [sx, sy] = PICTURE_STEP[(dir + q) % 4]!
        return { x: p.x + sx * out, y: p.y + sy * out, across: sy !== 0 }
    }

    const slots = FIELD_EDGES.flatMap(edge => Array.from({ length: edgeTiles(f.plan, edge) }, (_, tile) => {
        const { u, v, dir } = portLocal(f.plan, { edge, tile })
        const p = outside(u, v, dir, slot / 2 + gap)
        if (!p) return []
        const isEntry = edge === 'entry' && tile === f.plan.entry
        const isExit = f.plan.exit.edge === edge && f.plan.exit.tile === tile
        const port = ports.find(o => o.port.edge === edge && o.port.tile === tile)
        const label = isEntry ? 'IN' : isExit ? 'OUT' : port ? `${port.line}` : ''
        const along = T - 4
        return [{ edge, tile, x: p.x, y: p.y, width: p.across ? along : slot, height: p.across ? slot : along, label, taken: !!label }]
    })).flat()

    const grow = !grows ? [] : GROW_EDGES.flatMap((edge) => {
        const { u, v, dir } = edgePoint(f.plan, edge, edgeLength(f.plan, edge) / 2)
        const p = outside(u, v, dir, gap * 2 + slot + radius)
        return p ? [{ edge, x: p.x, y: p.y, radius }] : []
    })

    const shown = arrivals.map(({ line, x, z }) => {
        const p = fieldLocal(base, x, z)
        return { line, x: p.u - u0, y: v1 - p.v }
    })

    return { width, height, margin: gap * 3 + slot + radius * 2, unit, slot, font: Math.min(5 * unit, 7), floors, items, slots, grow, arrivals: shown }
}

/** The tile at picture point (x, y), or null off every field. */
export function pictureTile(group: readonly WalkedFieldSection[], x: number, y: number): PictureTile | null {
    const { base, u0, v1 } = frameOf(group)
    const [wx, wz] = fieldPoint(base, x + u0, v1 - y)
    for (const f of group) {
        const { u, v } = fieldLocal(f, wx, wz)
        if (u < 0 || v < 0 || u >= f.plan.width || v >= f.plan.length) continue
        return { spot: f.spot, col: Math.floor(u / T), row: Math.floor(v / T), facing: ((4 - quarterTurns(base, f)) % 4) as FieldDir }
    }
    return null
}
