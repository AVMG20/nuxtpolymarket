import { Track, type TrackDef, type TrackGroup } from './track'

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
 *
 * Stunt pieces, after Trackmania: a jump is a kicker, a gap with no road and a
 * landing ramp; a looping goes up and over, upside down at the top, and comes
 * out a road width to the side; a corkscrew rolls the road a full turn round
 * an axis above it; a banked corner tilts the road into the bend. Loopings
 * and corkscrews are driven on rails (`TrackDef.rails`), since their ground
 * plan overlaps itself or turns the road on its side.
 */

export type LineBlock = 'start' | 'finish' | 'checkpoint'

export type TrackPiece =
    | { type: 'straight', length: number }
    | { type: 'corner', turn: 'left' | 'right', radius: number, angle: number, bank?: number }
    | { type: 'ramp', length: number, rise: number }
    | { type: 'spiral', turn: 'left' | 'right', radius: number, angle: number, rise: number }
    | { type: 'jump', rise: number, gap: number }
    | { type: 'looping', side: 'left' | 'right', radius: number }
    | { type: 'corkscrew', turn: 'left' | 'right', length: number }
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
/** Road to road where one passes over another: the deck, the car, the chase camera and a line's arch fit between; a half spiral climbs it. */
export const MIN_CLEARANCE = 6
/** Spacing, from the origin, of the grid a bend off a diagonal lands back on. */
export const GRID = 10
/** Steepest grade of a jump's kicker, at its lip; the kicker is as long as that takes, in whole grid steps. */
export const KICKER_GRADE = 0.15
export const LANDING_LENGTH = 60
/** How far a looping comes out to the side of where it went in: clear of its own entry. */
export const LOOPING_SHIFT = 30
/** Height of a corkscrew's axis above the road: the road rolls round it. */
export const CORKSCREW_AXIS = 10
/** Share of a banked corner spent rolling into its bank, and again out of it. */
const BANK_EASE = 0.3

export const straight = (length: number): TrackPiece => ({ type: 'straight', length })
/** A bend of `angle` degrees, in steps of 45, banked `bank` degrees into the turn. */
export const corner = (turn: 'left' | 'right', radius: number, angle = 90, bank = 0): TrackPiece => bank ? { type: 'corner', turn, radius, angle, bank } : { type: 'corner', turn, radius, angle }
/** A straight that climbs `rise` metres, or falls with a negative rise. */
export const ramp = (length: number, rise: number): TrackPiece => ({ type: 'ramp', length, rise })
/** A bend of `angle` degrees climbing `rise` metres over the lot; past 360 it passes over itself. */
export const spiral = (turn: 'left' | 'right', radius: number, angle: number, rise: number): TrackPiece => ({ type: 'spiral', turn, radius, angle, rise })
/** A kicker up `rise` metres, a `gap` metre gap with no road, then a landing ramp back down. */
export const jump = (rise: number, gap: number): TrackPiece => ({ type: 'jump', rise, gap })
/** A full vertical loop of `radius`, coming out `LOOPING_SHIFT` metres to `side`. */
export const looping = (side: 'left' | 'right', radius: number): TrackPiece => ({ type: 'looping', side, radius })
/** The road rolls a full turn toward `turn` over `length` metres. */
export const corkscrew = (turn: 'left' | 'right', length: number): TrackPiece => ({ type: 'corkscrew', turn, length })
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

/** Why a layout doesn't make a course; `reason` is the bare why, for showing a track builder. */
export class TrackLayoutError extends Error {
    constructor(readonly trackId: string, readonly reason: string) {
        super(`Track ${trackId}: ${reason}`)
        this.name = 'TrackLayoutError'
    }
}

export type Vec3 = [number, number, number]
const UP: Vec3 = [0, 1, 0]
const smooth = (t: number) => t * t * (3 - 2 * t)

/** A layout's pieces walked into a sampled line, before any check that it makes a course. */
export interface LayoutWalk {
    pts: [number, number][]
    ys: number[]
    /** The road's up at each point: straight up except on banks, loopings and corkscrews. */
    ups: Vec3[]
    /** Point ranges, [from, to), of loopings and corkscrews. */
    rails: [number, number][]
    /** Point ranges, [from, to), of jump gaps: no road there. */
    gaps: [number, number][]
    /** Each line block and the index of the point its line crosses. */
    lines: { type: LineBlock, at: number }[]
    /** The index of each piece's first point. */
    pieceStarts: number[]
    /** Where the last piece ends. */
    end: { x: number, z: number, heading: number, y: number }
}

/**
 * Lays the pieces end to end. Only a malformed piece throws: the walk itself
 * doesn't care whether the course closes, so a builder can draw it half done.
 */
export function walkLayout(layout: TrackLayout): LayoutWalk {
    const fail = (why: string): never => {
        throw new TrackLayoutError(layout.id, why)
    }
    const pts: [number, number][] = []
    const ys: number[] = []
    const ups: Vec3[] = []
    const rails: [number, number][] = []
    const gaps: [number, number][] = []
    const lines: { type: LineBlock, at: number }[] = []
    let { x, z, heading: h } = layout.origin
    // Courses begin on the ground.
    let y = 0

    const push = (px: number, pz: number, py: number, up = UP) => {
        pts.push([px, pz])
        ys.push(py)
        ups.push(up)
    }
    /** A straight, climbing `rise` along `profile` (0 to 1 over the length). */
    const run = (length: number, rise = 0, profile = climbAt) => {
        const n = Math.max(1, Math.round(length / STEP))
        const dx = Math.sin(h)
        const dz = -Math.cos(h)
        for (let i = 0; i < n; i++) push(x + dx * length * i / n, z + dz * length * i / n, y + rise * profile(length * i / n, length))
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
    const bend = (side: number, radius: number, eighths: number, rise = 0, bank = 0) => {
        const out = h + side * Math.PI / 4 * eighths
        if (onAxis(h) || !onAxis(out)) return turn(side, radius, eighths, rise, bank)
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
        turn(side, radius, eighths, rise, bank)
        pad(after)
    }
    // A sliver of a straight only stretches the segment it continues, so it leaves no near-zero segment behind.
    const pad = (length: number) => {
        if (length >= STEP / 2) return run(length)
        x += Math.sin(h) * length
        z -= Math.cos(h) * length
    }
    const turn = (side: number, radius: number, eighths: number, rise = 0, bank = 0) => {
        // Right of the heading is (cos h, sin h); the centre lies `radius` toward the turn.
        const cx = x + Math.cos(h) * radius * side
        const cz = z + Math.sin(h) * radius * side
        // Sampled per quarter as before eighths existed, so the older courses keep their exact lengths.
        const n = Math.max(2, Math.round(Math.max(4, Math.round(radius * Math.PI / 2 / STEP)) * eighths / 2))
        const sweep = Math.PI / 4 * eighths
        const length = radius * sweep
        const at = (a: number) => [cx - Math.cos(a) * radius * side, cz - Math.sin(a) * radius * side] as [number, number]
        for (let i = 0; i < n; i++) {
            const a = h + side * sweep * i / n
            const [px, pz] = at(a)
            // A bank tips the road's up toward the centre of the turn, rolling in and out at the ends.
            const t = i / n
            const b = bank * Math.PI / 180 * smooth(Math.min(1, t / BANK_EASE, (1 - t) / BANK_EASE))
            push(px, pz, y + rise * climbAt(length * i / n, length), b ? [Math.sin(b) * side * Math.cos(a), Math.cos(b), Math.sin(b) * side * Math.sin(a)] : UP)
        }
        h += side * sweep
        const end = at(h)
        x = end[0]
        z = end[1]
        y += rise
    }

    const jumpOver = (rise: number, gap: number) => {
        // The kicker steepens all the way to its lip, so the car leaves it climbing.
        run(Math.ceil(2 * rise / KICKER_GRADE / GRID) * GRID, rise, (d, length) => (d / length) * (d / length))
        const from = pts.length
        run(gap)
        gaps.push([from, pts.length])
        run(LANDING_LENGTH, -rise)
    }
    const loopOver = (side: number, radius: number) => {
        const [dx, dz] = [Math.sin(h), -Math.cos(h)]
        const [rx, rz] = [Math.cos(h), Math.sin(h)]
        const from = pts.length
        const n = Math.max(8, Math.round(2 * Math.PI * radius / STEP))
        for (let i = 0; i < n; i++) {
            const a = 2 * Math.PI * i / n
            const ahead = radius * Math.sin(a)
            const lat = side * LOOPING_SHIFT * smooth(i / n)
            // Up points at the loop's centre: upside down at the top.
            push(x + dx * ahead + rx * lat, z + dz * ahead + rz * lat, y + radius * (1 - Math.cos(a)), [-Math.sin(a) * dx, Math.cos(a), -Math.sin(a) * dz])
        }
        rails.push([from, pts.length])
        x += rx * side * LOOPING_SHIFT
        z += rz * side * LOOPING_SHIFT
    }
    const screw = (side: number, length: number) => {
        const [dx, dz] = [Math.sin(h), -Math.cos(h)]
        const [rx, rz] = [Math.cos(h), Math.sin(h)]
        const from = pts.length
        const n = Math.max(8, Math.round(length / STEP))
        for (let i = 0; i < n; i++) {
            const t = i / n
            // The roll eases in and out, a full turn over the length.
            const roll = 2 * Math.PI * t - Math.sin(2 * Math.PI * t)
            // The road turns round an axis above it, so it stays the floor of a tube the car runs inside.
            const lat = -side * CORKSCREW_AXIS * Math.sin(roll)
            push(x + dx * length * t + rx * lat, z + dz * length * t + rz * lat, y + CORKSCREW_AXIS * (1 - Math.cos(roll)), [side * Math.sin(roll) * rx, Math.cos(roll), side * Math.sin(roll) * rz])
        }
        rails.push([from, pts.length])
        x += dx * length
        z += dz * length
    }

    const eighthsOf = (angle: number) => {
        if (!(angle > 0) || !Number.isInteger(angle / 45)) fail('a corner or spiral turns in steps of 45°')
        return angle / 45
    }
    const pieceStarts: number[] = []
    for (const piece of layout.pieces) {
        pieceStarts.push(pts.length)
        if (piece.type === 'straight') {
            if (!(piece.length > 0)) fail('a straight needs a positive length')
            run(piece.length)
        } else if (piece.type === 'corner') {
            if (!(piece.radius > layout.wallOffset)) fail('a corner must be wider than the track')
            if (piece.bank !== undefined && !(Math.abs(piece.bank) < 60)) fail('a bank tilts less than 60°')
            bend(piece.turn === 'right' ? 1 : -1, piece.radius, eighthsOf(piece.angle), 0, piece.bank ?? 0)
        } else if (piece.type === 'ramp') {
            if (!(piece.length > EASE_LENGTH * 2)) fail(`a ramp needs to be longer than ${EASE_LENGTH * 2} m`)
            run(piece.length, piece.rise)
        } else if (piece.type === 'spiral') {
            if (!(piece.radius > layout.wallOffset)) fail('a spiral must be wider than the track')
            bend(piece.turn === 'right' ? 1 : -1, piece.radius, eighthsOf(piece.angle), piece.rise)
        } else if (piece.type === 'jump') {
            if (!(piece.rise > 0) || !(piece.gap > 0)) fail('a jump needs a rise and a gap')
            jumpOver(piece.rise, piece.gap)
        } else if (piece.type === 'looping') {
            if (!(piece.radius >= 15)) fail('a looping needs a radius of at least 15 m')
            loopOver(piece.side === 'right' ? 1 : -1, piece.radius)
        } else if (piece.type === 'corkscrew') {
            if (!(piece.length >= 100)) fail('a corkscrew needs at least 100 m')
            screw(piece.turn === 'right' ? 1 : -1, piece.length)
        } else {
            run(LINE_BLOCK_LENGTH / 2)
            lines.push({ type: piece.type, at: pts.length })
            run(LINE_BLOCK_LENGTH / 2)
        }
    }
    return { pts, ys, ups, rails, gaps, lines, pieceStarts, end: { x, z, heading: h, y } }
}

export function buildTrack(layout: TrackLayout): TrackDef {
    const closed = layout.closed !== false
    const fail = (why: string): never => {
        throw new TrackLayoutError(layout.id, why)
    }
    const { pts, ys, ups, rails, gaps, lines, end: { x, z, heading: h, y } } = walkLayout(layout)

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
        ups.push(UP)
    }
    if (ys.some(v => v < -CLOSE_TOLERANCE)) fail('the road dips below the ground')
    const startAt = lines.find(l => l.type === 'start')!.at
    checkClearance(pts, ys, closed, layout.wallOffset, fail)

    // A loop is rotated to begin at the start line, where its lap clock reads zero.
    const shift = closed ? startAt : 0
    const rotate = <T>(a: T[]) => closed ? [...a.slice(shift), ...a.slice(0, shift)] : a
    const n = pts.length
    // A range never holds the start line, so once rotated it doesn't wrap the seam.
    const reindex = ([from, to]: [number, number]): [number, number] => {
        const at = (from - shift + n) % n
        return [at, at + to - from]
    }
    const heights = rotate(ys)
    const def: TrackDef = { id: layout.id, name: layout.name, group: layout.group, points: rotate(pts), halfWidth: layout.halfWidth, wallOffset: layout.wallOffset }
    if (heights.some(v => v !== 0)) def.heights = heights.map(v => Math.max(0, Math.round(v * 1000) / 1000))
    if (ups.some(u => u !== UP)) def.ups = rotate(ups).map(u => u.map(c => Math.round(c * 1e4) / 1e4) as Vec3)
    if (rails.length) def.rails = rails.map(reindex)
    if (gaps.length) def.gaps = gaps.map(reindex)
    if (!closed) def.closed = false
    // Distances as the track measures them: along the ground, except on rails, where it's the road itself.
    const cum = new Track(def).cum
    const sAt = (at: number) => cum[(at - shift + n) % n]!
    const startS = sAt(startAt)
    let finishS = Infinity
    if (!closed) {
        finishS = sAt(lines.find(l => l.type === 'finish')!.at)
        if (finishS < startS) fail('the finish comes before the start')
        const length = cum[n - 1]!
        if (startS < MIN_RUN_UP) fail(`needs at least ${MIN_RUN_UP} m before the start line`)
        if (length - finishS < MIN_RUN_OFF) fail(`needs at least ${MIN_RUN_OFF} m after the finish line`)
        def.runUp = startS
        def.runOff = length - finishS
    }
    const checkpoints = lines.filter(l => l.type === 'checkpoint').map(l => sAt(l.at)).sort((a, b) => a - b)
    if (checkpoints.some(s => s <= startS || s >= finishS)) fail('every checkpoint must lie between the start and the finish')
    if (checkpoints.length) def.checkpoints = checkpoints
    return def
}

/** Wherever two stretches of road far apart along the course cover the same ground, one must pass over the other with room to drive under. */
function checkClearance(pts: [number, number][], ys: number[], closed: boolean, wallOffset: number, fail: (why: string) => never) {
    const n = pts.length
    // Deck edge to deck edge, with the wall's footprint on both.
    const reach = (wallOffset + 1) * 2
    // Closer than this along the road, two points are the same stretch bending (a hairpin), not a crossing.
    const apart = Math.ceil(reach * 3 / STEP)
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
            if (j < i + apart) continue
            if (closed && n - (j - i) < apart) continue
            const dx = pts[i]![0] - pts[j]![0]
            const dz = pts[i]![1] - pts[j]![1]
            if (dx * dx + dz * dz >= reach * reach) continue
            const dy = Math.abs(ys[i]! - ys[j]!)
            if (dy < MIN_CLEARANCE - CLOSE_TOLERANCE) fail(`the road at (${pts[i]![0].toFixed(0)}, ${pts[i]![1].toFixed(0)}) passes ${dy.toFixed(1)} m from another stretch; it needs ${MIN_CLEARANCE} m`)
        }
    }
}
