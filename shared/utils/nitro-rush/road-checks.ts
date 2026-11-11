import type { LayoutWalk, RoadState, TrackPiece } from './layout'
import { wallFoot, type Track, type TrackLine } from './track'

/** What rules a walked road in or out as a course, for `buildTrack` and for anything asking about a road still being laid. */

/** Metres between a walked road's points. */
export const STEP = 2
export const CLOSE_TOLERANCE = 0.01
/** Road to road where one passes over another: the deck, the car, the chase camera and a line's arch fit between; a half spiral climbs it. */
export const MIN_CLEARANCE = 6

export type RoadPoints = Pick<LayoutWalk, 'pts' | 'ys' | 'lifts' | 'walls'> & Partial<Pick<LayoutWalk, 'gaps'>>

/** What each piece that a bank or slope can't carry is called: a level arch or a flight doesn't fit a tilted road. */
const NEEDS_LEVEL_ROAD: Partial<Record<TrackPiece['type'], string>> = {
    jump: 'a jump', kicker: 'a jump ramp', looping: 'a looping', start: 'a start line', finish: 'a finish line', checkpoint: 'a checkpoint', split: 'a split', join: 'a join'
}

/** Why `piece` can't be laid on road in this state, in the builder's words; null when it can. */
export function placementFault(piece: TrackPiece, { bank, grade, air = 0 }: Pick<RoadState, 'bank' | 'grade'> & Partial<Pick<RoadState, 'air'>>): string | null {
    const flying = piece.type === 'gap' || piece.type === 'landing'
    if (air && !flying) return 'only empty road or a landing ramp can follow a jump ramp'
    if (!air && flying) return `${piece.type === 'gap' ? 'empty road' : 'a landing ramp'} needs a jump ramp before it`
    if (piece.type === 'corkscrew') {
        if (grade) return 'a corkscrew needs road with no slope: level the slope first'
        // Its roll carries on from the bank, so only a bank leaning its way leads into it.
        const leansItsWay = piece.turn === 'right' ? bank > 0 : bank < 0
        return leansItsWay ? null : `a corkscrew ${piece.turn} starts and ends on a ${piece.turn} bank: bank the road ${piece.turn} first`
    }
    const name = NEEDS_LEVEL_ROAD[piece.type]
    if (!name || !(bank || grade)) return null
    const tilted = [bank && 'the bank', grade && 'the slope'].filter(Boolean).join(' and ')
    return `${name} needs flat, unbanked road: level ${tilted} first`
}

/** How near two stretches with walls `a` and `b` from their centres count as the same ground: deck edge to deck edge, with the wall's footprint on both. */
export const clearanceReach = (a: number, b: number) => a + b + 2

/** How near two stretches count as the same ground, and how many points apart they must be not to be one road bending (a hairpin). */
export function clearanceSpan(wallOffset: number) {
    const reach = clearanceReach(wallOffset, wallOffset)
    return { reach, apart: Math.ceil(reach * 3 / STEP) }
}

/** The span of the widest road among `walls`, which covers every pair on it. */
const widestSpan = (walls: readonly number[]) => clearanceSpan(Math.max(0, ...walls))

/** What's wrong with a road's pieces and lines, however it goes on from here. */
export function layoutFault({ misplaced, lines }: Pick<LayoutWalk, 'misplaced' | 'lines'>, closed: boolean): string | null {
    if (misplaced) return misplaced
    const count = (type: string) => lines.filter(l => l.type === type).length
    if (count('start') !== 1) return 'needs exactly one start block'
    if (closed && count('finish') > 0) return 'a loop has no finish block; the start line ends each lap'
    if (!closed && count('finish') !== 1) return 'an open course needs exactly one finish block'
    return null
}

/**
 * The first two stretches that cover the same ground without room to drive under: on one line, only those far apart
 * along it; across lines, any pair. `excused` leaves out pairs that don't count, by line and point.
 */
function firstClash(lines: readonly RoadPoints[], excused: (a: number, i: number, b: number, j: number) => boolean): string | null {
    // Empty road has no deck to hit: a jump may fly over road or onto it, but needs room under road above it.
    const empty = lines.map(({ pts, gaps = [] }) => {
        const e = new Uint8Array(pts.length)
        for (const [a, b] of gaps) e.fill(1, a, b)
        return e
    })
    const { reach, apart } = widestSpan(lines.flatMap(l => l.walls))
    // Points bucketed in cells `reach` wide, so each one is only checked against its own cell and the eight round it.
    const cellOf = (l: number, i: number) => [Math.floor(lines[l]!.pts[i]![0] / reach), Math.floor(lines[l]!.pts[i]![1] / reach)] as const
    const cells = new Map<string, [number, number][]>()
    lines.forEach((line, l) => {
        for (let i = 0; i < line.pts.length; i++) {
            const [cx, cz] = cellOf(l, i)
            const key = `${cx},${cz}`
            const cell = cells.get(key)
            if (cell) cell.push([l, i])
            else cells.set(key, [[l, i]])
        }
    })
    for (let a = 0; a < lines.length; a++) {
        const A = lines[a]!
        for (let i = 0; i < A.pts.length; i++) {
            const [cx, cz] = cellOf(a, i)
            const near: [number, number][] = []
            for (let ox = -1; ox <= 1; ox++) {
                for (let oz = -1; oz <= 1; oz++) near.push(...cells.get(`${cx + ox},${cz + oz}`) ?? [])
            }
            near.sort((p, q) => p[0] - q[0] || p[1] - q[1])
            for (const [b, j] of near) {
                if (b < a || (b === a && j < i + apart)) continue
                const B = lines[b]!
                const ei = empty[a]![i]
                const ej = empty[b]![j]
                if ((ei && ej) || excused(a, i, b, j)) continue
                if (ei ? B.ys[j]! <= A.ys[i]! : ej && A.ys[i]! <= B.ys[j]!) continue
                const dx = A.pts[i]![0] - B.pts[j]![0]
                const dz = A.pts[i]![1] - B.pts[j]![1]
                const close = clearanceReach(A.walls[i]!, B.walls[j]!)
                if (dx * dx + dz * dz >= close * close) continue
                // A bank's raised edge comes that much closer than its centre.
                const dy = Math.max(0, Math.abs(A.ys[i]! - B.ys[j]!) - A.lifts[i]! - B.lifts[j]!)
                if (dy < MIN_CLEARANCE - CLOSE_TOLERANCE) return `the road at (${A.pts[i]![0].toFixed(0)}, ${A.pts[i]![1].toFixed(0)}) passes ${dy.toFixed(1)} m from another stretch; it needs ${MIN_CLEARANCE} m`
            }
        }
    }
    return null
}

/** Wherever two stretches of road far apart along the course cover the same ground, one must pass over the other with room to drive under. */
export function clearanceFault(road: RoadPoints, closed: boolean): string | null {
    const n = road.pts.length
    const { apart } = widestSpan(road.walls)
    return firstClash([road], (_, i, __, j) => closed && n - (j - i) < apart)
}

/**
 * Where two lines meet: point `ai` of line `a` and point `bi` of line `b`, which part going forward at a fork (`dir` 1)
 * or meet coming in to a join (-1). Their shared deck ends at `aNose` and `bNose`, where the walls between them start.
 */
export interface RoadMeet {
    a: number
    ai: number
    aNose: number
    b: number
    bi: number
    bNose: number
    dir: 1 | -1
}

/** Points past a nose two roads have to be a clearance apart by: walls that meet at a nose only need to part a couple of metres more. */
const PARTING = 30

/**
 * Like `clearanceFault`, for a forked course: each line on its own, and every line against every other, except
 * where two lines meet, which share a deck and then run close until they're a clearance apart. `lines[0]` is the main line.
 */
export function courseClearanceFault(lines: readonly RoadPoints[], closed: boolean, meets: readonly RoadMeet[]): string | null {
    for (const [l, line] of lines.entries()) {
        const fault = clearanceFault(line, closed && l === 0)
        if (fault) return fault
    }
    if (lines.length < 2) return null
    const { apart } = widestSpan(lines.flatMap(l => l.walls))
    const zones = meets.map(m => ({
        a: m.a,
        b: m.b,
        onA: meetZone(lines, m.a, m.ai, m.aNose, m.b, m.dir, apart, closed),
        onB: meetZone(lines, m.b, m.bi, m.bNose, m.a, m.dir, apart, closed)
    }))
    // Each line's own stretches were checked above, with a loop's seam allowed for.
    return firstClash(lines, (a, i, b, j) => a === b || zones.some(z => (z.a === a && z.b === b && z.onA[i] && z.onB[j]) || (z.a === b && z.b === a && z.onA[j] && z.onB[i])))
}

/** Line `l`'s points from `apart` behind its meet at `at` to where, walking `dir`, it first runs a clearance clear of line `other`, `PARTING` past the nose at the most. */
function meetZone(lines: readonly RoadPoints[], l: number, at: number, nose: number, other: number, dir: 1 | -1, apart: number, closed: boolean) {
    const line = lines[l]!
    const far = lines[other]!
    const n = line.pts.length
    const wraps = closed && l === 0
    const zone = new Uint8Array(n)
    const index = (k: number) => wraps ? ((k % n) + n) % n : k
    const deck = wraps ? index((nose - at) * dir) : (nose - at) * dir
    for (let k = -apart; k <= deck + PARTING; k++) {
        const i = index(at + dir * k)
        if (i < 0 || i >= n) {
            if (k > 0) break
            continue
        }
        zone[i] = 1
        if (k <= 0) continue
        const [x, z] = line.pts[i]!
        let clear = true
        for (let j = 0; j < far.pts.length && clear; j++) {
            const dx = far.pts[j]![0] - x
            const dz = far.pts[j]![1] - z
            const reach = clearanceReach(line.walls[i]!, far.walls[j]!)
            clear = dx * dx + dz * dz >= reach * reach
        }
        if (clear) break
    }
    return zone
}

/** Whether a road still being laid clashes on its last piece; an older clash isn't this piece's fault, and only a run in from behind the line (+z) is a loop's join. */
export function lastPieceClashes(road: RoadPoints & Pick<LayoutWalk, 'pieceStarts'>, closed: boolean) {
    const n = road.pts.length
    const from = road.pieceStarts[road.pieceStarts.length - 1]!
    const { apart } = widestSpan(road.walls)
    return firstClash([road], (_, i, __, j) => j < from || (closed && n - (j - i) < apart && road.pts[j]![1] >= 0)) !== null
}

/** A built course's clearance across all its lines, measured from the lines themselves: what a forked layout is checked by. */
export function trackClearanceFault(track: Track): string | null {
    const nearestPoint = (line: TrackLine, s: number) => {
        const i = line.segmentAt(s)
        const j = s - line.cum[i]! > line.cum[i + 1]! - s ? i + 1 : i
        return j % line.n
    }
    const meets: RoadMeet[] = []
    const { edges, vertexCount } = track.graph
    for (let v = 0; v < vertexCount; v++) {
        for (const [list, dir] of [[edges.filter(e => e.from === v), 1], [edges.filter(e => e.to === v), -1]] as const) {
            const [p, q] = list
            if (!p || !q) continue
            const sp = dir > 0 ? p.s0 : p.s1
            const sq = dir > 0 ? q.s0 : q.s1
            const lp = track.branches[p.branch]!
            const lq = track.branches[q.branch]!
            // The shared deck's far end, on each line: its nose at a fork, its tail at a join.
            const noseOf = (line: TrackLine, s: number, partner: number) => {
                const o = line.open.find(o => o.partner === partner && Math.abs((dir > 0 ? o.from : o.to) - s) < 1e-3)
                return nearestPoint(line, o ? (dir > 0 ? o.to : o.from) : s)
            }
            meets.push({
                a: p.branch, ai: nearestPoint(lp, sp), aNose: noseOf(lp, sp, q.branch),
                b: q.branch, bi: nearestPoint(lq, sq), bNose: noseOf(lq, sq, p.branch),
                dir
            })
        }
    }
    const lines = track.branches.map(line => ({
        pts: line.def.points,
        ys: Array.from(line.ys),
        // As a layout has it: how far a bank raises the deck's edge above its centre.
        lifts: Array.from(line.walls, (w, i) => wallFoot(w) * Math.abs(line.right[i * 3 + 1]!)),
        walls: Array.from(line.walls),
        gaps: line.def.gaps
    }))
    return courseClearanceFault(lines, track.closed, meets)
}
