/** The course's plan scaled into the HUD minimap's square view box, north up as the camera sees it from above. */

import { FIELD_TILE } from '#shared/utils/nitro-rush/field'
import { fieldOutlines, type FieldOutline } from '#shared/utils/nitro-rush/field-group'
import type { CourseField, Track, TrackLine } from '#shared/utils/nitro-rush/track'

/** The minimap's view box side, in its own units. */
export const MINIMAP_VIEW = 100
const PAD = 8
/** Half the start and finish lines' length across the road, in view units. */
const LINE_HALF = 4.5

export interface MinimapFit {
    scale: number
    /** The plan's centre, which lands on the view's centre. */
    cx: number
    cz: number
}

/** A short line across the road, in view units. */
export interface MinimapLine {
    x1: number
    y1: number
    x2: number
    y2: number
}

/** A field from above: its floor and its tiles' items, as SVG polygon points, its gates as lines, and its rim as a path. */
export interface MinimapField {
    floor: string
    /** Only the edges it shares with no level neighbour, so joined fields draw as one. */
    rim: string
    blocks: string[]
    pads: string[]
    gates: MinimapLine[]
}

export interface MinimapPlan {
    fit: MinimapFit
    /** Every line's centreline as one SVG path, broken over jump gaps and across fields. */
    road: string
    fields: MinimapField[]
    start: MinimapLine
    /** Every finish; none on a loop, where the finish is the start. */
    finishes: MinimapLine[]
}

/** Fits the points of every set into the view box with their aspect kept, centred. */
export function fitPlan(plans: readonly { xs: ArrayLike<number>, zs: ArrayLike<number> }[], view = MINIMAP_VIEW, pad = PAD): MinimapFit {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const { xs, zs } of plans) {
        for (let i = 0; i < xs.length; i++) {
            minX = Math.min(minX, xs[i]!)
            maxX = Math.max(maxX, xs[i]!)
            minZ = Math.min(minZ, zs[i]!)
            maxZ = Math.max(maxZ, zs[i]!)
        }
    }
    const span = Math.max(maxX - minX, maxZ - minZ) || 1
    return { scale: (view - pad * 2) / span, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

/** Where a point on the plan lands in the view box. */
export function toMap(fit: MinimapFit, x: number, z: number, view = MINIMAP_VIEW): [number, number] {
    return [view / 2 + (x - fit.cx) * fit.scale, view / 2 + (z - fit.cz) * fit.scale]
}

/** SVG rotation, in degrees, that turns a marker drawn nose-up to face `heading`. */
export const markerRotation = (heading: number) => -heading * 180 / Math.PI

const num = (v: number) => Math.round(v * 100) / 100

function lineAcross(line: TrackLine, fit: MinimapFit, s: number): MinimapLine {
    const p = line.pointAt(s)
    const len = Math.hypot(p.tx, p.tz) || 1
    const [x, y] = toMap(fit, p.x, p.z)
    // The road's right in view units: the tangent turned a quarter.
    const rx = -p.tz / len * LINE_HALF
    const ry = p.tx / len * LINE_HALF
    return { x1: num(x - rx), y1: num(y - ry), x2: num(x + rx), y2: num(y + ry) }
}

export function minimapPlan(track: Track): MinimapPlan {
    const corners = track.fields.map((f) => {
        const pts = [f.world(0, 0), f.world(f.width, 0), f.world(f.width, f.length), f.world(0, f.length)]
        return { xs: pts.map(p => p[0]), zs: pts.map(p => p[1]) }
    })
    const fit = fitPlan([...track.branches, ...corners])
    return {
        fit,
        road: track.branches.map(line => linePath(line, fit)).join(''),
        fields: fieldOutlines(track.fields.map(f => f.def)).map((o, i) => fieldPlan(track.fields[i]!, o, fit)),
        start: lineAcross(track, fit, track.startS),
        finishes: track.lapLines.filter(l => l.kind === 'finish').map(l => lineAcross(track.branches[l.branch]!, fit, l.s))
    }
}

function fieldPlan(f: CourseField, outline: FieldOutline, fit: MinimapFit): MinimapField {
    const at = ([x, z]: readonly [number, number]) => toMap(fit, x, z).map(num)
    const polygon = (pts: readonly (readonly [number, number])[]) => pts.map(p => at(p).join(',')).join(' ')
    const rect = (u0: number, v0: number, u1: number, v1: number) => polygon([f.world(u0, v0), f.world(u1, v0), f.world(u1, v1), f.world(u0, v1)])
    const tile = (col: number, row: number, inset = 0) => rect(col * FIELD_TILE + inset, row * FIELD_TILE + inset, (col + 1) * FIELD_TILE - inset, (row + 1) * FIELD_TILE - inset)
    const tiles = f.def.plan.tiles
    return {
        floor: polygon(outline.corners),
        rim: outline.rim.map(([a, b]) => `M${at(a).join(' ')}L${at(b).join(' ')}`).join(''),
        blocks: tiles.filter(t => t.kind === 'block' || t.kind === 'pillar').map(t => tile(t.col, t.row, t.kind === 'pillar' ? FIELD_TILE * 0.3 : 0)),
        pads: f.pads.map(p => tile(p.col, p.row, FIELD_TILE * 0.2)),
        gates: f.gates.map((g) => {
            const half = FIELD_TILE / 2
            const [x1, y1] = toMap(fit, g.x + g.dz * half, g.z - g.dx * half)
            const [x2, y2] = toMap(fit, g.x - g.dz * half, g.z + g.dx * half)
            return { x1: num(x1), y1: num(y1), x2: num(x2), y2: num(y2) }
        })
    }
}

/** One line's centreline as SVG path commands, broken over jump gaps; a loop with no gap closes. */
function linePath(line: TrackLine, fit: MinimapFit) {
    const parts: string[] = []
    let drawing = false
    for (let i = 0; i < line.segments; i++) {
        const j = (i + 1) % line.n
        const mid = (line.cum[i]! + line.cum[i + 1]!) / 2
        if (line.gapAt(mid) || line.fieldedAt(mid)) {
            drawing = false
            continue
        }
        if (!drawing) {
            const [x, y] = toMap(fit, line.xs[i]!, line.zs[i]!)
            parts.push(`M${num(x)} ${num(y)}`)
            drawing = true
        }
        const [x, y] = toMap(fit, line.xs[j]!, line.zs[j]!)
        parts.push(`L${num(x)} ${num(y)}`)
    }
    if (line.closed && !line.gaps.length) parts.push('Z')
    return parts.join('')
}
