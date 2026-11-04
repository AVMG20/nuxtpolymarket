/**
 * Reports how Nitro Rush drives, for tuning: acceleration and top speed, the demo bot on every
 * registered course, a keyboard drift round a spiral, and how much slopes pull on the car.
 *
 *   bun --tsconfig-override .nuxt/tsconfig.app.json scripts/nitro-rush-laps.ts
 *
 * (The override gives Bun the `#shared` alias; run `bunx nuxt prepare` first on a fresh checkout.)
 */
import { compileCustomTrack, type SectionId } from '../shared/utils/nitro-rush/custom'
import { buildTrack, corner, LINE_BLOCK_LENGTH, ramp, SLOPE_LENGTH, start, straight } from '../shared/utils/nitro-rush/layout'
import { LapTimer } from '../shared/utils/nitro-rush/timing'
import { Track, wrapAngle } from '../shared/utils/nitro-rush/track'
import { TRACKS } from '../shared/utils/nitro-rush/tracks'
import { ENGINE_TOP_SPEED, KMH_PER_SPEED, PHYSICS_HZ } from '../app/utils/nitro-rush/config'
import { botInput, createCar, slipAngle, stepCar, type CarInput } from '../app/utils/nitro-rush/physics'

const DT = 1 / PHYSICS_HZ
const GRID = -14
const input = (o: Partial<CarInput> = {}): CarInput => ({ throttle: 0, brake: 0, steer: 0, drift: false, ...o })

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
        const tan = Math.atan2(-car.proj.tx, -car.proj.tz)
        let steer: number
        let throttle = 1
        if (car.proj.s < from - 4) {
            steer = Math.max(-1, Math.min(1, -(wrapAngle(tan - car.travel) - car.proj.lateral * 0.04) * 3))
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
slopes()
