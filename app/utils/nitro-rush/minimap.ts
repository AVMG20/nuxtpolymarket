/** The course's plan scaled into the HUD minimap's square view box, north up as the camera sees it from above. */

import type { Track } from '#shared/utils/nitro-rush/track'

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
    /** The centreline as an SVG path, broken over jump gaps. */
    road: string
    start: MinimapLine
    /** Left out on a loop, where the finish is the start. */
    finish: MinimapLine | null
}

/** Fits points into the view box with their aspect kept, centred. */
export function fitPlan(xs: ArrayLike<number>, zs: ArrayLike<number>, view = MINIMAP_VIEW, pad = PAD): MinimapFit {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < xs.length; i++) {
        minX = Math.min(minX, xs[i]!)
        maxX = Math.max(maxX, xs[i]!)
        minZ = Math.min(minZ, zs[i]!)
        maxZ = Math.max(maxZ, zs[i]!)
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

function lineAcross(track: Track, fit: MinimapFit, s: number): MinimapLine {
    const p = track.pointAt(s)
    const len = Math.hypot(p.tx, p.tz) || 1
    const [x, y] = toMap(fit, p.x, p.z)
    // The road's right in view units: the tangent turned a quarter.
    const rx = -p.tz / len * LINE_HALF
    const ry = p.tx / len * LINE_HALF
    return { x1: num(x - rx), y1: num(y - ry), x2: num(x + rx), y2: num(y + ry) }
}

export function minimapPlan(track: Track): MinimapPlan {
    const fit = fitPlan(track.xs, track.zs)
    const parts: string[] = []
    let drawing = false
    for (let i = 0; i < track.segments; i++) {
        const j = (i + 1) % track.n
        if (track.gapAt((track.cum[i]! + track.cum[i + 1]!) / 2)) {
            drawing = false
            continue
        }
        if (!drawing) {
            const [x, y] = toMap(fit, track.xs[i]!, track.zs[i]!)
            parts.push(`M${num(x)} ${num(y)}`)
            drawing = true
        }
        const [x, y] = toMap(fit, track.xs[j]!, track.zs[j]!)
        parts.push(`L${num(x)} ${num(y)}`)
    }
    if (track.closed && !track.gaps.length) parts.push('Z')
    return {
        fit,
        road: parts.join(''),
        start: lineAcross(track, fit, track.startS),
        finish: track.closed ? null : lineAcross(track, fit, track.finishS)
    }
}
