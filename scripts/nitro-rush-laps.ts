/**
 * Reports how Nitro Rush drives, for tuning: acceleration and top speed, the demo bot on every registered
 * course, a keyboard drift round a spiral, drift against grip through each bend, and how much slopes pull on the car.
 *
 *   bun --tsconfig-override .nuxt/tsconfig.app.json scripts/nitro-rush-laps.ts
 *
 * (The override gives Bun the `#shared` alias; run `bunx nuxt prepare` first on a fresh checkout.)
 */
import { compileCustomTrack, type SectionId } from '../shared/utils/nitro-rush/custom'
import { buildTrack, corner, finish, LINE_BLOCK_LENGTH, ramp, SLOPE_LENGTH, start, straight } from '../shared/utils/nitro-rush/layout'
import { LapTimer } from '../shared/utils/nitro-rush/timing'
import { headingOf, Track, wrapAngle } from '../shared/utils/nitro-rush/track'
import { ROAD, TRACKS } from '../shared/utils/nitro-rush/tracks'
import { BRAKE_DECEL, DRIFT_ALIGN, DRIFT_SLIP_IN, DRIFT_SLIP_MID, DRIFT_SLIP_WIDE, ENGINE_TOP_SPEED, KMH_PER_SPEED, PHYSICS_HZ } from '../app/utils/nitro-rush/config'
import { botInput, createCar, slipAngle, stepCar, type CarInput, type CarState } from '../app/utils/nitro-rush/physics'

const DT = 1 / PHYSICS_HZ
const GRID = -14
const input = (o: Partial<CarInput> = {}): CarInput => ({ throttle: 0, brake: 0, steer: 0, drift: false, ...o })
const clamp = (v: number) => Math.max(-1, Math.min(1, v))
const roadHeading = (car: CarState) => headingOf(car.proj.tx, car.proj.tz)
/** Steers along the road and back onto its middle; + lateral is the right of the road. */
const followRoad = (car: CarState) => clamp(-(wrapAngle(roadHeading(car) - car.travel) + car.proj.lateral * 0.04) * 3)

/** Flat out down a straight long enough never to reach the end. */
function pace() {
    const sections: SectionId[] = ['straight-20', 'start', ...Array.from({ length: 25 }, () => 'straight-200' as const), 'finish', 'straight-200']
    const track = new Track(compileCustomTrack({ id: 'custom-drag', name: 'Drag', closed: false, sections }).def!)
    const car = createCar(track, track.startS)
    let t = 0
    while (car.speed * KMH_PER_SPEED < 100) {
        stepCar(car, input({ throttle: 1 }), track, DT)
        t += DT
    }
    for (let i = 0; i < PHYSICS_HZ * 20; i++) stepCar(car, input({ throttle: 1 }), track, DT)
    console.log(`0-100 km/h ${t.toFixed(2)}s, top speed ${(car.speed * KMH_PER_SPEED).toFixed(0)} km/h (engine limit ${(ENGINE_TOP_SPEED * KMH_PER_SPEED).toFixed(0)})`)
}

/** Two laps of a loop or one run of a sprint; a clean drive hits no wall and never changes road level. */
function botDrive(track: Track) {
    const car = createCar(track, track.startS + GRID)
    const timer = new LapTimer(track.lapLength, track.closed, GRID, track.checkpointDistances)
    const laps: number[] = []
    let splits = 0
    let hits = 0
    let levelJumps = 0
    let lastY = car.proj.y
    for (let i = 0; i < PHYSICS_HZ * 150 && timer.lap < 2 && !timer.finished; i++) {
        if (stepCar(car, botInput(car, track), track, DT).wallImpact > 0) hits++
        for (const e of timer.update(track.closed ? car.proj.s : car.proj.s - track.startS, DT)) {
            if (e.type === 'lap') laps.push(e.time)
            else splits++
        }
        if (Math.abs(car.proj.y - lastY) > 0.2) levelJumps++
        lastY = car.proj.y
    }
    // Past a sprint's finish the bot brakes; it should pull up before the end barrier.
    for (let i = 0; !track.closed && i < PHYSICS_HZ * 10; i++) stepCar(car, botInput(car, track), track, DT)
    const runOff = track.closed ? '' : `, stopped ${(track.length - car.proj.s).toFixed(0)} m short of the barrier at ${car.speed.toFixed(1)} m/s`
    console.log(`${track.def.name.padEnd(20)} ${laps.map(l => `${l.toFixed(2)}s`).join(' ').padEnd(16)} splits ${splits}, wall hits ${hits}, level jumps ${levelJumps}${runOff}`)
}

/** One held drift round Twin Helix's first spiral, tapping the line tighter or wider at most every 0.3 s. */
function spiralDrift() {
    const helix = new Track(TRACKS.find(d => d.id === 'twin-helix')!)
    const from = helix.cum[helix.curvature.findIndex(k => Math.abs(k - 1 / 36) < 0.004)]!
    const length = Math.PI / 2 * 36 * 5
    const car = createCar(helix, from - 60)
    car.speed = 30
    let key = 0
    let since = Infinity
    let hits = 0
    let started = false
    let held = 0
    for (let i = 0; i < PHYSICS_HZ * 20 && car.proj.s < from + length; i++) {
        const tan = roadHeading(car)
        let steer: number
        let throttle = 1
        if (car.proj.s < from - 4) {
            steer = followRoad(car)
            throttle = car.speed < 30 ? 1 : 0
        } else if (!started) {
            started = stepCar(car, input({ throttle: 1, drift: true, steer: 1 }), helix, DT).driftStarted
            continue
        } else {
            const want = Math.max(0, car.speed / 36 + 2 * wrapAngle(car.travel - tan) - 0.025 * car.proj.lateral) / 1.5
            const slip = Math.abs(slipAngle(car))
            const next = slip < want - 0.02 ? 1 : slip > want + 0.15 ? -1 : 0
            since += DT
            if (next !== key && since >= 0.3) {
                key = next
                since = 0
            }
            steer = key
            if (car.drifting) held += DT
        }
        if (stepCar(car, input({ throttle, steer, drift: started }), helix, DT).wallImpact > 0) hits++
    }
    console.log(`spiral drift: ${car.proj.s >= from + length ? 'made it round' : 'fell short'}, still drifting ${car.drifting}, held ${held.toFixed(1)}s, wall hits ${hits}`)
}

/** A clean drift through each kind of bend from the best entry speed against the grip bot, and the speed the drift gives up. */
function driftBends() {
    const LEAD = 350
    for (const [radius, angle] of [[30, 180], [40, 90], [60, 90], [60, 180], [80, 90], [80, 180]] as const) {
        const track = new Track(buildTrack({
            id: 'bend', name: 'Bend', group: 'sprints', ...ROAD, closed: false, origin: { x: 0, z: 0, heading: 0 },
            pieces: [straight(30), start, straight(450), corner('left', radius, angle), straight(450), finish, straight(200)]
        }))
        const from = track.startS + LINE_BLOCK_LENGTH / 2 + 450
        const to = from + radius * angle * Math.PI / 180
        const run = (drive: (car: CarState) => CarInput) => {
            const car = createCar(track, from - LEAD)
            car.speed = 70
            let time = 0
            let clean = true
            let inSpeed = 0
            let outSpeed = 0
            for (let i = 0; i < PHYSICS_HZ * 40 && car.proj.s < to + LEAD; i++) {
                if (stepCar(car, drive(car), track, DT).wallImpact > 0) clean = false
                time += DT
                if (!inSpeed && car.proj.s >= from) inSpeed = car.speed
                if (!outSpeed && car.proj.s >= to) outSpeed = car.speed
            }
            return { time, clean: clean && car.proj.s >= to + LEAD, inSpeed, outSpeed }
        }
        const grip = run(car => botInput(car, track))
        let best: ReturnType<typeof run> | null = null
        for (let entry = 20; entry <= 75; entry += 2.5) {
            const attempt = run((car) => {
                const s = car.proj.s
                if (s >= from - 4 && s < to) {
                    // The slip that bends the path round this radius, corrected back onto the middle of the road.
                    const want = (car.speed / radius - 2 * wrapAngle(car.travel - roadHeading(car)) + 0.025 * car.proj.lateral) / DRIFT_ALIGN
                    const into = want >= DRIFT_SLIP_MID ? (want - DRIFT_SLIP_MID) / (DRIFT_SLIP_IN - DRIFT_SLIP_MID) : (want - DRIFT_SLIP_MID) / (DRIFT_SLIP_MID - DRIFT_SLIP_WIDE)
                    return input({ throttle: 1, drift: true, steer: car.drifting ? -clamp(into) : -1 })
                }
                const allowed = s < from ? Math.sqrt(entry * entry + 2 * BRAKE_DECEL * Math.max(0, from - s)) : Infinity
                return input({ throttle: car.speed < allowed ? 1 : 0, brake: car.speed > allowed + 0.5 ? 1 : 0, steer: followRoad(car) })
            })
            if (attempt.clean && (!best || attempt.time < best.time)) best = attempt
        }
        const drift = best ? `${best.time.toFixed(2)}s, ${best.inSpeed.toFixed(0)} to ${best.outSpeed.toFixed(0)} m/s` : 'never clean'
        console.log(`R${radius} ${angle}deg: grip bot ${grip.time.toFixed(2)}s, ${grip.inSpeed.toFixed(0)} to ${grip.outSpeed.toFixed(0)} m/s; best drift ${drift}`)
    }
}

function slopes() {
    const hill = new Track(buildTrack({
        id: 'hill', name: 'Hill', group: 'circuits', halfWidth: 9, wallOffset: 10.6, origin: { x: 0, z: 0, heading: 0 },
        pieces: [start, straight(280), corner('right', 50), ramp(300, 24), corner('right', 50), ramp(300, -24), corner('right', 50), straight(300), corner('right', 50)]
    }))
    const upS = LINE_BLOCK_LENGTH / 2 + 280 + Math.PI * 25 + 100
    const coast = (s: number) => {
        const car = createCar(hill, s)
        car.speed = 30
        for (let i = 0; i < PHYSICS_HZ * 2; i++) stepCar(car, input(), hill, DT)
        return car.speed.toFixed(1)
    }
    console.log(`coasting 2 s from 30 m/s: flat ${coast(LINE_BLOCK_LENGTH / 2 + 60)}, climbing ${coast(upS)}, descending ${coast(upS + 300 + Math.PI * 25)}`)

    const sections: SectionId[] = ['straight-20', 'start', 'straight-60', 'slope-up-steep', 'straight-200', 'straight-200', 'slope-flat', 'finish', 'straight-200']
    const steep = new Track(compileCustomTrack({ id: 'custom-steep', name: 'Steep', closed: false, sections }).def!)
    const car = createCar(steep, steep.startS + 60 + SLOPE_LENGTH, 0)
    for (let i = 0; i < PHYSICS_HZ * 30 && car.proj.s < steep.startS + 400; i++) stepCar(car, input({ throttle: 1 }), steep, DT)
    console.log(`steepest grade from a standstill: ${(car.proj.s - steep.startS).toFixed(0)} m along at ${car.speed.toFixed(1)} m/s`)
}

pace()
for (const def of TRACKS) botDrive(new Track(def))
spiralDrift()
driftBends()
slopes()
