import type { LayoutWalk, RoadState, TrackPiece } from './layout'

/** What rules a walked road in or out as a course, for `buildTrack` and for anything asking about a road still being laid. */

/** Metres between a walked road's points. */
export const STEP = 2
export const CLOSE_TOLERANCE = 0.01
/** Road to road where one passes over another: the deck, the car, the chase camera and a line's arch fit between; a half spiral climbs it. */
export const MIN_CLEARANCE = 6

type RoadPoints = Pick<LayoutWalk, 'pts' | 'ys' | 'lifts' | 'walls'> & Partial<Pick<LayoutWalk, 'gaps'>>

/** What each piece that a bank or slope can't carry is called: a level arch or a flight doesn't fit a tilted road. */
const NEEDS_LEVEL_ROAD: Partial<Record<TrackPiece['type'], string>> = {
    jump: 'a jump', kicker: 'a jump ramp', looping: 'a looping', start: 'a start line', finish: 'a finish line', checkpoint: 'a checkpoint'
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

/** The first two stretches far apart along the road that cover the same ground without room to drive under, leaving out pairs `excused` says don't count. */
function firstClash({ pts, ys, lifts, walls, gaps = [] }: RoadPoints, excused: (i: number, j: number) => boolean): string | null {
    const n = pts.length
    // Empty road has no deck to hit: a jump may fly over road or onto it, but needs room under road above it.
    const empty = new Uint8Array(n)
    for (const [a, b] of gaps) empty.fill(1, a, b)
    const { reach, apart } = widestSpan(walls)
    // Points bucketed in cells `reach` wide, so each one is only checked against its own cell and the eight round it.
    const cellOf = (i: number) => [Math.floor(pts[i]![0] / reach), Math.floor(pts[i]![1] / reach)] as const
    const cells = new Map<string, number[]>()
    for (let i = 0; i < n; i++) {
        const [cx, cz] = cellOf(i)
        const key = `${cx},${cz}`
        const cell = cells.get(key)
        if (cell) cell.push(i)
        else cells.set(key, [i])
    }
    for (let i = 0; i < n; i++) {
        const [cx, cz] = cellOf(i)
        const near: number[] = []
        for (let ox = -1; ox <= 1; ox++) {
            for (let oz = -1; oz <= 1; oz++) near.push(...cells.get(`${cx + ox},${cz + oz}`) ?? [])
        }
        near.sort((a, b) => a - b)
        for (const j of near) {
            if (j < i + apart || (empty[i] && empty[j]) || excused(i, j)) continue
            if (empty[i] ? ys[j]! <= ys[i]! : empty[j] && ys[i]! <= ys[j]!) continue
            const dx = pts[i]![0] - pts[j]![0]
            const dz = pts[i]![1] - pts[j]![1]
            const near = clearanceReach(walls[i]!, walls[j]!)
            if (dx * dx + dz * dz >= near * near) continue
            // A bank's raised edge comes that much closer than its centre.
            const dy = Math.max(0, Math.abs(ys[i]! - ys[j]!) - lifts[i]! - lifts[j]!)
            if (dy < MIN_CLEARANCE - CLOSE_TOLERANCE) return `the road at (${pts[i]![0].toFixed(0)}, ${pts[i]![1].toFixed(0)}) passes ${dy.toFixed(1)} m from another stretch; it needs ${MIN_CLEARANCE} m`
        }
    }
    return null
}

/** Wherever two stretches of road far apart along the course cover the same ground, one must pass over the other with room to drive under. */
export function clearanceFault(road: RoadPoints, closed: boolean): string | null {
    const n = road.pts.length
    const { apart } = widestSpan(road.walls)
    return firstClash(road, (i, j) => closed && n - (j - i) < apart)
}

/** Whether a road still being laid clashes on its last piece; an older clash isn't this piece's fault, and only a run in from behind the line (+z) is a loop's join. */
export function lastPieceClashes(road: RoadPoints & Pick<LayoutWalk, 'pieceStarts'>, closed: boolean) {
    const n = road.pts.length
    const from = road.pieceStarts[road.pieceStarts.length - 1]!
    const { apart } = widestSpan(road.walls)
    return firstClash(road, (i, j) => j < from || (closed && n - (j - i) < apart && road.pts[j]![1] >= 0)) !== null
}
