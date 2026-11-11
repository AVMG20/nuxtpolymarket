import { GHOST_POSE, type Ghost } from './ghost'
import { LapTimer } from './timing'
import { FALL_DEPTH, KICKER_GRADE, newProjection, SPEED_CEILING, wallFoot, type LapLine, type Track, type TrackLine } from './track'

/**
 * Whether a ghost really drove a course. Without jumps or forks every pose is on the road, moving through it in
 * order from start to finish. With jumps a car can fly over the walls onto other road, and with forks it can take
 * any branch, so poses have to stay in reach along the road while on it, take off only at a gap, fly no faster or
 * higher than a kicker throws the car, and cross lines the way the lap timer counts them.
 */

/** Past the walls by more than this, a pose has left the road; loose enough for railed and banked road. */
export const OFF_ROAD_SLACK = 10
/** Metres a pose may sit below the road past the physics' fall depth: pose rounding and a landing's last step. */
export const BELOW_ROAD_SLACK = 2
/** The first pose sits this close to the start line along the road; a standing lap starts on the grid 14 m behind it. */
export const START_SLACK = 30
/** The last pose sits this close to the finish line along the road. */
export const FINISH_SLACK = 15
/** Metres on top of twice the top speed's travel that a pose may move along the road from the one before. */
export const STEP_SLACK = 10

interface Hit {
    /** Distance along the road, unwrapped on a loop. */
    s: number
    /** How far off the road: in 3D on rails, across the ground plan elsewhere. */
    off: number
    /** Metres below the lowest the car could be there, off rails; 0 or less is fine. */
    below: number
}

/**
 * The road nearest (x, y, z) between distances `from` and `to` (unwrapped on a loop). Rails are matched in 3D and win
 * when close enough, since a looping's plan overlaps the road around it; elsewhere a flight can sit any height above.
 */
function nearestAlong(track: Track, x: number, y: number, z: number, from: number, to: number, maxOff: number): Hit | null {
    const { xs, ys, zs, cum, segments, n, railed, right } = track
    let rail: Hit | null = null
    let plan: Hit | null = null
    if (!track.closed) {
        from = Math.max(0, from)
        to = Math.min(track.length, to)
        if (from > to) return null
    }
    let i = track.segmentAt(from)
    let base = track.closed ? from - track.wrapS(from) : 0
    for (let steps = 0; steps <= segments; steps++) {
        const a = cum[i]!
        const b = cum[i + 1]!
        if (base + a > to) break
        const j = (i + 1) % n
        const ax = xs[i]!, ay = ys[i]!, az = zs[i]!
        const dx = xs[j]! - ax, dy = ys[j]! - ay, dz = zs[j]! - az
        if (railed[i]) {
            const len2 = dx * dx + dy * dy + dz * dz || 1
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2))
            const off = Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t)
            if (!rail || off < rail.off) rail = { s: base + a + (b - a) * t, off, below: 0 }
        } else {
            const len2 = dx * dx + dz * dz || 1
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
            const off = Math.hypot(x - ax - dx * t, z - az - dz * t)
            if (!plan || off < plan.off) {
                // A banked road's surface drops toward its low side; allow for it at the widest offset.
                const bank = Math.max(bankSlope(right, i), bankSlope(right, j)) * maxOff
                const floor = ay + dy * t - bank - FALL_DEPTH - BELOW_ROAD_SLACK
                plan = { s: base + a + (b - a) * t, off, below: floor - y }
            }
        }
        if (++i >= segments) {
            if (!track.closed) break
            i = 0
            base += track.length
        }
    }
    return rail && rail.off <= maxOff ? rail : plan ?? rail
}

/** Rise of the road's surface per metre across the plan at point `i`. */
function bankSlope(right: Float64Array, i: number) {
    const k = i * 3
    return Math.abs(right[k + 1]!) / Math.max(0.1, Math.hypot(right[k]!, right[k + 2]!))
}

/** Metres a pose may sit above the road's surface, or below it, and still be driving on it: rounding, a landing's last step, a bank's tilt. */
const ON_ROAD_ABOVE = 2.5
const ON_ROAD_BELOW = 2
/** Metres a flight may top the highest a kicker at the speed ceiling could throw the car, for rounding. */
const FLIGHT_SLACK = 1
/** Metres on top of the speed ceiling's travel that a pose in the air may move from the one before: pose rounding. */
const FLIGHT_STEP_SLACK = 1
/** Metres either side of a gap's end the last pose on the road before a flight may sit, past a pose step's travel. */
const LIP_SLACK = 3
/** Seconds a flight may pass within reach of the road below without landing and fly on. */
const SKIM_SECONDS = 1
/** How much a metre of height counts against a metre across when picking which of stacked roads a pose is on. */
const LEVEL_WEIGHT = 4
const GRAVITY = 9.81
const under = newProjection()

/** True when the ghost drove the course from start to finish, as far as its poses can show it. */
export function ghostDrivesTrack(track: Track, ghost: Ghost): boolean {
    return track.forked || track.gaps.length ? ghostFliesTrack(track, ghost) : ghostFollowsRoad(track, ghost)
}

/** True when every pose is on the road and no further along it than the car could go since the last, from start to finish. */
function ghostFollowsRoad(track: Track, ghost: Ghost): boolean {
    const count = ghost.data.length / GHOST_POSE
    if (count < 2) return false
    const reach = 2 * SPEED_CEILING / ghost.hz + STEP_SLACK
    const maxOff = track.maxWall + OFF_ROAD_SLACK
    const finish = track.closed ? track.startS + track.length : track.finishS
    let s = track.startS
    for (let k = 0; k < count; k++) {
        const i = k * GHOST_POSE
        const window = k === 0 ? START_SLACK : reach
        const hit = nearestAlong(track, ghost.data[i]!, ghost.data[i + 1]!, ghost.data[i + 2]!, s - window, s + window, maxOff)
        if (!hit || hit.off > track.wallAt(hit.s) + OFF_ROAD_SLACK || hit.below > 0) return false
        s = hit.s
    }
    return Math.abs(s - finish) <= FINISH_SLACK
}

interface RoadHit {
    /** The line it's on or over, and how far along it. */
    branch: number
    s: number
    /** On the road there, not flying over it or off it. */
    on: boolean
    /** Over the road out to the walls' outer foot, on it or in the air, not off to its side: where a line can count. */
    over: boolean
}

interface RoadSearch {
    best: number
    bestOver: number
    hit: RoadHit
    overHit: RoadHit | null
}

const newSearch = (): RoadSearch => ({ best: Infinity, bestOver: Infinity, hit: { branch: 0, s: 0, on: false, over: false }, overHit: null })

/**
 * The road a pose is on or over among `count` segments of `line` from `from`, into `found`: the nearest stretch, counting
 * height against stacked roads; only the stretches it's over count when there are any, so a flight high above isn't put
 * on road it already passed. Rails are matched in 3D.
 */
function searchLine(line: TrackLine, x: number, y: number, z: number, found: RoadSearch, from = 0, count = line.segments) {
    const { xs, ys, zs, cum, segments, n, railed, walls, right } = line
    for (let k = 0; k < count; k++) {
        const i = (from + k) % segments
        const j = (i + 1) % n
        const ax = xs[i]!, ay = ys[i]!, az = zs[i]!
        const dx = xs[j]! - ax, dy = ys[j]! - ay, dz = zs[j]! - az
        const reach = wallFoot(walls[i]!)
        let score: number
        let s: number
        let on: boolean
        let over: boolean
        if (railed[i]) {
            const len2 = dx * dx + dy * dy + dz * dz || 1
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2))
            const off = Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t)
            score = off * off
            s = cum[i]! + (cum[i + 1]! - cum[i]!) * t
            on = over = off <= reach + OFF_ROAD_SLACK
        } else {
            const len2 = dx * dx + dz * dz || 1
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
            const off = Math.hypot(x - ax - dx * t, z - az - dz * t)
            s = cum[i]! + (cum[i + 1]! - cum[i]!) * t
            // A bank tips the surface away from the centre's height, out to the wall.
            const across = Math.sign((x - ax) * -dz + (z - az) * dx) * Math.min(off, walls[i]!)
            const tilt = right[i * 3 + 1]! + (right[j * 3 + 1]! - right[i * 3 + 1]!) * t
            const above = y - (ay + dy * t + tilt * across)
            score = off * off + above * above * LEVEL_WEIGHT * LEVEL_WEIGHT
            over = off <= reach + 1
            on = over && above <= ON_ROAD_ABOVE && above >= -ON_ROAD_BELOW && !line.gapAt(s)
        }
        if (over && score < found.bestOver) {
            found.bestOver = score
            found.overHit = { branch: line.branch, s, on, over }
        }
        if (score < found.best) {
            found.best = score
            found.hit = { branch: line.branch, s, on, over }
        }
    }
    return found
}

/** The road a pose is on or over anywhere on the course. */
function roadAt(track: Track, x: number, y: number, z: number): RoadHit {
    const found = newSearch()
    for (const line of track.branches) searchLine(line, x, y, z, found)
    return found.overHit ?? found.hit
}

/** The road a pose is on, searched `span` metres either side of the road the pose before was on; the whole course after a flight, or when it left that road. */
function roadNear(track: Track, x: number, y: number, z: number, before: RoadHit, span: number): RoadHit {
    const line = track.branches[before.branch]!
    if (before.on && (!line.closed || 2 * span < line.length)) {
        const from = line.segmentAt(before.s - span)
        const to = line.segmentAt(before.s + span)
        const count = line.closed ? (to - from + line.segments) % line.segments + 1 : to - from + 1
        const found = searchLine(line, x, y, z, newSearch(), from, count)
        const hit = found.overHit ?? found.hit
        if (hit.on) return hit
    }
    return roadAt(track, x, y, z)
}

/** Metres a pose may climb or drop from the one before as it moves from one road onto another, both on the road. */
const CHANGE_CLIMB = 3

/**
 * A course with jumps or forks: every pose a step the car could make, on the road in reach of the last or in a flight off
 * a kicker no higher than it throws, and the lap closed by the lap timer's own rules: K checkpoints, then the line.
 */
function ghostFliesTrack(track: Track, ghost: Ghost): boolean {
    const count = ghost.data.length / GHOST_POSE
    if (count < 2) return false
    const dt = 1 / ghost.hz
    const reach = 2 * SPEED_CEILING * dt + STEP_SLACK
    const flightStep = SPEED_CEILING * dt + FLIGHT_STEP_SLACK
    const climb = SPEED_CEILING * KICKER_GRADE
    // Signed distance along line `b` from `a` to `c`, the short way round on a loop.
    const along = (b: number, a: number, c: number) => {
        const line = track.branches[b]!
        const d = c - a
        return line.closed ? d - Math.round(d / line.length) * line.length : d
    }
    // A car only takes off where the road runs out under it: a kicker's lip, or a landing ramp's foot backing off it.
    const nearLip = (hit: RoadHit) => track.branches[hit.branch]!.gaps.some(([a, b]) => {
        const toLip = along(hit.branch, hit.s, a)
        const fromEnd = along(hit.branch, b, hit.s)
        return (toLip >= -LIP_SLACK && toLip <= flightStep + LIP_SLACK) || (fromEnd >= -LIP_SLACK && fromEnd <= flightStep + LIP_SLACK)
    })
    const ending = track.lapLines.filter(l => track.closed ? l.kind === 'start' : l.kind === 'finish')
    /** The line that ends the lap on the pose's road, and how far ahead along it it lies. */
    const endAhead = (hit: RoadHit): { line: LapLine, d: number } | null => {
        let best: { line: LapLine, d: number } | null = null
        for (const line of ending) {
            if (line.branch !== hit.branch) continue
            const d = along(hit.branch, hit.s, line.s)
            if (!best || Math.abs(d) < Math.abs(best.d)) best = { line, d }
        }
        return best
    }
    const pose = (k: number) => [ghost.data[k * GHOST_POSE]!, ghost.data[k * GHOST_POSE + 1]!, ghost.data[k * GHOST_POSE + 2]!] as const
    const [x0, y0, z0] = pose(0)
    const first = roadAt(track, x0, y0, z0)
    const fromStart = first.branch === 0 ? along(0, track.startS, first.s) : Infinity
    if (!first.on || Math.abs(fromStart) > START_SLACK) return false
    // Behind the line by the timer's own test owes a crossing first: the grid, or a flying lap a hair short of it.
    const timer = new LapTimer(track, x0, y0, z0)
    let last = first
    // The last pose on the road before the latest flight's lip, and the last pose in the air.
    let launch: { k: number, y: number } | null = null
    let airK = -Infinity
    for (let k = 1; k < count; k++) {
        const [x, y, z] = pose(k)
        const [px, py, pz] = pose(k - 1)
        const moved = Math.hypot(x - px, y - py, z - pz)
        if (moved > reach || y < -ON_ROAD_BELOW) return false
        const hit = roadNear(track, x, y, z, last, reach)
        if (hit.on) {
            if (last.on && hit.branch === last.branch && Math.abs(along(hit.branch, last.s, hit.s)) > reach) return false
            // From one road onto another on the ground only where they meet, not up to a road stacked above.
            if (last.on && hit.branch !== last.branch && Math.abs(y - py) > CHANGE_CLIMB) return false
        } else {
            // A brief skim over road that drops away under the car is still the same flight.
            if (last.on) launch = nearLip(last) ? { k: k - 1, y: py } : (k - airK) * dt <= SKIM_SECONDS ? launch : null
            if (!launch) return false
            airK = k
            const t = (k - launch.k) * dt
            // As the physics has it: a car falls well below where it took off only onto road under it.
            const fell = y < launch.y - FALL_DEPTH - BELOW_ROAD_SLACK && !track.landing(x, y + ON_ROAD_BELOW, z, under)
            if (moved > flightStep || fell || y > launch.y + climb * t - GRAVITY * t * t / 2 + FLIGHT_SLACK) return false
        }
        last = hit
        if (timer.update(x, y, z, dt, hit.over).some(e => e.type === 'lap')) {
            const end = endAhead(hit)
            return k >= count - 2 && !!end && Math.abs(end.d) <= FINISH_SLACK
        }
    }
    // The last pose can sit a hair short of the line, as the no-gap check allows: carry it over.
    const end = endAhead(last)
    if (!end || !(end.d > 0 && end.d <= FINISH_SLACK)) return false
    // Straight on along the road, keeping its place across it: a carry to the line's centre is a sideways jump the timer won't count.
    const { line } = end
    const [x, y, z] = pose(count - 1)
    const carry = end.d + 0.01
    return timer.update(x + line.tx * carry, y, z + line.tz * carry, end.d / SPEED_CEILING, last.over).some(e => e.type === 'lap')
}
