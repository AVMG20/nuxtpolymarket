/**
 * One ticking clock for every Hero Quest countdown on screen.
 *
 * The gacha hub shows four free-pull timers at once, and four components each running their own
 * `setInterval` is four wakeups a second to render the same value. This is one interval shared by
 * however many subscribers exist, torn down when the last one unmounts.
 *
 * Module-scope on purpose. It holds nothing but the wall clock — no user state — so the usual
 * objection to module-level refs in an SSR app (leaking one request's data into another's) does
 * not apply, and the interval itself only ever starts in `onMounted`, which is client-only.
 *
 * **It drives labels, never decisions.** Every countdown here is cosmetic: the server decides
 * whether a free pull is owed, re-checking under a row lock with the same pure function, so a
 * client whose clock is wrong gets a 400 rather than a free pull.
 */
const now = ref(Date.now())
let subscribers = 0
let ticker: ReturnType<typeof setInterval> | null = null

export function useHqClock() {
    onMounted(() => {
        subscribers++
        if (!ticker) ticker = setInterval(() => { now.value = Date.now() }, 1000)
    })
    onUnmounted(() => {
        subscribers--
        if (subscribers <= 0 && ticker) {
            clearInterval(ticker)
            ticker = null
            subscribers = 0
        }
    })
    return now
}

/**
 * A `mm:ss` (or `Hh MMm` past an hour) countdown to `unlocksAt`, or `null` when there is nothing
 * to wait for.
 *
 * Takes a getter rather than a value so it stays reactive through a payload refresh.
 */
export function useHqCountdown(unlocksAt: () => number | null | undefined) {
    const clock = useHqClock()
    return computed(() => {
        const at = unlocksAt()
        if (at === null || at === undefined) return null
        return formatHqCountdown((at - clock.value) / 1000)
    })
}

/** `seconds` left as `useHqCountdown` shows them: for a countdown that stands still. */
export function formatHqCountdown(seconds: number): string {
    const whole = Math.max(0, Math.ceil(seconds))
    const hours = Math.floor(whole / 3600)
    const minutes = Math.floor((whole % 3600) / 60)
    const pad = (value: number) => String(value).padStart(2, '0')
    return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${pad(minutes)}:${pad(whole % 60)}`
}
