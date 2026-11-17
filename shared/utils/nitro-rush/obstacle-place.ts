import type { LayoutWalk, TrackPiece } from './layout'
import { footprint, isSolid, OBSTACLE_KINDS, type Obstacle, type ObstacleDef } from './obstacles'
import { Track, type TrackDef, type TrackLine } from './track'

/**
 * Obstacles laid onto a compiled course, and the rules on where they may stand: on plain drivable road,
 * inside the walls, clear of the lap lines and the grid, and never closing the road off.
 */

/** Pieces an obstacle may stand on: road that's on the ground plan, not in the air, on rails or across a line. */
const DRIVABLE: ReadonlySet<TrackPiece['type']> = new Set(['straight', 'corner', 'bank', 'slope', 'width', 'ramp', 'spiral', 'boost'])
/** Metres an obstacle keeps from a start, finish or checkpoint line, past its own size. */
export const LINE_CLEARANCE = 8
/** Metres behind the start line kept clear for the grid. */
const GRID_CLEARANCE = 22
/** The narrowest way through that solid obstacles must leave, anywhere along the road. */
export const MIN_LANE = 5.5
/** Metres either side of a solid obstacle along the road that still count against the lane: a car is longer than a slice. */
const LANE_REACH = 2.5
/** How finely the lane check samples the road. */
const LANE_STEP = 0.5

const nameOf = (o: { kind: Obstacle['kind'] }) => OBSTACLE_KINDS[o.kind].label.toLowerCase()

/** Per line, the course's pieces and the index of section 0 among them. */
export interface LinePieces {
    pieces: readonly TrackPiece[]
    offset: number
}

export type PlacedObstacles = { defs: ObstacleDef[][], error: null } | { defs: null, error: string }

/**
 * Each obstacle's distance along its compiled line, per line, from the walks the layout makes (`walks`, as
 * `walkLines` gives them) and the def `buildTrack` made of them; or why one can't stand where it is.
 */
export function placeObstacles(def: TrackDef, obstacles: readonly Obstacle[], walks: readonly LayoutWalk[], lines: readonly LinePieces[]): PlacedObstacles {
    const track = new Track(def)
    const defs: ObstacleDef[][] = track.branches.map(() => [])
    const startAt = walks[0]?.lines.find(l => l.type === 'start')?.at ?? 0
    for (let id = 0; id < obstacles.length; id++) {
        const o = obstacles[id]!
        const w = walks[o.line]
        const line = track.branches[o.line]
        const pieces = lines[o.line]
        if (!w || !line || !pieces) return { defs: null, error: `a ${nameOf(o)} stands on a road that isn't there` }
        const p = pieces.offset + o.at
        const piece = pieces.pieces[p]
        if (!piece || p >= w.pieceStarts.length) return { defs: null, error: `a ${nameOf(o)} stands on a section that isn't there` }
        if (!DRIVABLE.has(piece.type)) return { defs: null, error: `a ${nameOf(o)} can only stand on plain road, not on ${pieceName(piece)}` }
        const n = line.n
        const shift = o.line === 0 && line.closed ? startAt : 0
        const sOf = (k: number) => line.closed ? line.cum[((k - shift) % n + n) % n]! : line.cum[Math.min(k, n - 1)]!
        const s0 = sOf(w.pieceStarts[p]!)
        let length = sOf(w.pieceStarts[p + 1] ?? w.pts.length) - s0
        if (line.closed && length <= 0) length += line.length
        if (o.along < 0 || o.along >= length) return { defs: null, error: `a ${nameOf(o)} stands past the end of its section` }
        const def: ObstacleDef = { id, kind: o.kind, s: line.closed ? line.wrapS(s0 + o.along) : s0 + o.along, lateral: o.lateral }
        if (o.rot) def.rot = o.rot
        defs[o.line]!.push(def)
    }
    return { defs, error: null }
}

function pieceName(piece: TrackPiece) {
    switch (piece.type) {
        case 'kicker': return 'a jump ramp'
        case 'landing': return 'a landing ramp'
        case 'gap': case 'jump': return 'a jump'
        case 'looping': return 'a looping'
        case 'corkscrew': return 'a corkscrew'
        case 'split': case 'join': return 'a fork'
        case 'start': return 'the start line'
        case 'finish': return 'the finish line'
        default: return 'a checkpoint'
    }
}

/** `def` with each line's obstacles set; a line with none is left as it was. */
export function withObstacleDefs(def: TrackDef, defs: readonly ObstacleDef[][]): TrackDef {
    const out: TrackDef = { ...def }
    if (defs[0]?.length) out.obstacles = defs[0]
    if (def.branches) out.branches = def.branches.map((b, i) => defs[i + 1]?.length ? { ...b, obstacles: defs[i + 1] } : b)
    return out
}

/** Signed distance along `line` from `a` to `b`, the short way round on a loop. */
function along(line: TrackLine, a: number, b: number) {
    const d = b - a
    return line.closed ? d - Math.round(d / line.length) * line.length : d
}

/** Why the obstacles on a course can't stand where they are, by the first one at fault; null when they all can. */
export function obstaclesFault(track: Track): string | null {
    const all = track.branches.flatMap(l => l.obstacles).sort((a, b) => a.id - b.id)
    for (const o of all) {
        const fault = bodyFault(track, track.branches[o.branch]!, o)
        if (fault) return fault
    }
    for (const line of track.branches) {
        const fault = laneFault(line)
        if (fault) return fault
    }
    return null
}

function bodyFault(track: Track, line: TrackLine, o: TrackLine['obstacles'][number]): string | null {
    const name = nameOf(o)
    const reach = o.halfAlong
    for (const d of [-reach, 0, reach]) {
        const s = o.s + d
        if (!line.closed && (s < 0 || s > line.length)) return `a ${name} hangs off the end of the road`
        if (line.railAt(s) || line.gapAt(s)) return `a ${name} can only stand on plain road`
        if (Math.abs(o.lateral) + o.halfAcross > line.wallAt(s)) return `a ${name} sticks into the wall`
        if (line.openAt(s, -1) || line.openAt(s, 1)) return `a ${name} can't stand where roads fork or join`
    }
    for (const lap of track.lapLines) {
        if (lap.branch !== line.branch) continue
        const d = along(line, lap.s, o.s)
        const what = lap.kind === 'checkpoint' ? 'a checkpoint' : `the ${lap.kind} line`
        if (Math.abs(d) < LINE_CLEARANCE + reach) return `a ${name} stands too close to ${what}`
        if (lap.kind === 'start' && d < 0 && d > -(GRID_CLEARANCE + reach)) return `a ${name} stands on the starting grid`
    }
    if (line.branch === 0 && !line.closed && o.s < track.startS) return `a ${name} stands before the start line`
    if (!line.closed && line.def.runOff !== undefined && o.s > line.finishS) return `a ${name} stands past the finish line`
    return null
}

/** Whether the solid obstacles on `line` leave a way through everywhere. */
function laneFault(line: TrackLine): string | null {
    const solids = line.obstacles.filter(o => isSolid(o.kind))
    for (const o of solids) {
        const reach = o.halfAlong + LANE_REACH
        for (let d = -reach; d <= reach + 1e-9; d += LANE_STEP) {
            const s = o.s + d
            const wall = line.wallAt(s)
            const blocked = solids
                .filter(b => Math.abs(along(line, b.s, s)) <= b.halfAlong + LANE_REACH)
                .map(b => [b.lateral - b.halfAcross, b.lateral + b.halfAcross] as const)
                .sort((a, b) => a[0] - b[0])
            let edge = -wall
            let widest = 0
            for (const [a, b] of blocked) {
                widest = Math.max(widest, a - edge)
                edge = Math.max(edge, b)
            }
            widest = Math.max(widest, wall - edge)
            if (widest < MIN_LANE) return `a ${nameOf(o)} closes the road off: leave a gap at least ${MIN_LANE} m wide`
        }
    }
    return null
}

/** The size of an obstacle across the road, turned, for a placement preview. */
export const obstacleSize = (o: Pick<Obstacle, 'kind' | 'rot'>) => footprint(o.kind, o.rot ?? 0)
