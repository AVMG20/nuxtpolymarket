/**
 * Whether touching a wall ever pays in Nitro Rush, which it must not: the best clean line against the best line with any
 * contact, through every kind of bend, then over whole laps of the official courses with both lines optimised the same way.
 *
 *   ITER=2500 bun --tsconfig-override .nuxt/tsconfig.app.json scripts/nitro-rush-walls.ts [course name]
 */
import { buildTrack, corner, finish, LINE_BLOCK_LENGTH, start, straight } from '../shared/utils/nitro-rush/layout'
import { LapTimer } from '../shared/utils/nitro-rush/timing'
import { headingOf, Track, wrapAngle } from '../shared/utils/nitro-rush/track'
import { ROAD, TRACKS } from '../shared/utils/nitro-rush/tracks'
import { createSeededRandom } from '../shared/utils/random'
import { BRAKE_DECEL, GRIP_LATERAL, PHYSICS_HZ } from '../app/utils/nitro-rush/config'
import { botInput, createCar, stepCar, type CarInput, type CarState } from '../app/utils/nitro-rush/physics'

const DT = 1 / PHYSICS_HZ
const GRID = -14
/** Seconds a line must win by to count: the clean search is a coarse grid, not the true best line. */
const TIE = 0.05
let failures = 0
const clamp = (v: number) => Math.max(-1, Math.min(1, v))

/** The bend at `s`: + left, - right, 0 on a straight. */
function bendAt(track: Track, s: number) {
    const a = track.pointAt(s)
    const here = headingOf(a.tx, a.tz)
    const b = track.pointAt(s + 6)
    const turn = wrapAngle(headingOf(b.tx, b.tz) - here)
    return Math.abs(turn) < 0.01 ? 0 : Math.sign(turn)
}

/** The next bend's direction within `look` metres, so a driver can set up on its outside. */
function nextBend(track: Track, s: number, look: number) {
    for (let d = 0; d <= look; d += 5) {
        const bend = bendAt(track, s + d)
        if (bend) return bend
    }
    return 0
}

/** Flat out, chasing a point `lateral` off the centreline; + lateral is the right of the road, the outside of a left bend. */
function chase(car: CarState, track: Track, lateral: number): CarInput {
    const p = track.pointAt(car.proj.s + 8 + Math.max(0, car.speed) * 0.45)
    const want = headingOf(p.x - p.tz * lateral - car.x, p.z + p.tx * lateral - car.z)
    return { throttle: 1, brake: 0, steer: clamp(-wrapAngle(want - car.travel) * 4), drift: false }
}

/** What players do: set up on the outside, then gas and `wheel` held into the bend all the way round. */
const holdOn = (wheel: number, side = 0.8) => (car: CarState, track: Track): CarInput => {
    if (car.onRail) return botInput(car, track)
    const bend = bendAt(track, car.proj.s)
    if (bend) return { throttle: 1, brake: 0, steer: -bend * wheel, drift: false }
    return chase(car, track, nextBend(track, car.proj.s, 60) * track.wallOffset * side)
}

// ── One bend at a time ──

interface Run { time: number, onWall: number }

/** Seconds from `lead` metres before a bend to `lead` metres past it, arriving near top speed, and how many of them were spent on a wall. */
function runBend(track: Track, from: number, to: number, drive: (car: CarState) => CarInput): Run {
    const lead = 350
    const car = createCar(track, from - lead)
    car.speed = 70
    let time = 0
    let onWall = 0
    for (let i = 0; i < PHYSICS_HZ * 60 && car.proj.s < to + lead; i++) {
        const ev = stepCar(car, drive(car), track, DT)
        time += DT
        if (ev.scraping || ev.wallImpact > 0) onWall += DT
    }
    return { time: car.proj.s < to + lead ? Infinity : time, onWall }
}

/** Brakes as late as reaching the bend at `apexSpeed` allows, then back on the gas `gasAt` of the way round; `steered` picks the wheel. */
function onBrakesFirst(track: Track, from: number, to: number, apexSpeed: number, gasAt: number, steered: (car: CarState, track: Track) => CarInput) {
    return (car: CarState): CarInput => {
        const s = car.proj.s
        const v = Math.max(0, car.speed)
        const gas = from + (to - from) * gasAt
        const allowed = s > gas ? Infinity : Math.sqrt(apexSpeed * apexSpeed + 2 * BRAKE_DECEL * Math.max(0, from - s))
        return { ...steered(car, track), throttle: v < allowed ? 1 : 0, brake: v > allowed + 0.5 ? 1 : 0 }
    }
}

/** Outside to inside to outside through a left bend, `depth` across the road at the apex. */
function cleanLine(track: Track, from: number, to: number, apexSpeed: number, depth: number, gasAt: number) {
    const outside = track.wallOffset * 0.75
    return onBrakesFirst(track, from, to, apexSpeed, gasAt, (car) => {
        const s = car.proj.s
        const u = Math.max(0, Math.min(1, (s - from) / (to - from)))
        const across = outside - (1 + depth) * outside * Math.sin(Math.PI * u) ** 2
        return chase(car, track, s < from - 120 || s > to + 120 ? 0 : across)
    })
}

/** Left bends only: nothing in the physics favours a side. */
function duel(radius: number, angle: number) {
    const def = buildTrack({
        id: 'bend', name: 'Bend', group: 'sprints', ...ROAD, closed: false, origin: { x: 0, z: 0, heading: 0 },
        pieces: [straight(30), start, straight(450), corner('left', radius, angle), straight(450), finish, straight(200)]
    })
    const track = new Track(def)
    const from = track.startS + LINE_BLOCK_LENGTH / 2 + 450
    const to = from + radius * angle * Math.PI / 180
    const limit = Math.sqrt(GRIP_LATERAL * radius)

    const wall = [0.6, 0.8, 1].map(wheel => runBend(track, from, to, car => holdOn(wheel)(car, track)))
    const held = wall.reduce((a, b) => b.time < a.time ? b : a)

    let clean: Run = { time: Infinity, onWall: 0 }
    let touching: Run = { time: Infinity, onWall: 0 }
    let leaning: Run = { time: Infinity, onWall: 0 }
    const tally = (run: Run) => {
        if (run.onWall === 0) {
            if (run.time < clean.time) clean = run
        } else if (run.time < touching.time) touching = run
    }
    for (let k = 0.8; k <= 1.8; k += 0.05) {
        for (const gasAt of [0.1, 0.3, 0.5, 0.7]) {
            for (const depth of [-0.4, 0, 0.5, 1, 1.15, 1.3, 1.6]) tally(runBend(track, from, to, cleanLine(track, from, to, limit * k, depth, gasAt)))
            // The same wheel as the wall rider, on the brakes first.
            for (const wheel of [0.6, 0.8, 1]) tally(runBend(track, from, to, onBrakesFirst(track, from, to, limit * k, gasAt, holdOn(wheel))))
        }
        // Brakes to just over the tyres' limit, then leans on the wall all the way round: the patient way to ride it.
        const lean = runBend(track, from, to, onBrakesFirst(track, from, to, limit * k, 0, car =>
            chase(car, track, car.proj.s > from - 60 && car.proj.s < to ? track.wallOffset * 1.1 : 0)))
        if (lean.onWall > 0 && lean.time < leaning.time) leaning = lean
    }
    const beats = (r: Run) => r.time < clean.time - TIE
    const verdict = beats(held) || beats(leaning) ? '<- riding the wall pays' : beats(touching) ? '<- a touch pays' : ''
    if (verdict) failures++
    const fmt = (r: Run) => Number.isFinite(r.time) ? `${r.time.toFixed(2)}s (${r.onWall.toFixed(1)}s)` : 'none'
    console.log(`R${String(radius).padEnd(3)} ${String(angle).padStart(3)}deg  clean ${clean.time.toFixed(2)}s  wheel held ${fmt(held).padEnd(15)} leaning ${fmt(leaning).padEnd(15)} best touching line ${fmt(touching).padEnd(15)} ${verdict}`)
}

for (const [radius, angle] of [[30, 180], [40, 45], [40, 90], [60, 45], [60, 90], [60, 180], [80, 45], [80, 90], [80, 180]] as const) {
    duel(radius, angle)
}

// ── Whole laps ──

type Driver = (car: CarState, track: Track) => CarInput
interface Lap { time: number, touches: number, onWall: number }

/** Sets up `side` across the road, then chases a point `depth` towards the inside of each bend: past 1 it clips the inner wall. */
const apexing = (depth: number, side: number): Driver => (car, track) => {
    if (car.onRail) return botInput(car, track)
    const bend = bendAt(track, car.proj.s)
    return chase(car, track, (bend ? -bend * depth : nextBend(track, car.proj.s, 60) * side) * track.wallOffset)
}

/** The bot's pedals at `pace`, on another driver's wheel. */
const paced = (pace: number, wheel: Driver): Driver => (car, track) => {
    const { throttle, brake } = botInput(car, track, pace)
    return { ...wheel(car, track), throttle, brake }
}

/** Drift button down through every bend, nitro held down every straight. */
const drifted = (wheel: Driver): Driver => (car, track) => {
    const held = wheel(car, track)
    if (car.onRail) return held
    const bend = bendAt(track, car.proj.s)
    return { ...held, drift: !!bend, nitro: !bend }
}

const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step)

const WHEELS = [
    ...range(0.1, 1, 0.05).flatMap(wheel => range(-1, 1, 0.25).map(side => holdOn(wheel, side))),
    ...range(0.4, 1.3, 0.1).flatMap(depth => range(-0.8, 0.8, 0.4).map(side => apexing(depth, side)))
]
const DRIVERS: Driver[] = [
    ...range(0.7, 1.8, 0.02).map((pace): Driver => (car, track) => botInput(car, track, pace)),
    ...WHEELS,
    ...WHEELS.map(drifted),
    ...[1, 1.2, 1.4, 1.6].flatMap(pace => WHEELS.map(wheel => paced(pace, wheel)))
]

/** Up to `count` timed laps, each with how much it touched the walls. */
function lapsOf(track: Track, driver: Driver, count = 4) {
    const car = createCar(track, track.startS + GRID)
    const timer = new LapTimer(track.lapLength, track.closed, GRID, track.checkpointDistances)
    const laps: Lap[] = []
    let lap: Lap = { time: 0, touches: 0, onWall: 0 }
    for (let i = 0; i < PHYSICS_HZ * 150 && !timer.finished && laps.length < count; i++) {
        const ev = stepCar(car, driver(car, track), track, DT)
        if (ev.wallTouched || (car.onRail && ev.wallImpact > 0)) lap.touches++
        if (ev.scraping) lap.onWall += DT
        for (const e of timer.update(track.closed ? car.proj.s : car.proj.s - track.startS, DT)) {
            if (e.type !== 'lap') continue
            laps.push({ ...lap, time: e.time })
            lap = { time: 0, touches: 0, onWall: 0 }
        }
    }
    return laps
}

// ── Optimising a line: a plan of where to be and how fast at points along the road, nudged at random and kept when it's quicker ──

const SPACING = 22
const ITER = Number(process.env.ITER ?? 1500)
const random = createSeededRandom(Number(process.env.SEED ?? 12345))
interface Plan { lat: Float64Array, cap: Float64Array }

const roadS = (car: CarState, track: Track) => track.closed ? track.wrapS(car.proj.s) : car.proj.s

const following = (plan: Plan): Driver => (car, track) => {
    if (car.onRail) return botInput(car, track)
    const n = plan.lat.length
    const at = roadS(car, track) / SPACING
    const i = Math.max(0, Math.min(n - 1, Math.floor(at)))
    const u = at - i
    const next = track.closed ? (i + 1) % n : Math.min(n - 1, i + 1)
    const blend = (a: Float64Array) => a[i]! * (1 - u) + a[next]! * u
    const cap = blend(plan.cap)
    const v = Math.max(0, car.speed)
    return { ...chase(car, track, blend(plan.lat) * track.wallOffset), throttle: v < cap ? 1 : 0, brake: v > cap + 1 ? 1 : 0 }
}

/** The lap a driver is judged on: the flying one on a loop, the only one on a sprint. */
const judged = (track: Track, driver: Driver) => lapsOf(track, driver, track.closed ? 2 : 1)[track.closed ? 1 : 0] ?? null

/** The plan that drives the line a driver just drove. */
function planOf(track: Track, driver: Driver): Plan {
    const n = Math.ceil(track.length / SPACING) + 1
    const plan: Plan = { lat: new Float64Array(n), cap: new Float64Array(n).fill(100) }
    const car = createCar(track, track.startS + GRID)
    const seen = new Set<number>()
    for (let i = 0; i < PHYSICS_HZ * 150 && seen.size < n - 2; i++) {
        stepCar(car, driver(car, track), track, DT)
        const k = Math.floor(roadS(car, track) / SPACING)
        if (k < 0 || k >= n) continue
        plan.lat[k] = car.proj.lateral / track.wallOffset
        plan.cap[k] = Math.max(8, car.speed + 1)
        seen.add(k)
    }
    return plan
}

/** Replaying a line is never exact, so a clean start backs off from the walls and the speed until it stays clean. */
function cleanStart(track: Track, plan: Plan) {
    for (const reach of [0.75, 0.4, 0]) {
        for (const pace of [1, 0.94, 0.85, 0.7, 0.55, 0.4, 0.3]) {
            const start = { lat: plan.lat.map(l => Math.max(-reach, Math.min(reach, l))), cap: plan.cap.map(c => Math.max(8, c * pace)) }
            if (judged(track, following(start))?.touches === 0) return start
        }
    }
    return null
}

function optimise(track: Track, start: Plan, allowed: (lap: Lap) => boolean) {
    let plan = start
    const first = judged(track, following(plan))
    let bestLap = first && allowed(first) ? first : null
    const n = plan.lat.length
    for (let tries = 0; tries < ITER; tries++) {
        const lat = plan.lat.slice()
        const cap = plan.cap.slice()
        const at = random.randomInt(0, n - 1)
        const width = random.randomInt(1, 6)
        const nudgeLat = (random.randomFloat() - 0.5) * 0.3
        const nudgeCap = (random.randomFloat() - 0.5) * 12
        for (let d = -width; d <= width; d++) {
            const j = track.closed ? (at + d + n) % n : at + d
            if (j < 0 || j >= n) continue
            const fade = 1 - Math.abs(d) / (width + 1)
            lat[j] = Math.max(-0.95, Math.min(0.95, lat[j]! + nudgeLat * fade))
            cap[j] = Math.max(8, Math.min(110, cap[j]! + nudgeCap * fade))
        }
        const lap = judged(track, following({ lat, cap }))
        if (lap && allowed(lap) && (!bestLap || lap.time < bestLap.time)) {
            bestLap = lap
            plan = { lat, cap }
        }
    }
    return { lap: bestLap, plan }
}

const describe = (lap: Lap | null) => lap ? `${lap.time.toFixed(2)}s (${lap.touches} touches, ${lap.onWall.toFixed(1)}s rubbing)` : 'none'
const isClean = (lap: Lap) => lap.touches === 0
const hasContact = (lap: Lap) => lap.touches > 0

console.log(`\nWhole laps, optimised over ${ITER} tries a line`)
for (const def of TRACKS) {
    if (process.argv[2] && def.name !== process.argv[2]) continue
    const track = new Track(def)
    const rank = DRIVERS.map(driver => ({ driver, lap: judged(track, driver) })).filter(r => r.lap).sort((a, b) => a.lap!.time - b.lap!.time)
    const cleanSeed = rank.find(r => isClean(r.lap!))
    const contactSeed = rank.find(r => hasContact(r.lap!))
    const start = cleanSeed && cleanStart(track, planOf(track, cleanSeed.driver))
    const optimised = start && optimise(track, start, isClean)
    const clean = optimised?.lap ?? null
    // Two runs at contact: its own best line, and the finished clean line looking for the smallest touch worth having.
    const contacts = [contactSeed && optimise(track, planOf(track, contactSeed.driver), hasContact).lap, optimised && optimise(track, optimised.plan, hasContact).lap]
    const contact = contacts.reduce((a, b) => (b && (!a || b.time < a.time)) ? b : a, null) ?? null
    const pays = !clean || (contact && contact.time < clean.time)
    if (pays) failures++
    console.log(`${def.name.padEnd(16)} clean ${describe(clean).padEnd(36)} contact ${describe(contact).padEnd(36)} ${pays ? '<- contact pays' : ''}`)
}
console.log(failures ? `\n${failures} places where contact pays` : '\nClean wins everywhere')
