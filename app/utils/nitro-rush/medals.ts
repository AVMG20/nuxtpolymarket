import { PHYSICS_HZ } from './config'
import { botInput, createCar, crossesLines, stepCar } from './physics'
import { LapTimer } from '#shared/utils/nitro-rush/timing'
import { Track, type Route, type TrackDef } from '#shared/utils/nitro-rush/track'

/** Medal targets on every course, set by the demo bot so each player chases the same times. */

export type Medal = 'gold' | 'silver' | 'bronze'

/** Best first. */
export const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze']

/** Each medal's time as a share of the bot's lap. */
export const MEDAL_FACTORS: Readonly<Record<Medal, number>> = { gold: 0.95, silver: 1.03, bronze: 1.2 }
/** A circuit refills the tank at the line, which a sprint's one tank at GO doesn't match (scripts/nitro-rush-medals.ts). */
export const CIRCUIT_FACTOR = 0.96

export const MEDAL_LABELS: Readonly<Record<Medal, string>> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' }

/** Seconds, to the tenth. */
export type MedalTimes = Readonly<Record<Medal, number>>

export interface MedalTarget {
    medal: Medal
    time: number
}

const DT = 1 / PHYSICS_HZ
/** The engine's grid, behind the start line. */
const GRID_OFFSET = -14
/** Slower than this on average, the bot is stuck and its lap will never close. */
const STUCK_SPEED = 8
/** On a forked course the bot drives this many of the shortest routes, and the one with the fewest tight bends. */
const SHORTEST_ROUTES = 4
/** Physics steps a medal job runs between checks of its time slot. */
const STEPS_PER_CHECK = 240

/** The medal times for a bot lap, rounded to the nearest tenth. */
export function medalTimesFor(botLap: number, closed: boolean): MedalTimes {
    const at = (m: Medal) => Math.round(botLap * MEDAL_FACTORS[m] * (closed ? CIRCUIT_FACTOR : 1) * 10) / 10
    return { gold: at('gold'), silver: at('silver'), bronze: at('bronze') }
}

/** The best medal `time` earns, or null; compared in whole milliseconds, as laps are shown and stored. */
export function medalFor(time: number | null, times: MedalTimes | null): Medal | null {
    if (time === null || !times) return null
    const ms = Math.round(time * 1000)
    return MEDALS.find(m => ms <= Math.round(times[m] * 1000)) ?? null
}

/** 3 for gold down to 0 for none, to tell which of two medals is better. */
export const medalRank = (m: Medal | null) => m ? MEDALS.length - MEDALS.indexOf(m) : 0

/** The medal a lap wins over the one `best` holds; null when it wins nothing new. */
export function medalUpgrade(time: number, best: number | null, times: MedalTimes | null): Medal | null {
    const earned = medalFor(time, times)
    return earned && medalRank(earned) > medalRank(medalFor(best, times)) ? earned : null
}

/** The next medal up from `held`, or null once gold is held. */
export function nextMedal(held: Medal | null, times: MedalTimes | null): MedalTarget | null {
    if (!times) return null
    const i = held ? MEDALS.indexOf(held) : MEDALS.length
    const medal = MEDALS[i - 1]
    return medal ? { medal, time: times[medal] } : null
}

/** The routes the medal bot drives: every route on a course with few, else the shortest few and the one with the fewest tight bends. */
export function medalRoutes(track: Track): readonly Route[] {
    const routes = track.routes
    if (routes.length <= SHORTEST_ROUTES + 1) return routes
    const picked = [...routes].sort((a, b) => a.length - b.length).slice(0, SHORTEST_ROUTES)
    const straightest = routes.reduce((a, b) => b.bends < a.bends || (b.bends === a.bends && b.length < a.length) ? b : a)
    if (!picked.includes(straightest)) picked.push(straightest)
    return picked
}

/**
 * The demo bot's lap from the grid at full pace along `route`: a loop's first flying lap, or a sprint's run;
 * null if it falls or never finishes. Yields every so many steps, so it can run in idle slots.
 */
export function* botLapSteps(track: Track, route: Route | null = null): Generator<void, number | null> {
    const car = createCar(track, track.startS + GRID_OFFSET)
    const timer = new LapTimer(track, car.x, car.y, car.z)
    const lap = track.closed ? 1 : 0
    const length = route?.length ?? track.lapLength
    const steps = PHYSICS_HZ * (30 + length * (lap + 1) / STUCK_SPEED)
    for (let i = 0; i < steps; i++) {
        if (i % STEPS_PER_CHECK === STEPS_PER_CHECK - 1) yield
        if (stepCar(car, botInput(car, track, 1, route), track, DT).fell) return null
        for (const e of timer.update(car.x, car.y, car.z, DT, crossesLines(car, track))) {
            if (e.type === 'lap' && e.lap === lap) return e.time
        }
    }
    return null
}

/** The demo bot's lap along `route` (the main one when left out), all at once. */
export function botLapTime(track: Track, route: Route | null = null): number | null {
    const run = botLapSteps(track, route)
    for (;;) {
        const step = run.next()
        if (step.done) return step.value
    }
}

/** The medal times for a course, worked out a slice at a time: the bot's fastest lap over its routes. */
export function* medalJob(def: TrackDef): Generator<void, MedalTimes | null> {
    const track = new Track(def)
    let best: number | null = null
    for (const route of track.forked ? medalRoutes(track) : [null]) {
        const lap: number | null = yield* botLapSteps(track, route)
        if (lap !== null && (best === null || lap < best)) best = lap
    }
    return best === null ? null : medalTimesFor(best, track.closed)
}

/** Everything about a course that the bot drives on; its id and name aside. */
function roadHash(def: TrackDef) {
    const { id: _id, name: _name, group: _group, ...road } = def
    const text = JSON.stringify(road)
    // FNV-1a.
    let h = 0x811c9dc5
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
    return `${(h >>> 0).toString(36)}-${text.length}`
}

// A private course keeps its id when its road changes, so the key carries the road too.
const keys = new WeakMap<TrackDef, string>()
const cache = new Map<string, MedalTimes | null>()

/** The cache key for a course: its id and its road. */
export function medalKey(def: TrackDef) {
    let key = keys.get(def)
    if (!key) {
        key = `${def.id}:${roadHash(def)}`
        keys.set(def, key)
    }
    return key
}

/** The cached medal times, if they have been worked out; undefined when they haven't. */
export const cachedMedalTimes = (def: TrackDef) => cache.get(medalKey(def))

/** Records that a course has no medals, so it isn't tried again. */
export function markNoMedals(def: TrackDef) {
    cache.set(medalKey(def), null)
}

/** Stores a course's medal times, once a job has worked them out. */
export function cacheMedalTimes(def: TrackDef, times: MedalTimes | null) {
    cache.set(medalKey(def), times)
}

/** The medal times for a course, null when the bot can't drive it; runs the bot once per road, all at once. */
export function medalTimes(def: TrackDef): MedalTimes | null {
    const key = medalKey(def)
    let times = cache.get(key)
    if (times === undefined) {
        const job = medalJob(def)
        for (;;) {
            const step = job.next()
            if (step.done) {
                times = step.value
                break
            }
        }
        cache.set(key, times)
    }
    return times
}
