import { compileCustomTrack, lineSections, SECTIONS, type CustomTrack } from './custom'
import { walkCustomLines } from './custom-forks'
import type { LayoutWalk } from './layout'
import { footprint, isObstacleKind, OBSTACLE_ALONG_STEP, OBSTACLE_KINDS, OBSTACLE_LANE_STEP, type Obstacle, type ObstacleDef } from './obstacles'
import { ROAD } from './tracks'

/** What the builder needs to place obstacles: where a click lands on the road, and whether something may stand there. */

/** A spot on the road an obstacle can go: a section of a line, and where on it. */
export type ObstacleSpot = Pick<Obstacle, 'line' | 'at' | 'along' | 'lateral'>

/** Metres off the road's edge a click still lands on it. */
const CLICK_SLACK = 2
/** Metres an obstacle's centre keeps inside the road's edge when snapped. */
const EDGE_KEEP = 1

const PLAIN = new Set(['straight', 'corner', 'bank', 'slope', 'width', 'ramp', 'spiral', 'boost'])

/**
 * The spot nearest (x, z) on line `line` (any line when negative) of the builder's walks (`walkCustomLines`,
 * main road first), snapped to whole steps along and across; null when it's off the road.
 */
export function obstacleSpotAt(walks: readonly LayoutWalk[], line: number, x: number, z: number): ObstacleSpot | null {
    let best: { line: number, i: number, t: number, lateral: number, d: number } | null = null
    walks.forEach((w, l) => {
        if (line >= 0 && l !== line) return
        const pts = [...w.pts, [w.end.x, w.end.z] as [number, number]]
        for (let i = 0; i + 1 < pts.length; i++) {
            const [ax, az] = pts[i]!
            const [bx, bz] = pts[i + 1]!
            const dx = bx - ax
            const dz = bz - az
            const len2 = dx * dx + dz * dz
            if (!len2) continue
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
            const px = ax + dx * t
            const pz = az + dz * t
            const d = Math.hypot(x - px, z - pz)
            if (best && d >= best.d) continue
            const len = Math.sqrt(len2)
            // Right of the road's direction is (-dz, dx).
            const lateral = ((x - px) * -dz + (z - pz) * dx) / len
            best = { line: l, i, t, lateral, d }
        }
    })
    if (!best) return null
    const { line: l, i, t, lateral } = best as { line: number, i: number, t: number, lateral: number }
    const w = walks[l]!
    const half = w.halfWidths[Math.min(i, w.halfWidths.length - 1)] ?? ROAD.halfWidth
    if (Math.abs(lateral) > half + CLICK_SLACK) return null
    const starts = w.pieceStarts
    if (!starts.length || i < starts[0]!) return null
    let at = 0
    while (at + 1 < starts.length && starts[at + 1]! <= i) at++
    const pts = [...w.pts, [w.end.x, w.end.z] as [number, number]]
    let along = 0
    for (let k = starts[at]!; k < i; k++) along += Math.hypot(pts[k + 1]![0] - pts[k]![0], pts[k + 1]![1] - pts[k]![1])
    along += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]) * t
    const keep = Math.max(0, half - EDGE_KEEP)
    return {
        line: l,
        at,
        along: Math.max(0, Math.round(along / OBSTACLE_ALONG_STEP) * OBSTACLE_ALONG_STEP),
        lateral: Math.max(-keep, Math.min(keep, Math.round(lateral / OBSTACLE_LANE_STEP) * OBSTACLE_LANE_STEP))
    }
}

/** Why `o` can't stand on `t`, in the builder's words; null when it can. `o` may already be one of `t`'s obstacles. */
export function obstacleFault(t: CustomTrack, o: Obstacle): string | null {
    const name = isObstacleKind(o.kind) ? OBSTACLE_KINDS[o.kind].label.toLowerCase() : 'thing'
    if (!isObstacleKind(o.kind)) return 'that isn\'t an obstacle'
    const id = lineSections(t, o.line)[o.at]
    if (!id) return `a ${name} needs a section to stand on`
    if (!PLAIN.has(SECTIONS[id].piece.type)) return `a ${name} can only stand on plain road`
    const others = (t.obstacles ?? []).filter(x => x !== o)
    const bare = compileCustomTrack({ ...t, obstacles: undefined })
    if (!bare.def) return draftFault(t, o, name)
    const withIt = compileCustomTrack({ ...t, obstacles: [...others, o] })
    if (withIt.def) return null
    // Blame `o` only for what it brings: the others may be at fault on their own.
    const without = others.length ? compileCustomTrack({ ...t, obstacles: others }) : bare
    if (without.def) return withIt.error
    return compileCustomTrack({ ...t, obstacles: [o] }).error
}

/** Before the course drives, only whether `o` fits on its section and between its walls. */
function draftFault(t: CustomTrack, o: Obstacle, name: string): string | null {
    let walk: LayoutWalk | undefined
    try {
        walk = walkCustomLines(t)[o.line]
    } catch {
        return null
    }
    if (!walk) return null
    const from = walk.pieceStarts[o.at]
    if (from === undefined) return null
    const to = walk.pieceStarts[o.at + 1] ?? walk.pts.length
    const pts = [...walk.pts, [walk.end.x, walk.end.z] as [number, number]]
    let length = 0
    for (let k = from; k < to && k + 1 < pts.length; k++) length += Math.hypot(pts[k + 1]![0] - pts[k]![0], pts[k + 1]![1] - pts[k]![1])
    if (o.along < 0 || o.along >= length) return `a ${name} stands past the end of its section`
    const half = walk.walls[from] ?? ROAD.wallOffset
    if (Math.abs(o.lateral) + footprint(o.kind, o.rot ?? 0).across > half) return `a ${name} sticks into the wall`
    return null
}

/** An obstacle on the builder's map: where it stands on the plan, which way the road runs there, and its half size along and across. */
export interface ObstacleMark {
    index: number
    kind: Obstacle['kind']
    x: number
    z: number
    /** Unit direction along the road; across is (-dz, dx). */
    dx: number
    dz: number
    halfAlong: number
    halfAcross: number
    solid: boolean
}

/** Every obstacle of `obstacles` laid on the builder's walks (`walkCustomLines`), for the 2D map; one off its road is left out. */
export function obstacleMarks(walks: readonly LayoutWalk[], obstacles: readonly Obstacle[]): ObstacleMark[] {
    const out: ObstacleMark[] = []
    obstacles.forEach((o, index) => {
        const w = walks[o.line]
        const from = w?.pieceStarts[o.at]
        if (!w || from === undefined || !isObstacleKind(o.kind)) return
        const pts = [...w.pts, [w.end.x, w.end.z] as [number, number]]
        let left = o.along
        for (let k = from; k + 1 < pts.length; k++) {
            const [ax, az] = pts[k]!
            const [bx, bz] = pts[k + 1]!
            const len = Math.hypot(bx - ax, bz - az)
            if (!len) continue
            if (left <= len || k + 2 === pts.length) {
                const t = Math.min(1, left / len)
                const dx = (bx - ax) / len
                const dz = (bz - az) / len
                const size = footprint(o.kind, o.rot ?? 0)
                out.push({
                    index, kind: o.kind, x: ax + (bx - ax) * t - dz * o.lateral, z: az + (bz - az) * t + dx * o.lateral, dx, dz,
                    halfAlong: size.along, halfAcross: size.across, solid: OBSTACLE_KINDS[o.kind].mechanic === 'solid'
                })
                return
            }
            left -= len
        }
    })
    return out
}

/**
 * The obstacles on line `line`, as a drawn line of the builder carries them: by distance along `walk`, less the
 * `shift` points a forked loop's drawing starts its main line on. `ids` are their places in `obstacles`.
 */
export function drawnObstacleDefs(walk: LayoutWalk, obstacles: readonly Obstacle[], line: number, shift = 0): ObstacleDef[] {
    const mine = obstacles.flatMap((o, id) => o.line === line && isObstacleKind(o.kind) ? [{ o, id }] : [])
    if (!mine.length) return []
    const pts = [...walk.pts, [walk.end.x, walk.end.z] as [number, number]]
    const cum = [0]
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]))
    const from = cum[Math.min(shift, cum.length - 1)]!
    return mine.flatMap(({ o, id }) => {
        const start = walk.pieceStarts[o.at]
        if (start === undefined) return []
        const def: ObstacleDef = { id, kind: o.kind, s: cum[start]! + o.along - from, lateral: o.lateral }
        if (o.rot) def.rot = o.rot
        return [def]
    })
}
