import { corner, FORK_RADIUS, straight, type ForkShape, type LayoutWalk, type Pose, type RoadState, type TrackPiece } from './layout'
import { wrapAngle } from './track'

/** What a split or join section lays beyond its own road: a split's second arm, a join's road coming in and where it comes in from. */

/** Shorter than this, the run up to a join's bend is left out rather than laid as a sliver. */
const MIN_RUN_IN = 0.05

/** The bend a split's second arm sets off on: the right side of a Y, or the side the split sends it. */
export const splitArm = (shape: ForkShape): TrackPiece => corner(shape === 'left' ? 'left' : 'right', FORK_RADIUS, 45)

/** Which way a road coming into a join bends onto it: in from the right of a Y, or from the side the join takes it in on. */
const mergeSide = (shape: ForkShape) => shape === 'left' ? -1 : 1

/** The radii a bend into a join may take, as the tightest and widest eighths have: enough to fit any diagonal lane the grid gives. */
const MIN_MERGE_RADIUS = 40
const MAX_MERGE_RADIUS = 80

/** How a road comes into a join: along its diagonal for `runIn` metres, then a 45° bend of `radius` that ends where the join does. */
export interface Merge {
    runIn: number
    radius: number
}

/** The road coming into a join, as `merge` lays it. */
export function joinMerge(shape: ForkShape, { runIn, radius }: Merge = { runIn: 0, radius: FORK_RADIUS }): TrackPiece[] {
    const bend: TrackPiece = { type: 'corner', turn: mergeSide(shape) > 0 ? 'right' : 'left', radius, angle: 45, exact: true }
    return runIn >= MIN_RUN_IN ? [straight(runIn), bend] : [bend]
}

/** The heading a road comes into a join on, from the heading the join ends on. */
const inletHeading = (shape: ForkShape, heading: number) => heading - mergeSide(shape) * Math.PI / 4

/** Where a bend of `radius` into a join that ends at `end` starts. */
function bendStart(shape: ForkShape, end: Pose, radius = FORK_RADIUS): Pose {
    const heading = inletHeading(shape, end.heading)
    // A bend from heading a to b moves r * side * (right(a) - right(b)), right(h) being (cos h, sin h).
    const r = radius * mergeSide(shape)
    return {
        x: end.x - r * (Math.cos(heading) - Math.cos(end.heading)),
        z: end.z - r * (Math.sin(heading) - Math.sin(end.heading)),
        heading
    }
}

/** Where the usual bend into a join that ends at `end` starts, and the diagonal it comes in on. */
export const joinInlet = (shape: ForkShape, end: Pose): Pose => bendStart(shape, end)

/** Metres off, and up or down, a branch's end may be from its join's approach and still count as on it; as the graph has it. */
const MEET_TOLERANCE = 0.05
/** Radians a branch may head off its join's approach and still count as on it. */
const HEADING_TOLERANCE = 1e-3

/** Where a road comes into a join: the start of its usual bend in and the diagonal it comes in on, as high and wide as the join. */
export interface Inlet extends Pose {
    shape: ForkShape
    /** Where the join ends, which the bend in has to end on. */
    end: Pose
    y: number
    halfWidth: number
    /** The join's first point on its line, where road behind it ends. */
    point: number
}

/** The inlet of the join that is piece `at` of `walk`, or null when the walk stops at it. */
export function inletOf(walk: LayoutWalk, at: number, shape: ForkShape): Inlet | null {
    const point = walk.pieceStarts[at]
    if (point === undefined || point + 1 >= walk.pts.length) return null
    const next = walk.pieceStarts[at + 1]
    const k = next !== undefined && next + 1 < walk.pts.length ? next : null
    // A join ends on flat road heading in eighths, so the chord after it rounds to its heading.
    const heading = k === null ? walk.end.heading : Math.round(Math.atan2(walk.pts[k + 1]![0] - walk.pts[k]![0], walk.pts[k]![1] - walk.pts[k + 1]![1]) / (Math.PI / 4)) * Math.PI / 4
    const [x, z] = k === null ? [walk.end.x, walk.end.z] : walk.pts[k]!
    const end = { x, z, heading }
    return { ...joinInlet(shape, end), shape, end, y: k === null ? walk.end.y : walk.ys[k]!, halfWidth: walk.states[at]!.halfWidth, point }
}

/** The run in and bend radius that take a road heading along `at` onto `inlet`'s join, whatever they come to; null when it heads another way. */
function solveMerge(at: Pose, inlet: Inlet): Merge | null {
    if (Math.abs(wrapAngle(at.heading - inlet.heading)) > HEADING_TOLERANCE) return null
    // The join's end is the run in along the diagonal plus the bend's sweep per metre of radius; solved for both.
    const a = [Math.sin(inlet.heading), -Math.cos(inlet.heading)] as const
    const side = mergeSide(inlet.shape)
    const v = [side * (Math.cos(inlet.heading) - Math.cos(inlet.end.heading)), side * (Math.sin(inlet.heading) - Math.sin(inlet.end.heading))] as const
    const d = [inlet.end.x - at.x, inlet.end.z - at.z] as const
    const det = a[0] * v[1] - a[1] * v[0]
    return { runIn: (d[0] * v[1] - d[1] * v[0]) / det, radius: (a[0] * d[1] - a[1] * d[0]) / det }
}

const inRange = (radius: number) => radius >= MIN_MERGE_RADIUS - MEET_TOLERANCE && radius <= MAX_MERGE_RADIUS + MEET_TOLERANCE
const settled = ({ runIn, radius }: Merge): Merge => ({ runIn: Math.max(0, runIn), radius: Math.min(MAX_MERGE_RADIUS, Math.max(MIN_MERGE_RADIUS, radius)) })

/** The run in and bend that take a road heading along `at` into `inlet`'s join, or null when no bend in range does it. */
export function mergeFrom(at: Pose, inlet: Inlet): Merge | null {
    const merge = solveMerge(at, inlet)
    return merge && inRange(merge.radius) && merge.runIn >= -MEET_TOLERANCE ? settled(merge) : null
}

/** How a road ending at `end` meets an inlet: how it comes in when it does, or how far off it is and, when it's lined up but can't, why. */
export type InletMeet = Merge | { runIn: null, metres: number, why: string | null }

export function meetInlet(end: RoadState & { x: number, z: number, heading: number, y: number }, inlet: Inlet): InletMeet {
    const merge = solveMerge(end, inlet)
    if (!merge || !inRange(merge.radius)) return { runIn: null, metres: Math.hypot(end.x - inlet.x, end.z - inlet.z), why: null }
    if (merge.runIn < -MEET_TOLERANCE) return { runIn: null, metres: 0, why: 'runs past its join\'s bend: shorten it' }
    if (Math.abs(end.y - inlet.y) > MEET_TOLERANCE || end.bank || end.grade || end.air) return { runIn: null, metres: 0, why: 'has to come into its join flat and at its height' }
    if (Math.abs(end.halfWidth - inlet.halfWidth) > 1e-6) return { runIn: null, metres: 0, why: 'has to come into its join as wide as that road' }
    return settled(merge)
}
