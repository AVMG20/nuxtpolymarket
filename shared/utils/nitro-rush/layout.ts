import type { TrackDef, TrackGroup } from './track'

/**
 * Courses built from blocks, the way a track builder lays them: each piece
 * starts where the last one ended. `buildTrack` walks them into the sampled
 * centreline a `TrackDef` carries.
 *
 * A loop has one start block and no finish: crossing the start line again
 * completes the lap. An open course runs from its first piece to its last,
 * with a start and a finish block along it.
 *
 * Corners and spirals turn in eighths (45°), so a straight after an odd number
 * of eighths runs on the diagonal. A bend that leaves a diagonal is padded with
 * short straights so the road comes back onto the grid, which lets a loop with
 * diagonals close on round lengths.
 *
 * Ramps and spirals change the road's height; every other piece holds it.
 * A loop has to come back down to where it started, and wherever the road
 * passes over itself the levels must be far enough apart to drive under.
 */

export type LineBlock = 'start' | 'finish' | 'checkpoint'

export type TrackPiece =
    | { type: 'straight', length: number }
    | { type: 'corner', turn: 'left' | 'right', radius: number, angle: number }
    | { type: 'ramp', length: number, rise: number }
    | { type: 'spiral', turn: 'left' | 'right', radius: number, angle: number, rise: number }
    | { type: LineBlock }

export interface TrackLayout {
    id: string
    name: string
    group: TrackGroup
    halfWidth: number
    /** Centreline to the face of the wall. */
    wallOffset: number
    /** False for a point-to-point sprint; loops are the default. */
    closed?: boolean
    /** Where the first piece begins. Heading 0 runs up the screen (-z); + turns right. */
    origin: { x: number, z: number, heading: number }
    pieces: TrackPiece[]
}

/** Start, finish and checkpoint blocks are short straights with their line across the middle. */
export const LINE_BLOCK_LENGTH = 20
const STEP = 2
/** Room for the grid behind the start line, and to stop after the finish. */
const MIN_RUN_UP = 20
const MIN_RUN_OFF = 60
const CLOSE_TOLERANCE = 0.01
/** Metres a ramp or spiral takes to ease into its slope and back out of it. */
const EASE_LENGTH = 30
/** Road to road where one passes over another: the deck, the car and the chase camera fit between. */
export const MIN_CLEARANCE = 6.5
/** Open sky a line block needs above it for its gantry. */
const GANTRY_CLEARANCE = 11
/** Spacing, from the origin, of the grid a bend off a diagonal lands back on. */
export const GRID = 10

export const straight = (length: number): TrackPiece => ({ type: 'straight', length })
/** A bend of `angle` degrees, in steps of 45. */
export const corner = (turn: 'left' | 'right', radius: number, angle = 90): TrackPiece => ({ type: 'corner', turn, radius, angle })
/** A straight that climbs `rise` metres, or falls with a negative rise. */
export const ramp = (length: number, rise: number): TrackPiece => ({ type: 'ramp', length, rise })
/** A bend of `angle` degrees climbing `rise` metres over the lot; past 360 it passes over itself. */
export const spiral = (turn: 'left' | 'right', radius: number, angle: number, rise: number): TrackPiece => ({ type: 'spiral', turn, radius, angle, rise })
export const start: TrackPiece = { type: 'start' }
export const finish: TrackPiece = { type: 'finish' }
export const checkpoint: TrackPiece = { type: 'checkpoint' }

/**
 * How far up its rise a slope is `d` metres into a `length` metre piece. The grade eases in
 * over the first stretch, holds, and eases out over the last, so pieces meet without a kink.
 */
export function climbAt(d: number, length: number) {
    const e = Math.min(EASE_LENGTH, length / 2)
    const g = 1 / (length - e)
    if (d <= e) return g * d * d / (2 * e)
    if (d >= length - e) return 1 - g * (length - d) * (length - d) / (2 * e)
    return g * (d - e / 2)
}

export function buildTrack(layout: TrackLayout): TrackDef {
    const closed = layout.closed !== false
    const fail = (why: string): never => {
        throw new Error(`Track ${layout.id}: ${why}`)
    }
    const pts: [number, number][] = []
    const ys: number[] = []
    const lines: { type: LineBlock, at: number }[] = []
    let { x, z, heading: h } = layout.origin
    // Courses begin on the ground.
    let y = 0

    const run = (length: number, rise = 0) => {
        const n = Math.max(1, Math.round(length / STEP))
        const dx = Math.sin(h)
        const dz = -Math.cos(h)
        for (let i = 0; i < n; i++) {
            pts.push([x + dx * length * i / n, z + dz * length * i / n])
            ys.push(y + rise * climbAt(length * i / n, length))
        }
        x += dx * length
        z += dz * length
        y += rise
    }
    const onAxis = (a: number) => Math.abs(Math.sin(2 * a)) < 1e-9
    // Metres from `v` on to the next grid line, going up.
    const toGrid = (v: number) => {
        const r = ((-v % GRID) + GRID) % GRID
        return r < 1e-6 || r > GRID - 1e-6 ? 0 : r
    }
    const bend = (side: number, radius: number, eighths: number, rise = 0) => {
        const out = h + side * Math.PI / 4 * eighths
        if (onAxis(h) || !onAxis(out)) return turn(side, radius, eighths, rise)
        // Off a diagonal onto an axis: a diagonal straight first sets the cross-track coordinate, an axis straight after sets the other.
        const [dx, dz] = [Math.sin(h), -Math.cos(h)]
        const [ox, oz] = [Math.sin(out), -Math.cos(out)]
        const cx = x + Math.cos(h) * radius * side
        const cz = z + Math.sin(h) * radius * side
        const ex = cx - Math.cos(out) * radius * side - layout.origin.x
        const ez = cz - Math.sin(out) * radius * side - layout.origin.z
        const alongX = Math.abs(ox) > 0.5
        const cross = alongX ? ez : ex
        const crossRate = alongX ? dz : dx
        const before = toGrid(crossRate > 0 ? cross : -cross) / Math.abs(crossRate)
        const along = (alongX ? ex + dx * before : ez + dz * before) * (alongX ? ox : oz)
        const after = toGrid(along)
        pad(before)
        turn(side, radius, eighths, rise)
        pad(after)
    }
    // A sliver of a straight only stretches the segment it continues, so it leaves no near-zero segment behind.
    const pad = (length: number) => {
        if (length >= STEP / 2) return run(length)
        x += Math.sin(h) * length
        z -= Math.cos(h) * length
    }
    const turn = (side: number, radius: number, eighths: number, rise = 0) => {
        // Right of the heading is (cos h, sin h); the centre lies `radius` toward the turn.
        const cx = x + Math.cos(h) * radius * side
        const cz = z + Math.sin(h) * radius * side
        // Sampled per quarter as before eighths existed, so the older courses keep their exact lengths.
        const n = Math.max(2, Math.round(Math.max(4, Math.round(radius * Math.PI / 2 / STEP)) * eighths / 2))
        const sweep = Math.PI / 4 * eighths
        const length = radius * sweep
        const at = (a: number) => [cx - Math.cos(a) * radius * side, cz - Math.sin(a) * radius * side] as [number, number]
        for (let i = 0; i < n; i++) {
            pts.push(at(h + side * sweep * i / n))
            ys.push(y + rise * climbAt(length * i / n, length))
        }
        h += side * sweep
        const end = at(h)
        x = end[0]
        z = end[1]
        y += rise
    }

    const eighthsOf = (angle: number) => {
        if (!(angle > 0) || !Number.isInteger(angle / 45)) fail('a corner or spiral turns in steps of 45°')
        return angle / 45
    }
    for (const piece of layout.pieces) {
        if (piece.type === 'straight') {
            if (!(piece.length > 0)) fail('a straight needs a positive length')
            run(piece.length)
        } else if (piece.type === 'corner') {
            if (!(piece.radius > layout.wallOffset)) fail('a corner must be wider than the track')
            bend(piece.turn === 'right' ? 1 : -1, piece.radius, eighthsOf(piece.angle))
        } else if (piece.type === 'ramp') {
            if (!(piece.length > EASE_LENGTH * 2)) fail(`a ramp needs to be longer than ${EASE_LENGTH * 2} m`)
            run(piece.length, piece.rise)
        } else if (piece.type === 'spiral') {
            if (!(piece.radius > layout.wallOffset)) fail('a spiral must be wider than the track')
            bend(piece.turn === 'right' ? 1 : -1, piece.radius, eighthsOf(piece.angle), piece.rise)
        } else {
            run(LINE_BLOCK_LENGTH / 2)
            lines.push({ type: piece.type, at: pts.length })
            run(LINE_BLOCK_LENGTH / 2)
        }
    }

    const count = (type: LineBlock) => lines.filter(l => l.type === type).length
    if (count('start') !== 1) fail('needs exactly one start block')
    if (closed) {
        if (count('finish') > 0) fail('a loop has no finish block; the start line ends each lap')
        if (Math.hypot(x - layout.origin.x, z - layout.origin.z) > CLOSE_TOLERANCE || Math.cos(h - layout.origin.heading) < 1 - 1e-9) {
            fail(`the pieces end at (${x.toFixed(2)}, ${z.toFixed(2)}) instead of closing the loop`)
        }
        if (Math.abs(y) > CLOSE_TOLERANCE) fail(`the loop ends ${y.toFixed(2)} m off the ground instead of back where it began`)
    } else {
        if (count('finish') !== 1) fail('an open course needs exactly one finish block')
        pts.push([x, z])
        ys.push(y)
    }
    if (ys.some(v => v < -CLOSE_TOLERANCE)) fail('the road dips below the ground')
    const startAt = lines.find(l => l.type === 'start')!.at
    // The grandstand stands on the ground beside the start line.
    if (Math.abs(ys[startAt]!) > CLOSE_TOLERANCE) fail('the start line must sit on the ground')
    checkClearance(pts, ys, closed, lines.map(l => l.at), layout.wallOffset, fail)

    // A loop is rotated to begin at the start line, where its lap clock reads zero.
    const shift = closed ? startAt : 0
    const points = closed ? [...pts.slice(shift), ...pts.slice(0, shift)] : pts
    const heights = closed ? [...ys.slice(shift), ...ys.slice(0, shift)] : ys
    const cum = [0]
    for (let i = 1; i < points.length; i++) {
        cum.push(cum[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]))
    }
    const sAt = (at: number) => cum[(at - shift + points.length) % points.length]!
    const startS = sAt(startAt)
    const def: TrackDef = { id: layout.id, name: layout.name, group: layout.group, points, halfWidth: layout.halfWidth, wallOffset: layout.wallOffset }
    if (heights.some(v => v !== 0)) def.heights = heights.map(v => Math.max(0, Math.round(v * 1000) / 1000))
    let finishS = Infinity
    if (!closed) {
        finishS = sAt(lines.find(l => l.type === 'finish')!.at)
        if (finishS < startS) fail('the finish comes before the start')
        const length = cum[cum.length - 1]!
        if (startS < MIN_RUN_UP) fail(`needs at least ${MIN_RUN_UP} m before the start line`)
        if (length - finishS < MIN_RUN_OFF) fail(`needs at least ${MIN_RUN_OFF} m after the finish line`)
        def.closed = false
        def.runUp = startS
        def.runOff = length - finishS
    }
    const checkpoints = lines.filter(l => l.type === 'checkpoint').map(l => sAt(l.at)).sort((a, b) => a - b)
    if (checkpoints.some(s => s <= startS || s >= finishS)) fail('every checkpoint must lie between the start and the finish')
    if (checkpoints.length) def.checkpoints = checkpoints
    return def
}

/**
 * Wherever two stretches of road far apart along the course cover the same ground, one must
 * pass over the other with room to drive under, and no gantry may have road just above it.
 */
function checkClearance(pts: [number, number][], ys: number[], closed: boolean, lineAt: number[], wallOffset: number, fail: (why: string) => never) {
    const n = pts.length
    // Deck edge to deck edge, with the wall's footprint on both.
    const reach = (wallOffset + 1) * 2
    // Closer than this along the road, two points are the same stretch bending (a hairpin), not a crossing.
    const apart = Math.ceil(reach * 3 / STEP)
    const lineSet = new Set(lineAt)
    for (let i = 0; i < n; i++) {
        for (let j = i + apart; j < n; j++) {
            if (closed && n - (j - i) < apart) continue
            const dx = pts[i]![0] - pts[j]![0]
            const dz = pts[i]![1] - pts[j]![1]
            if (dx * dx + dz * dz >= reach * reach) continue
            const dy = Math.abs(ys[i]! - ys[j]!)
            if (dy < MIN_CLEARANCE) fail(`the road at (${pts[i]![0].toFixed(0)}, ${pts[i]![1].toFixed(0)}) passes ${dy.toFixed(1)} m from another stretch; it needs ${MIN_CLEARANCE} m`)
            const low = ys[i]! < ys[j]! ? i : j
            if (lineSet.has(low) && dy < GANTRY_CLEARANCE) fail('a line block needs open sky above it for its gantry')
        }
    }
}
