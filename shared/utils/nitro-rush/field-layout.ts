import { alongEdge, edgeAt, fieldLineTile, fieldLocal, fieldAxes, fieldsOverlap, groupWalledOffFault, mouthTiles, openingsFault, walledOffFault, type FieldDef, type FieldPlacement } from './field'
import type { LayoutWalk, Pose } from './layout'
import { MIN_CLEARANCE } from './road-checks'
import { wallFoot } from './track-line'

/** How fields come out of a layout's walks into a built course: their mouths, and the checks on how roads meet them. */

/** A field on a walked line: laid there (`cross`), or driven out of (`port`) or into (`in`) from another line. */
export interface WalkField {
    id: number
    kind: 'cross' | 'port' | 'in'
    /** Where it sits; null on a road into it, which only knows its hub. */
    placement: FieldPlacement | null
    /** The piece that drives it. */
    piece: number
    /** Points [from, to) that lie on the field. */
    from: number
    to: number
    hub: number
    /** Points where the line crosses the field's edge. */
    mouths: number[]
}

/** Metres off the edge, and up or down, a road's mouth may sit and still meet its field. */
const MOUTH_TOLERANCE = 0.05

type Fail = (why: string) => never

/** Where point `m` of walk `w` meets `def`'s edge, or why it doesn't. */
function meetEdge(def: FieldDef, w: LayoutWalk, m: number) {
    const [x, z] = w.pts[m] ?? [w.end.x, w.end.z]
    const { u, v } = fieldLocal(def, x, z)
    const on = edgeAt(def.plan, u, v, MOUTH_TOLERANCE)
    if (!on) return 'a road meets a field off its edge'
    if (Math.abs((w.ys[m] ?? w.end.y) - def.y) > MOUTH_TOLERANCE) return 'a road meets a field at the wrong height'
    return { edge: on.edge, at: on.at, half: w.walls[m] ?? w.end.halfWidth, halfWidth: w.halfWidths[m] ?? w.end.halfWidth }
}

/** Each field laid across one of `walks`, by id, sitting on its line at `home`'s distance. */
function crossedFields(walks: readonly LayoutWalk[], home: (line: number, point: number) => { branch: number, at: number }) {
    const out = new Map<number, FieldDef>()
    walks.forEach((w, l) => {
        for (const f of w.fields) {
            if (f.kind !== 'cross' || !f.placement || out.has(f.id)) continue
            const { x, z, heading, plan } = f.placement
            out.set(f.id, { x, z, heading, plan, y: w.ys[f.hub] ?? w.end.y, home: home(l, f.hub), mouths: [] })
        }
    })
    return out
}

/** Every field of a built layout, by id, with the mouths every line makes in it; `lineS` gives a point's distance along each line. An `arena`'s fields have none. */
export function fieldDefs(walks: readonly LayoutWalk[], lineS: readonly ((at: number) => number)[], fail: Fail, arena = false): FieldDef[] {
    const defs: FieldDef[] = []
    for (const w of walks) {
        for (const f of w.fields) if (f.kind === 'cross' && (defs[f.id] || !f.placement)) fail('a field is laid twice')
    }
    for (const [id, def] of crossedFields(walks, (l, at) => ({ branch: l, at: lineS[l]!(at) }))) defs[id] = def
    // Spread, as a sparse array's `some` skips its holes.
    if ([...defs].some(d => !d)) fail('a field is missing')
    if (arena) {
        const from = defs.findIndex(d => fieldLineTile(d.plan, 'start'))
        const fault = groupWalledOffFault(defs, { field: from, ...fieldLineTile(defs[from]!.plan, 'start')! })
        if (fault) fail(fault)
        return defs
    }
    const halves: number[][] = defs.map(() => [])
    walks.forEach((w, l) => {
        for (const f of w.fields) {
            const def = defs[f.id]
            if (!def) return fail('a road leads to a missing field')
            for (const m of f.mouths) {
                const meet = meetEdge(def, w, m)
                if (typeof meet === 'string') return fail(meet)
                def.mouths.push({ branch: l, s: lineS[l]!(m), edge: meet.edge, at: meet.at, half: meet.half })
                halves[f.id]!.push(meet.halfWidth)
            }
        }
    })
    defs.forEach((def, i) => {
        const fault = openingsFault(def.plan, def.mouths, halves[i]!) ?? walledOffFault(def.plan, def.mouths.flatMap(m => mouthTiles(def.plan, m.edge, m.at)))
        if (fault) fail(fault)
    })
    return defs
}

/** The fields laid so far on lines still being built, to draw; unlike a finished course, nothing here fails. */
export function draftFieldDefs(walks: readonly LayoutWalk[], at: (line: number, point: number) => { branch: number, s: number }) {
    const crossed = crossedFields(walks, (l, k) => {
        const { branch, s } = at(l, k)
        return { branch, at: s }
    })
    const ids = new Map([...crossed.keys()].map((id, i) => [id, i]))
    const defs = [...crossed.values()]
    walks.forEach((w, l) => {
        for (const f of w.fields) {
            const def = crossed.get(f.id)
            if (!def) continue
            for (const m of f.mouths) {
                const meet = meetEdge(def, w, m)
                if (typeof meet !== 'string') def.mouths.push({ ...at(l, m), edge: meet.edge, at: meet.at, half: meet.half })
            }
        }
    })
    return { defs, ids }
}

/** How far a road ending at `end` runs straight on to come square into the field at `placement`, or why it can't. */
export function fieldApproach(end: Pose, placement: FieldPlacement): { run: number } | { why: string } {
    const { fx, fz, rx, rz } = fieldAxes(placement.heading)
    const dx = Math.sin(end.heading)
    const dz = -Math.cos(end.heading)
    const du = dx * rx + dz * rz
    const dv = dx * fx + dz * fz
    const { u, v } = fieldLocal(placement, end.x, end.z)
    const { width: w, length: l } = placement.plan
    const square = (a: number) => Math.abs(Math.abs(a) - 1) < 1e-6
    const inside = (a: number, n: number) => a > MOUTH_TOLERANCE && a < n - MOUTH_TOLERANCE
    if (!square(dv) && !square(du)) return { why: 'must meet the field straight on' }
    if (square(dv) ? !inside(u, w) : !inside(v, l)) return { why: 'misses the field' }
    const run = square(dv) ? (dv > 0 ? -v : v - l) : (du > 0 ? -u : u - w)
    if (run < -MOUTH_TOLERANCE) return { why: 'ends inside the field' }
    return { run: Math.max(0, Math.round(run * 1000) / 1000) }
}

/** How far a road ending at `end` runs straight on into the field at `placement`, or null when it can't. */
export function fieldRunIn(end: Pose, placement: FieldPlacement): number | null {
    const a = fieldApproach(end, placement)
    return 'run' in a ? a.run : null
}

/** A walked line's points, as the clearance check sees them, and the stretches it drives on fields. */
export type FieldClearanceLine = Pick<LayoutWalk, 'pts' | 'ys' | 'walls'> & { fielded: readonly (readonly [number, number])[] }

/** How far past the field's edge a road's walls must stay: the edge wall's footprint and a little room. */
const EDGE_CLEARANCE = 1.5

/** Why roads and fields share ground, or null; a road may pass over or under a field, and level fields may meet edge to edge. */
export function fieldClearanceFault(fields: readonly FieldDef[], lines: readonly FieldClearanceLine[]): string | null {
    for (const [i, a] of fields.entries()) {
        for (const b of fields.slice(i + 1)) {
            if (Math.abs(a.y - b.y) < MIN_CLEARANCE && fieldsOverlap(a, b)) return 'two fields overlap'
        }
        const { width: w, length: len } = a.plan
        for (const [l, line] of lines.entries()) {
            for (let k = 0; k < line.pts.length; k++) {
                if (line.fielded.some(([p, q]) => k >= p && k < q)) continue
                if (Math.abs(line.ys[k]! - a.y) >= MIN_CLEARANCE) continue
                const [x, z] = line.pts[k]!
                const { u, v } = fieldLocal(a, x, z)
                const off = Math.hypot(Math.max(0, -u, u - w), Math.max(0, -v, v - len))
                if (off >= wallFoot(line.walls[k]!) + EDGE_CLEARANCE) continue
                // In front of its own mouth, heading out of it.
                const mouthed = a.mouths.some(m => {
                    if (m.branch !== l) return false
                    const along = alongEdge(m.edge, u, v)
                    const out = m.edge === 'entry' ? -v : m.edge === 'exit' ? v - len : m.edge === 'left' ? -u : u - w
                    return out >= -MOUTH_TOLERANCE && Math.abs(along - m.at) <= m.half
                })
                if (!mouthed) return `the road at (${x.toFixed(0)}, ${z.toFixed(0)}) runs into a field`
            }
        }
    }
    return null
}
