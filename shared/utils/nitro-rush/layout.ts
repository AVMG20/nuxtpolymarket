// Type-only: track.ts builds its registry from this file, so a runtime import would be circular.
import type { TrackDef } from './track'

/**
 * Courses built from blocks, the way a track builder lays them: each piece
 * starts where the last one ended. `buildTrack` walks them into the sampled
 * centreline a `TrackDef` carries.
 *
 * A loop has one start block and no finish: crossing the start line again
 * completes the lap. An open course runs from its first piece to its last,
 * with a start and a finish block along it.
 */

export type LineBlock = 'start' | 'finish' | 'checkpoint'

export type TrackPiece =
    | { type: 'straight', length: number }
    | { type: 'corner', turn: 'left' | 'right', radius: number }
    | { type: LineBlock }

export interface TrackLayout {
    id: string
    name: string
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

export const straight = (length: number): TrackPiece => ({ type: 'straight', length })
/** A quarter turn. */
export const corner = (turn: 'left' | 'right', radius: number): TrackPiece => ({ type: 'corner', turn, radius })
export const start: TrackPiece = { type: 'start' }
export const finish: TrackPiece = { type: 'finish' }
export const checkpoint: TrackPiece = { type: 'checkpoint' }

export function buildTrack(layout: TrackLayout): TrackDef {
    const closed = layout.closed !== false
    const fail = (why: string): never => {
        throw new Error(`Track ${layout.id}: ${why}`)
    }
    const pts: [number, number][] = []
    const lines: { type: LineBlock, at: number }[] = []
    let { x, z, heading: h } = layout.origin

    const run = (length: number) => {
        const n = Math.max(1, Math.round(length / STEP))
        const dx = Math.sin(h)
        const dz = -Math.cos(h)
        for (let i = 0; i < n; i++) pts.push([x + dx * length * i / n, z + dz * length * i / n])
        x += dx * length
        z += dz * length
    }
    const turn = (side: number, radius: number) => {
        // Right of the heading is (cos h, sin h); the centre lies `radius` toward the turn.
        const cx = x + Math.cos(h) * radius * side
        const cz = z + Math.sin(h) * radius * side
        const n = Math.max(4, Math.round(radius * Math.PI / 2 / STEP))
        const at = (a: number) => [cx - Math.cos(a) * radius * side, cz - Math.sin(a) * radius * side] as [number, number]
        for (let i = 0; i < n; i++) pts.push(at(h + side * Math.PI / 2 * i / n))
        h += side * Math.PI / 2
        const end = at(h)
        x = end[0]
        z = end[1]
    }

    for (const piece of layout.pieces) {
        if (piece.type === 'straight') {
            if (!(piece.length > 0)) fail('a straight needs a positive length')
            run(piece.length)
        } else if (piece.type === 'corner') {
            if (!(piece.radius > layout.wallOffset)) fail('a corner must be wider than the track')
            turn(piece.turn === 'right' ? 1 : -1, piece.radius)
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
    } else {
        if (count('finish') !== 1) fail('an open course needs exactly one finish block')
        pts.push([x, z])
    }

    // A loop is rotated to begin at the start line, where its lap clock reads zero.
    const startAt = lines.find(l => l.type === 'start')!.at
    const shift = closed ? startAt : 0
    const points = closed ? [...pts.slice(shift), ...pts.slice(0, shift)] : pts
    const cum = [0]
    for (let i = 1; i < points.length; i++) {
        cum.push(cum[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]))
    }
    const sAt = (at: number) => cum[(at - shift + points.length) % points.length]!
    const startS = sAt(startAt)
    const def: TrackDef = { id: layout.id, name: layout.name, points, halfWidth: layout.halfWidth, wallOffset: layout.wallOffset }
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

/** Two 360 m straights joined by 75 m bends, run anticlockwise seen from above, with the start mid main straight. */
export const POLYTOWN_OVAL: TrackLayout = {
    id: 'polytown-oval',
    name: 'Polytown Oval',
    halfWidth: 9,
    wallOffset: 10.6,
    origin: { x: 75, z: LINE_BLOCK_LENGTH / 2, heading: 0 },
    pieces: [
        start,
        straight(170),
        corner('left', 75),
        corner('left', 75),
        straight(170),
        checkpoint,
        straight(170),
        corner('left', 75),
        corner('left', 75),
        straight(170)
    ]
}

/** A point-to-point sprint: two long straights joined by an S, a left then a right quarter. */
export const S_BEND_SPRINT: TrackLayout = {
    id: 's-bend-sprint',
    name: 'S-Bend Sprint',
    halfWidth: 9,
    wallOffset: 10.6,
    closed: false,
    origin: { x: 50, z: 470, heading: 0 },
    pieces: [
        straight(30),
        start,
        straight(300),
        corner('left', 50),
        corner('right', 50),
        checkpoint,
        straight(300),
        finish,
        // Room to brake to a stop from nitro top speed before the end barrier.
        straight(170)
    ]
}
