/** The course's plan scaled into the HUD minimap's square view box, north up as the camera sees it from above. */

import type { Track, TrackLine } from '#shared/utils/nitro-rush/track'

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

export interface MinimapPlan {
    fit: MinimapFit
    /** Every line's centreline as one SVG path, broken over jump gaps. */
    road: string
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
    const fit = fitPlan(track.branches)
    return {
        fit,
        road: track.branches.map(line => linePath(line, fit)).join(''),
        start: lineAcross(track, fit, track.startS),
        finishes: track.lapLines.filter(l => l.kind === 'finish').map(l => lineAcross(track.branches[l.branch]!, fit, l.s))
    }
}

/** One line's centreline as SVG path commands, broken over jump gaps; a loop with no gap closes. */
function linePath(line: TrackLine, fit: MinimapFit) {
    const parts: string[] = []
    let drawing = false
    for (let i = 0; i < line.segments; i++) {
        const j = (i + 1) % line.n
        if (line.gapAt((line.cum[i]! + line.cum[i + 1]!) / 2)) {
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
