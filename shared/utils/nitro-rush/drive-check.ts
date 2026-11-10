import { GHOST_POSE, type Ghost } from './ghost'
import { KICKER_GRADE } from './layout'
import { LapTimer } from './timing'
import { FALL_DEPTH, newProjection, SPEED_CEILING, wallFoot, type Track } from './track'

/**
 * Whether a ghost really drove a course. Without jumps every pose is on the road, moving through it in order
 * from start to finish. With them a car can fly over the walls onto other road, so poses have to stay in reach
 * along the road while on it, take off only at a gap, fly no faster or higher than a kicker throws the car, and
 * cross every line in order along the road.
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
    return track.gaps.length ? ghostFliesTrack(track, ghost) : ghostFollowsRoad(track, ghost)
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
    s: number
    /** On the road there, not flying over it or off it. */
    on: boolean
    /** Over the road out to the walls' outer foot, on it or in the air, not off to its side: where a line can count. */
    over: boolean
}

/**
 * The road a pose is on or over among `count` segments from `from`: the nearest stretch, counting height against stacked roads;
 * only the stretches it's over count when there are any, so a flight high above isn't put on road it already passed. Rails are matched in 3D.
 */
function roadAt(track: Track, x: number, y: number, z: number, from = 0, count = track.segments): RoadHit {
    const { xs, ys, zs, cum, segments, n, railed, walls, right } = track
    let best = Infinity
    let bestOver = Infinity
    let hit: RoadHit = { s: 0, on: false, over: false }
    let overHit: RoadHit | null = null
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
            on = over && above <= ON_ROAD_ABOVE && above >= -ON_ROAD_BELOW && !track.gapAt(s)
        }
        if (over && score < bestOver) {
            bestOver = score
            overHit = { s, on, over }
        }
        if (score < best) {
            best = score
            hit = { s, on, over }
        }
    }
    return overHit ?? hit
}

/** The road a pose is on, searched `span` metres either side of the road the pose before was on; the whole course after a flight, or when it left that road. */
function roadNear(track: Track, x: number, y: number, z: number, before: RoadHit, span: number): RoadHit {
    if (before.on && (!track.closed || 2 * span < track.length)) {
        const from = track.segmentAt(before.s - span)
        const to = track.segmentAt(before.s + span)
        const count = track.closed ? (to - from + track.segments) % track.segments + 1 : to - from + 1
        const hit = roadAt(track, x, y, z, from, count)
        if (hit.on) return hit
    }
    return roadAt(track, x, y, z)
}

/** A course with jumps: every pose a step the car could make, on the road in reach of the last or in a flight off a kicker no higher than it throws, and every line crossed in order along the road. */
function ghostFliesTrack(track: Track, ghost: Ghost): boolean {
    const count = ghost.data.length / GHOST_POSE
    if (count < 2) return false
    const dt = 1 / ghost.hz
    const reach = 2 * SPEED_CEILING * dt + STEP_SLACK
    const flightStep = SPEED_CEILING * dt + FLIGHT_STEP_SLACK
    const climb = SPEED_CEILING * KICKER_GRADE
    const L = track.lapLength
    // Signed distance along the road from `a` to `b`, the short way round on a loop.
    const along = (a: number, b: number) => {
        const d = b - a
        return track.closed ? d - Math.round(d / track.length) * track.length : d
    }
    // Distances as the lap timer reads them: from the start line, half a lap either side on a loop.
    const fromStart = (s: number) => along(track.startS, s)
    const timerS = (s: number) => track.closed ? track.wrapS(s - track.startS) : s - track.startS
    // A car only takes off where the road runs out under it: a kicker's lip, or a landing ramp's foot backing off it.
    const nearLip = (s: number) => track.gaps.some(([a, b]) => {
        const toLip = along(s, a)
        const fromEnd = along(b, s)
        return (toLip >= -LIP_SLACK && toLip <= flightStep + LIP_SLACK) || (fromEnd >= -LIP_SLACK && fromEnd <= flightStep + LIP_SLACK)
    })
    const pose = (k: number) => [ghost.data[k * GHOST_POSE]!, ghost.data[k * GHOST_POSE + 1]!, ghost.data[k * GHOST_POSE + 2]!] as const
    const [x0, y0, z0] = pose(0)
    const first = roadAt(track, x0, y0, z0)
    if (!first.on || Math.abs(fromStart(first.s)) > START_SLACK) return false
    const timer = new LapTimer(L, track.closed, fromStart(first.s), track.checkpointDistances)
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
            if (last.on && Math.abs(along(last.s, hit.s)) > reach) return false
        } else {
            // A brief skim over road that drops away under the car is still the same flight.
            if (last.on) launch = nearLip(last.s) ? { k: k - 1, y: py } : (k - airK) * dt <= SKIM_SECONDS ? launch : null
            if (!launch) return false
            airK = k
            const t = (k - launch.k) * dt
            // As the physics has it: a car falls well below where it took off only onto road under it.
            const fell = y < launch.y - FALL_DEPTH - BELOW_ROAD_SLACK && !track.roadUnder(x, y + ON_ROAD_BELOW, z, under)
            if (moved > flightStep || fell || y > launch.y + climb * t - GRAVITY * t * t / 2 + FLIGHT_SLACK) return false
        }
        last = hit
        if (timer.update(timerS(hit.s), dt, hit.over).some(e => e.type === 'lap')) {
            return k >= count - 2 && Math.abs(fromStart(hit.s) - (track.closed ? 0 : L)) <= FINISH_SLACK
        }
    }
    // The last pose can sit a hair short of the line, as the no-gap check allows: carry it over.
    const short = (track.closed ? 0 : L) - fromStart(last.s)
    if (!(short > 0 && short <= FINISH_SLACK)) return false
    return timer.update(timerS(last.s + short), short / SPEED_CEILING, last.over).some(e => e.type === 'lap')
}
