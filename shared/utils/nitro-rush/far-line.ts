import { joinedFields } from './track-fields'
import type { Track } from './track'

/**
 * A loop started on a field has no road line to count rounds of, so it counts them over a level of progress
 * on the road away from the start's fields: out and back crosses it both ways and is no lap.
 */

/** Gaps between the start's fields narrower than this share of the course have no far line. */
const MIN_GAP = 0.01
/** Steps that move progress this far or more are taken to wrap round the start, and cross nothing. */
const WRAP = 0.5

/** The progress at the middle of the widest stretch of the course off the start's fields; null when laps don't need one. */
export function findFarProgress(track: Track): number | null {
    const start = track.lapLines[0]
    if (!track.closed || start?.field === undefined || track.arena) return null
    const spans: [number, number][] = []
    for (const f of joinedFields(track.fields, start.field)) {
        for (const c of f.crossings) {
            const a = track.progressAt(c.branch, c.from)
            const b = track.progressAt(c.branch, c.to)
            if (a <= b) spans.push([a, b])
            else spans.push([a, 1], [0, b])
        }
    }
    spans.sort((p, q) => p[0] - q[0])
    let widest = MIN_GAP
    let far: number | null = null
    let reach = 0
    for (const [a, b] of [...spans, [1, 1] as [number, number]]) {
        if (a - reach > widest) {
            widest = a - reach
            far = (a + reach) / 2
        }
        reach = Math.max(reach, b)
    }
    return far
}

/** +1 for a step from progress `p0` to `p1` up over `far`, -1 back down over it, 0 otherwise or when the step wraps. */
export function farTurn(p0: number, p1: number, far: number) {
    if (!(Math.abs(p1 - p0) < WRAP)) return 0
    return (p1 >= far ? 1 : 0) - (p0 >= far ? 1 : 0)
}
