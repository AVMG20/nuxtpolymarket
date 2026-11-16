import { draftFieldDefs } from './field-layout'
import type { LayoutWalk } from './layout'
import { Track, TrackGraphError, TrackLine, type TrackDef } from './track'
import { ROAD } from './tracks'

/** A course half laid in the builder, as road to draw and preview: the main road, a branch, or one piece on its own. */

/** The index of the piece holding walk point `i`. */
export function pieceAt(walk: LayoutWalk, i: number) {
    const starts = walk.pieceStarts
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid]! <= i) lo = mid
        else hi = mid - 1
    }
    return lo
}

/** The road laid so far as a course to draw, open unless `closes`; a forked draft passes `fields` false and leaves them to the whole course. */
export function draftTrackDef(walk: LayoutWalk, closes: boolean, fields = true): TrackDef | null {
    const points = walk.pts.map(([x, z]): [number, number] => [x, z])
    const heights = [...walk.ys]
    const ups = [...walk.ups]
    const halfWidths = [...walk.halfWidths]
    if (!closes) {
        points.push([walk.end.x, walk.end.z])
        heights.push(walk.end.y)
        ups.push(ups[ups.length - 1] ?? [0, 1, 0])
        halfWidths.push(walk.end.halfWidth)
    }
    if (points.length < 2) return null
    const def: TrackDef = { id: 'draft', name: 'Draft', group: closes ? 'circuits' : 'sprints', points, ...ROAD }
    if (heights.some(y => y !== 0)) def.heights = heights
    if (halfWidths.some(w => w !== ROAD.halfWidth)) def.halfWidths = halfWidths
    if (ups.some(u => u[0] !== 0 || u[1] !== 1 || u[2] !== 0)) def.ups = ups
    if (walk.rails.length) def.rails = walk.rails
    if (walk.gaps.length) def.gaps = walk.gaps
    if (walk.boosts.length) def.boosts = walk.boosts
    if (!closes) def.closed = false
    if (fields && walk.fields.length) {
        // Timed end to end, so no field's hub falls before a start or past a finish the draft hasn't got yet.
        if (!closes) def.runUp = def.runOff = 0
        const { cum } = new TrackLine(def)
        const { defs, ids } = draftFieldDefs([walk], (_, k) => ({ branch: 0, s: cum[Math.min(k, cum.length - 1)]! }))
        // A road into another line's field still leaves the ground it covers open.
        def.onFields = walk.fields.map(f => ({ range: [f.from, f.to], field: ids.get(f.id) ?? -1 }))
        if (defs.length) def.fields = defs
        if (defs.length && !buildsAsCourse(def)) delete def.fields
    }
    return def
}

/** Whether the draft builds as a course, which a half-laid field can stop. */
function buildsAsCourse(def: TrackDef) {
    try {
        void new Track(def)
        return true
    } catch (e) {
        if (e instanceof TrackGraphError) return false
        throw e
    }
}

/** A walk's last piece cut out of it, as a course to draw on its own. */
export function lastPieceWalk(walk: LayoutWalk): LayoutWalk {
    const from = walk.pieceStarts[walk.pieceStarts.length - 1]!
    return {
        ...walk,
        pts: walk.pts.slice(from),
        ys: walk.ys.slice(from),
        lifts: walk.lifts.slice(from),
        ups: walk.ups.slice(from),
        halfWidths: walk.halfWidths.slice(from),
        walls: walk.walls.slice(from),
        rails: [],
        // Kept, so an empty piece's preview reads as empty road, not as deck.
        gaps: walk.gaps.filter(([, to]) => to > from).map(([a, b]) => [Math.max(0, a - from), b - from]),
        boosts: [],
        fields: [],
        lines: [],
        pieceStarts: [0],
        states: walk.states.slice(-1)
    }
}
