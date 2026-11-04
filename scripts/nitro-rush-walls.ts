/**
 * Whether scraping the walls pays in Nitro Rush: riding the outer wall flat out against the best clean line through
 * every kind of bend (searched over brake speed, apex and throttle point), then whole laps of the official courses.
 *
 *   bun --tsconfig-override .nuxt/tsconfig.app.json scripts/nitro-rush-walls.ts
 */
import { buildTrack, corner, finish, LINE_BLOCK_LENGTH, start, straight } from '../shared/utils/nitro-rush/layout'
import { LapTimer } from '../shared/utils/nitro-rush/timing'
import { headingOf, Track, wrapAngle } from '../shared/utils/nitro-rush/track'
import { ROAD, TRACKS } from '../shared/utils/nitro-rush/tracks'
import { BRAKE_DECEL, GRIP_LATERAL, PHYSICS_HZ } from '../app/utils/nitro-rush/config'
import { botInput, createCar, fireNitro, stepCar, type CarInput, type CarState } from '../app/utils/nitro-rush/physics'

const DT = 1 / PHYSICS_HZ
const GRID = -14
/** Seconds a line must win by to count: the clean search is a coarse grid, not the true best line. */
const TIE = 0.05
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
const holdOn = (wheel: number) => (car: CarState, track: Track): CarInput => {
    if (car.onRail) return botInput(car, track)
    const bend = bendAt(track, car.proj.s)
    if (bend) return { throttle: 1, brake: 0, steer: -bend * wheel, drift: false }
    return chase(car, track, nextBend(track, car.proj.s, 60) * track.wallOffset * 0.8)
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
            for (const depth of [-0.4, 0, 0.5, 1]) tally(runBend(track, from, to, cleanLine(track, from, to, limit * k, depth, gasAt)))
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
    const fmt = (r: Run) => Number.isFinite(r.time) ? `${r.time.toFixed(2)}s (${r.onWall.toFixed(1)}s)` : 'none'
    console.log(`R${String(radius).padEnd(3)} ${String(angle).padStart(3)}deg  clean ${clean.time.toFixed(2)}s  wheel held ${fmt(held).padEnd(15)} leaning ${fmt(leaning).padEnd(15)} best touching line ${fmt(touching).padEnd(15)} ${verdict}`)
}

for (const [radius, angle] of [[30, 180], [40, 45], [40, 90], [60, 45], [60, 90], [60, 180], [80, 45], [80, 90], [80, 180]] as const) {
    duel(radius, angle)
}

// ── Whole laps ──

const DRIVERS: Record<string, (car: CarState, track: Track) => CarInput> = {
    bot: (car, track) => botInput(car, track),
    hold: holdOn(1),
    // Drift button down through every bend, cashing the nitro on the next straight.
    drift: (car, track) => {
        const held = holdOn(1)(car, track)
        if (car.onRail) return held
        const bend = bendAt(track, car.proj.s)
        if (!bend) fireNitro(car)
        return { ...held, drift: !!bend }
    }
}

function lapOf(track: Track, driver: (car: CarState, track: Track) => CarInput) {
    const car = createCar(track, track.startS + GRID)
    const timer = new LapTimer(track.lapLength, track.closed, GRID, track.checkpointDistances)
    let best = Infinity
    let onWall = 0
    for (let i = 0; i < PHYSICS_HZ * 240 && !timer.finished && timer.lap < 2; i++) {
        const ev = stepCar(car, driver(car, track), track, DT)
        if (ev.scraping) onWall += DT
        for (const e of timer.update(track.closed ? car.proj.s : car.proj.s - track.startS, DT)) {
            if (e.type === 'lap') best = Math.min(best, e.time)
        }
    }
    return `${(Number.isFinite(best) ? best.toFixed(2) : 'dnf').padStart(7)}s ${onWall.toFixed(1).padStart(5)}s`
}

console.log(`\n${'course'.padEnd(20)} ${Object.keys(DRIVERS).map(n => n.padEnd(17)).join('')}(best lap, seconds on the wall over the run)`)
for (const def of TRACKS) {
    const track = new Track(def)
    console.log(`${def.name.padEnd(20)} ${Object.values(DRIVERS).map(d => lapOf(track, d).padEnd(17)).join('')}`)
}
