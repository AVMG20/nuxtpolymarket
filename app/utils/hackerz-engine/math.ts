import { segPointDist } from '../firewall-engine/math'

// The plain helpers are Firewall's own; only the segment crossing below is Hackerz's.
// `randRange` is cosmetic only: outcomes roll through `./rng`.
export { clamp, randRange, segPointDist } from '../firewall-engine/math'

/** The middle of a set of field points (not empty). */
export function centroid(points: readonly { u: number, d: number }[]) {
    return {
        u: points.reduce((sum, p) => sum + p.u, 0) / points.length,
        d: points.reduce((sum, p) => sum + p.d, 0) / points.length
    }
}

/** Shortest distance between segments (a→b) and (c→d): zero where they cross. */
export function segSegDist(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number
) {
    const cross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
        (qx - px) * (ry - py) - (qy - py) * (rx - px)
    const d1 = cross(cx, cy, dx, dy, ax, ay)
    const d2 = cross(cx, cy, dx, dy, bx, by)
    const d3 = cross(ax, ay, bx, by, cx, cy)
    const d4 = cross(ax, ay, bx, by, dx, dy)
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
    return Math.min(
        segPointDist(ax, ay, bx, by, cx, cy),
        segPointDist(ax, ay, bx, by, dx, dy),
        segPointDist(cx, cy, dx, dy, ax, ay),
        segPointDist(cx, cy, dx, dy, bx, by)
    )
}
