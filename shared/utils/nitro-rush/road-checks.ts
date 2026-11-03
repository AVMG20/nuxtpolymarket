import type { LayoutWalk } from './layout'

/** What rules a walked road in or out as a course, for `buildTrack` and for anything asking about a road still being laid. */

/** Metres between a walked road's points. */
export const STEP = 2
export const CLOSE_TOLERANCE = 0.01
/** Road to road where one passes over another: the deck, the car, the chase camera and a line's arch fit between; a half spiral climbs it. */
export const MIN_CLEARANCE = 6

type RoadPoints = Pick<LayoutWalk, 'pts' | 'ys' | 'lifts'>

/** How near two stretches count as the same ground, and how many points apart they must be not to be one road bending (a hairpin). */
export function clearanceSpan(wallOffset: number) {
    // Deck edge to deck edge, with the wall's footprint on both.
    const reach = (wallOffset + 1) * 2
    return { reach, apart: Math.ceil(reach * 3 / STEP) }
}

/** What's wrong with a road's pieces and lines, however it goes on from here. */
export function layoutFault({ notLevel, lines }: Pick<LayoutWalk, 'notLevel' | 'lines'>, closed: boolean): string | null {
    if (notLevel) return `level the road out before ${notLevel}`
    const count = (type: string) => lines.filter(l => l.type === type).length
    if (count('start') !== 1) return 'needs exactly one start block'
    if (closed && count('finish') > 0) return 'a loop has no finish block; the start line ends each lap'
    if (!closed && count('finish') !== 1) return 'an open course needs exactly one finish block'
    return null
}

/** The first two stretches far apart along the road that cover the same ground without room to drive under, leaving out pairs `excused` says don't count. */
function firstClash({ pts, ys, lifts }: RoadPoints, wallOffset: number, excused: (i: number, j: number) => boolean): string | null {
    const n = pts.length
    const { reach, apart } = clearanceSpan(wallOffset)
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
            if (j < i + apart || excused(i, j)) continue
            const dx = pts[i]![0] - pts[j]![0]
            const dz = pts[i]![1] - pts[j]![1]
            if (dx * dx + dz * dz >= reach * reach) continue
            // A bank's raised edge comes that much closer than its centre.
            const dy = Math.max(0, Math.abs(ys[i]! - ys[j]!) - lifts[i]! - lifts[j]!)
            if (dy < MIN_CLEARANCE - CLOSE_TOLERANCE) return `the road at (${pts[i]![0].toFixed(0)}, ${pts[i]![1].toFixed(0)}) passes ${dy.toFixed(1)} m from another stretch; it needs ${MIN_CLEARANCE} m`
        }
    }
    return null
}

/** Wherever two stretches of road far apart along the course cover the same ground, one must pass over the other with room to drive under. */
export function clearanceFault(road: RoadPoints, closed: boolean, wallOffset: number): string | null {
    const n = road.pts.length
    const { apart } = clearanceSpan(wallOffset)
    return firstClash(road, wallOffset, (i, j) => closed && n - (j - i) < apart)
}

/** Whether a road still being laid clashes on its last piece; an older clash isn't this piece's fault, and only a run in from behind the line (+z) is a loop's join. */
export function lastPieceClashes(road: RoadPoints & Pick<LayoutWalk, 'pieceStarts'>, closed: boolean, wallOffset: number) {
    const n = road.pts.length
    const from = road.pieceStarts[road.pieceStarts.length - 1]!
    const { apart } = clearanceSpan(wallOffset)
    return firstClash(road, wallOffset, (i, j) => j < from || (closed && n - (j - i) < apart && road.pts[j]![1] >= 0)) !== null
}
