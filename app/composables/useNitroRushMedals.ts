import { cachedMedalTimes, cacheMedalTimes, markNoMedals, medalFor, medalJob, medalKey, type Medal, type MedalTimes } from '~/utils/nitro-rush/medals'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** Bumped as each course's times come in, so whatever read them renders again. */
const settled = ref(0)
/** Courses waiting for their bot laps, by cache key. */
const queue = new Map<string, TrackDef>()
/** The course about to be raced, which goes first and still runs while a race holds the rest back. */
let priority: string | null = null
type Job = Generator<void, MedalTimes | null>
let current: { key: string, def: TrackDef, job: Job, first: boolean } | null = null
/** Jobs put back part done, which carry on from where they stopped when their course comes round again. */
const parked = new Map<string, Job>()
let running = false
let held = false

/** Milliseconds of bot laps per slot where the browser can't say how much idle time it has. */
const FALLBACK_SLICE = 6

interface Deadline {
    timeRemaining(): number
}

type IdleWindow = Window & { requestIdleCallback?: (cb: (deadline: Deadline) => void, opts?: { timeout: number }) => number }

function later(cb: (deadline: Deadline | null) => void) {
    const w = window as IdleWindow
    // Safari has no idle callback.
    if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 500 })
    else setTimeout(() => cb(null), 50)
}

/** The next course to work on: the priority one first, and while a race runs nothing else. */
function nextJob(): typeof current {
    const key = priority !== null && queue.has(priority) ? priority : held ? undefined : queue.keys().next().value
    if (key === undefined) return null
    const def = queue.get(key)!
    queue.delete(key)
    const first = key === priority
    if (first) priority = null
    const job = parked.get(key)
    parked.delete(key)
    if (cachedMedalTimes(def) !== undefined) return nextJob()
    return { key, def, job: job ?? medalJob(def), first }
}

/** Puts a list course's job back when a race holds the list or the race's course is waiting behind it. */
function yieldToRace() {
    if (!current || current.first || !(held || (priority !== null && queue.has(priority)))) return
    queue.set(current.key, current.def)
    parked.set(current.key, current.job)
    current = null
}

/** Bot laps a slice at a time in idle slots: a forked course takes several, too much for one frame. */
function work(deadline: Deadline | null) {
    const started = performance.now()
    const left = () => deadline ? deadline.timeRemaining() : FALLBACK_SLICE - (performance.now() - started)
    do {
        yieldToRace()
        current ??= nextJob()
        if (!current) {
            // A race has no idle frames to spare, and Safari's fallback can't tell; the menu's list waits for it to end.
            if (queue.size) return later(work)
            running = false
            return
        }
        const { def, job } = current
        try {
            const step = job.next()
            if (!step.done) continue
            cacheMedalTimes(def, step.value)
        } catch {
            // A course the bot can't even load has no medals, and mustn't stop the rest of the list.
            markNoMedals(def)
        }
        current = null
        settled.value++
    } while (left() > 1)
    later(work)
}

/** Holds the list's bot laps back while a race runs. */
export function holdMedalWork(on: boolean) {
    held = on
}

function schedule(def: TrackDef, first = false) {
    const key = medalKey(def)
    queue.set(key, def)
    if (first) priority = key
    if (running) return
    running = true
    later(work)
}

/** Medal times for the menu and the race, worked out lazily in idle time and shared by every component. */
export function useNitroRushMedals() {
    /** The course's medal times: null when the bot can't drive it, undefined while they're still being worked out. */
    function times(def: TrackDef | null): MedalTimes | null | undefined {
        if (!def) return null
        void settled.value
        const t = cachedMedalTimes(def)
        if (t === undefined) schedule(def)
        return t
    }

    /** The medal a time earns on a course; a course with no time is never worked out. */
    function medalOf(def: TrackDef | null, time: number | null): Medal | null {
        return time === null ? null : medalFor(time, times(def) ?? null)
    }

    /** The course's medal times if known, else null with the course sent to the front of the queue; `times` updates once they're in. */
    function ensure(def: TrackDef): MedalTimes | null {
        const cached = cachedMedalTimes(def)
        if (cached !== undefined) return cached
        schedule(def, true)
        return null
    }

    return { times, medalOf, ensure }
}
