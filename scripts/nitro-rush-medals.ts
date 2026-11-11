/**
 * Prints the demo bot's lap and the medal times on every official Nitro Rush course and Neon Ring, how much a full tank takes off that lap, and how long the bot lap takes to work out.
 *
 *   bun --tsconfig-override .nuxt/tsconfig.app.json scripts/nitro-rush-medals.ts
 */
import { BRAKE_DECEL, GRIP_LATERAL, PHYSICS_HZ } from '../app/utils/nitro-rush/config'
import { refillAtLine } from '../app/utils/nitro-rush/lap-refill'
import { botLapTime, MEDALS, medalTimesFor } from '../app/utils/nitro-rush/medals'
import { botInput, createCar, crossesLines, stepCar, type CarInput, type CarState } from '../app/utils/nitro-rush/physics'
import { compileCustomTrack } from '../shared/utils/nitro-rush/custom'
import { formatLapTime, LapTimer } from '../shared/utils/nitro-rush/timing'
import { Track, type TrackDef } from '../shared/utils/nitro-rush/track'
import { TRACKS } from '../shared/utils/nitro-rush/tracks'

/** Runs after the first, so the timing leaves out the JIT warming up. */
const RUNS = 5
const DT = 1 / PHYSICS_HZ
/** The engine's grid, behind the start line. */
const GRID_OFFSET = -14
/** Metres between the firing points the searches try. */
const SCAN_STEP = 5
/** How far before the line the carry-over search starts firing; a burn covers about 300 m. */
const CARRY_RANGE = 400

const neonRing = compileCustomTrack({
    id: 'neon-ring',
    name: 'Neon Ring',
    closed: true,
    sections: ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight']
}).def
if (!neonRing) throw new Error('Neon Ring did not compile')
const COURSES: TrackDef[] = [...TRACKS, neonRing]

/** The fastest the car may go now and still slow for every bend in braking range, as the bot works it out. */
function cornerLimit(car: CarState, track: Track) {
    const v = Math.max(0, car.speed)
    let allowed = Infinity
    const look = 20 + v * v / (BRAKE_DECEL * 1.4)
    for (let d = 0; d <= look; d += 4) {
        const k = track.racingCurvature[track.segmentAt(car.proj.s + d)]!
        if (k < 1e-4) continue
        const corner = Math.sqrt(GRIP_LATERAL * 0.9 / k)
        allowed = Math.min(allowed, Math.sqrt(corner * corner + 2 * BRAKE_DECEL * 0.7 * d))
    }
    if (!track.closed) allowed = Math.min(allowed, Math.sqrt(2 * BRAKE_DECEL * 0.7 * Math.max(0, track.length - 12 - car.proj.s)))
    return allowed
}

/** The bot's line and braking, without its cap at the engine's top speed: a player holds the throttle under nitro and coasts down after it. */
function playerInput(car: CarState, track: Track): CarInput {
    const bot = botInput(car, track)
    if (car.onRail) return bot
    const v = Math.max(0, car.speed)
    const allowed = cornerLimit(car, track)
    return { ...bot, throttle: v < allowed ? 1 : 0, brake: v > allowed + 2 ? 1 : 0 }
}

const inBend = (car: CarState, track: Track) => track.curvature[track.segmentAt(car.proj.s)]! >= 1e-4

/** When nitro may first fire: on lap `lap`, `at` metres past the line or out of its first bend; after that, whenever the tank is full; `carry` lights one on the lap before, that far before the line. */
interface Plan {
    lap: number
    at: number | 'straight'
    carry?: number
}

/** The timed lap (a loop's first flying lap, or a sprint's run) with nitro fired to `plan`, starting full and refilled at each line, and where it first fired on that lap. */
function nitroLap(track: Track, plan: Plan | null): { time: number, firedAt: number | null } | null {
    const car = createCar(track, track.startS + GRID_OFFSET)
    car.nitro = 1
    const timer = new LapTimer(track, car.x, car.y, car.z)
    const lap = track.closed ? 1 : 0
    const L = track.lapLength
    let armed = false
    let bent = false
    let firedAt: number | null = null
    let burning = false
    // Distance driven from the start line, unwrapped across laps, to tell how far into a lap the car is.
    let distance = GRID_OFFSET
    let lastS = track.closed ? track.wrapS(GRID_OFFSET) : GRID_OFFSET
    /** Lights a full tank and holds the button until it runs dry. */
    const light = () => !burning && car.nitro >= 1 && (burning = true)
    for (let i = 0; i < PHYSICS_HZ * 240; i++) {
        if (stepCar(car, { ...playerInput(car, track), nitro: burning }, track, DT).fell) return null
        if (car.nitro <= 0) burning = false
        const s = track.closed ? car.proj.s : car.proj.s - track.startS
        distance += track.closed ? s - lastS - Math.round((s - lastS) / L) * L : s - lastS
        lastS = s
        for (const e of timer.update(car.x, car.y, car.z, DT, crossesLines(car, track))) {
            if (e.type !== 'lap') continue
            if (e.lap === lap) return { time: e.time, firedAt }
            refillAtLine(car, track.closed)
        }
        const into = distance - timer.lap * L
        if (plan?.carry !== undefined && timer.lap === plan.lap - 1 && into >= L - plan.carry) light()
        if (plan && !armed && timer.lap === plan.lap) {
            // A player lights it on the exit of the first bend, back on the throttle.
            bent ||= inBend(car, track)
            armed = plan.at === 'straight' ? bent && !inBend(car, track) && playerInput(car, track).throttle === 1 : into >= plan.at
        }
        if (armed && light() && timer.lap === lap) firedAt ??= into
    }
    return null
}

/** The quickest of `plans` and the one that set it. */
function quickest(track: Track, plans: Plan[]) {
    let best: { time: number, plan: Plan } | null = null
    for (const plan of plans) {
        const time = nitroLap(track, plan)?.time
        if (time !== undefined && (!best || time < best.time)) best = { time, plan }
    }
    return best
}

const range = (from: number, to: number) => Array.from({ length: Math.floor((to - from) / SCAN_STEP) + 1 }, (_, i) => from + i * SCAN_STEP)

/** `-1.23 (5.3%)`: seconds off the bot's lap and the share of it. */
const gain = (bot: number, time: number | null | undefined) => time == null ? 'no lap' : `${(time - bot).toFixed(2)} (${((bot - time) / bot * 100).toFixed(1)}%)`

const cols = ['Line/GO', 'First straight', 'Best spot', 'Carry-over']
console.log(`${'Course'.padEnd(16)} ${'Bot lap'.padStart(8)}  ${MEDALS.map(m => m.padStart(9)).join(' ')}  ${cols.map(c => c.padStart(14)).join(' ')}  ${'ms/lap'.padStart(7)}`)
const notes: string[] = []
for (const def of COURSES) {
    const track = new Track(def)
    const lap = botLapTime(track)
    const ms: number[] = []
    for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now()
        botLapTime(new Track(def))
        ms.push(performance.now() - t0)
    }
    const cost = Math.min(...ms).toFixed(1).padStart(7)
    if (lap === null) {
        console.log(`${def.name.padEnd(16)} ${'no lap'.padStart(8)}  ${cost}`)
        continue
    }
    const times = medalTimesFor(lap, track.closed)
    const target = track.closed ? 1 : 0
    const L = track.lapLength
    // The player's input alone, without nitro, should drive the bot's lap.
    const plain = nitroLap(track, null)
    if (!plain || Math.abs(plain.time - lap) > 0.0005) notes.push(`${def.name}: the player input without nitro laps in ${plain?.time.toFixed(3)}, the bot in ${lap.toFixed(3)}`)
    const line = nitroLap(track, { lap: target, at: track.closed ? 0 : -Infinity })
    const straight = nitroLap(track, { lap: target, at: 'straight' })
    const spot = quickest(track, [...track.closed ? [] : [-Infinity], ...range(0, L)].map(at => ({ lap: target, at })))
    // A burn lit on the lap before runs on across the line; the refilled tank then fires as it ends, or at the best spot.
    const carry = track.closed && spot ? quickest(track, range(0, CARRY_RANGE).flatMap(carry => [{ lap: 1, at: 0, carry }, { lap: 1, at: spot.plan.at, carry }])) : null
    if (straight?.firedAt != null) notes.push(`${def.name}: out of the first bend ${straight.firedAt.toFixed(0)} m past the line`)
    if (spot) notes.push(`${def.name}: best single fire ${spot.plan.at === -Infinity ? 'at GO' : `${spot.plan.at} m past the line`}`)
    if (carry) notes.push(`${def.name}: best carry-over lit ${carry.plan.carry} m before the line, then again ${carry.plan.at ? `${carry.plan.at} m past it` : 'as it ends'}`)
    const cells = [line?.time, straight?.time, spot?.time, track.closed ? carry?.time : undefined].map((t, i) => (i === 3 && !track.closed ? 'sprint' : gain(lap, t)).padStart(14))
    console.log(`${def.name.padEnd(16)} ${lap.toFixed(2).padStart(8)}  ${MEDALS.map(m => formatLapTime(times[m]).padStart(9)).join(' ')}  ${cells.join(' ')}  ${cost}`)
}
for (const note of notes) console.log(note)
