import { cachedMedalTimes, markNoMedals, medalFor, medalKey, medalTimes, type Medal, type MedalTimes } from '~/utils/nitro-rush/medals'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** Bumped as each course's times come in, so whatever read them renders again. */
const settled = ref(0)
/** Courses waiting for their bot lap, by cache key. */
const queue = new Map<string, TrackDef>()
let running = false
let held = false

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }

function later(cb: () => void) {
    const w = window as IdleWindow
    // Safari has no idle callback.
    if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 500 })
    else setTimeout(cb, 50)
}

/** One bot lap per idle slot: a long course takes tens of milliseconds, too much to run a list of them in one frame. */
function runNext() {
    const next = queue.entries().next()
    if (next.done) {
        running = false
        return
    }
    // A race has no idle frames to spare, and Safari's fallback can't tell; the menu's list waits for it to end.
    if (held) return later(runNext)
    const [key, def] = next.value
    queue.delete(key)
    try {
        if (cachedMedalTimes(def) === undefined) medalTimes(def)
    } catch {
        // A course the bot can't even load has no medals, and mustn't stop the rest of the list.
        markNoMedals(def)
    } finally {
        settled.value++
        later(runNext)
    }
}

/** Holds the list's bot laps back while a race runs. */
export function holdMedalWork(on: boolean) {
    held = on
}

function schedule(def: TrackDef) {
    queue.set(medalKey(def), def)
    if (running) return
    running = true
    later(runNext)
}

/** Medal times for the menu and the race, worked out lazily and shared by every component. */
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

    /** The course's medal times now, for a course about to be raced. */
    function ensure(def: TrackDef): MedalTimes | null {
        const cached = cachedMedalTimes(def)
        if (cached !== undefined) return cached
        const t = medalTimes(def)
        settled.value++
        return t
    }

    return { times, medalOf, ensure }
}
