// Europe/Amsterdam time utilities for the TCG daily allowance and Friday bundle window.
// Pure — no dependencies, every function takes an explicit `now`.

const AMSTERDAM_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
})

const AMSTERDAM_WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Amsterdam',
    weekday: 'short'
})

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MINUTE = 60_000
const STEP = 15 * MINUTE

/** Calendar date in Amsterdam as 'YYYY-MM-DD' (en-CA formats exactly this way). */
export function amsterdamDateKey(now: Date): string {
    return AMSTERDAM_DATE_FMT.format(now)
}

/** Amsterdam weekday index, 0 = Sunday … 6 = Saturday. */
export function amsterdamWeekday(now: Date): number {
    return WEEKDAYS.indexOf(AMSTERDAM_WEEKDAY_FMT.format(now))
}

function addDaysToKey(dateKey: string, days: number): string {
    const [y, m, d] = dateKey.split('-').map(Number)
    const t = new Date(Date.UTC(y!, m! - 1, d! + days))
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(t.getUTCDate()).padStart(2, '0')
    return `${t.getUTCFullYear()}-${mm}-${dd}`
}

/**
 * The absolute instant of the next Amsterdam midnight strictly after `now`.
 * Exact through 23h (spring-forward) and 25h (fall-back) DST days.
 *
 * Strategy: guess next midnight as UTC-midnight of (today's Amsterdam key + 1 day)
 * minus a nominal +2h offset, then step in 15-minute increments until the dateKey
 * flips exactly at the returned instant and not one minute before.
 */
export function amsterdamMidnightAfter(now: Date): Date {
    const todayKey = amsterdamDateKey(now)
    const nextKey = addDaysToKey(todayKey, 1)
    const [y, m, d] = nextKey.split('-').map(Number)
    // Nominal guess: Amsterdam is UTC+1 or UTC+2; start from +2 (earlier instant) and step forward.
    let t = Date.UTC(y!, m! - 1, d!) - 2 * 60 * MINUTE
    // Step forward while we're still on the old date (or somehow past — step back).
    while (amsterdamDateKey(new Date(t)) < nextKey) t += STEP
    while (amsterdamDateKey(new Date(t - STEP)) >= nextKey) t -= STEP
    // Refine to the exact minute boundary: t is the first 15-min-grid instant on the
    // new date; DST offsets are whole quarter-hours, and midnight lies on the grid,
    // so t is exact. Verify the invariant anyway.
    if (amsterdamDateKey(new Date(t)) !== nextKey || amsterdamDateKey(new Date(t - MINUTE)) >= nextKey) {
        // Fallback: linear minute scan (never expected in practice)
        while (amsterdamDateKey(new Date(t - MINUTE)) >= nextKey) t -= MINUTE
        while (amsterdamDateKey(new Date(t)) < nextKey) t += MINUTE
    }
    return new Date(t)
}

/** The instant of Amsterdam midnight beginning the day `dateKey` (i.e. dateKey 00:00 Amsterdam). */
function amsterdamMidnightOf(dateKey: string): Date {
    // Midnight starting `dateKey` is the "midnight after" any instant on the previous day.
    const prevKey = addDaysToKey(dateKey, -1)
    const [y, m, d] = prevKey.split('-').map(Number)
    // Noon UTC on prevKey is unambiguously within prevKey in Amsterdam.
    return amsterdamMidnightAfter(new Date(Date.UTC(y!, m! - 1, d!, 12)))
}

export interface BundleWindow {
    open: boolean
    /** dateKey of the window's opening Friday (current window when open, next window when closed). */
    weekKey: string
    /** Instant the current window closes (Monday 00:00 Amsterdam); null when closed. */
    windowEndsAt: Date | null
    /**
     * Instant of the next Friday 00:00 Amsterdam. When the window is open this is the
     * NEXT window's start (the current window's start is deliberately omitted — callers
     * inside the window only need to know when the following one begins).
     */
    nextWindowAt: Date
}

/**
 * The Friday bundle window: open from Friday 00:00 up to (excluding) Monday 00:00,
 * Amsterdam time.
 */
export function bundleWindow(now: Date): BundleWindow {
    const weekday = amsterdamWeekday(now) // 0=Sun … 5=Fri, 6=Sat
    const todayKey = amsterdamDateKey(now)
    const open = weekday === 5 || weekday === 6 || weekday === 0

    if (open) {
        // Days since the opening Friday: Fri=0, Sat=1, Sun=2
        const sinceFriday = weekday === 5 ? 0 : weekday === 6 ? 1 : 2
        const weekKey = addDaysToKey(todayKey, -sinceFriday)
        const mondayKey = addDaysToKey(weekKey, 3)
        return {
            open: true,
            weekKey,
            windowEndsAt: amsterdamMidnightOf(mondayKey),
            nextWindowAt: amsterdamMidnightOf(addDaysToKey(weekKey, 7))
        }
    }

    // Closed: Mon(1)→4 days to Friday, Tue(2)→3, Wed(3)→2, Thu(4)→1
    const untilFriday = 5 - weekday
    const weekKey = addDaysToKey(todayKey, untilFriday)
    return {
        open: false,
        weekKey,
        windowEndsAt: null,
        nextWindowAt: amsterdamMidnightOf(weekKey)
    }
}
