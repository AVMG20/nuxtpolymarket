/**
 * The login calendar (`idea-backlog.md` item 12): thirty fixed rewards, one per real UTC day.
 *
 * Each account's cycle starts on the day of its first claim and starts over every `CALENDAR_DAYS`,
 * claimed or not, so a day missed is gone unless one of the cycle's make-up claims recovers it, and
 * those always take the oldest missed day. Nothing runs at midnight: a stored cycle that has run
 * out is read as the one it rolled into (the same lazy rule as every other clock here).
 *
 * Stored as three integers on `hq_state` (the cycle's first day as a UTC day number, a bitmask of
 * the days claimed, the make-ups used), so a claim is an integer compare-and-swap.
 *
 * Pure, so the scene the client draws and the check the server enforces are one function.
 */

import { CALENDAR_DAYS, CALENDAR_MAKEUPS_PER_CYCLE, CALENDAR_REWARDS, type CalendarReward } from './constants'

const DAY_MS = 86_400_000

/** Whole UTC days since the epoch. */
export function calendarDayNumber(now: number): number {
    return Math.floor(now / DAY_MS)
}

export interface CalendarStored {
    /** The UTC day number of the cycle's day 1; null before the first claim. */
    start: number | null
    /** Bit `i` set: day `i + 1` of the cycle is claimed. */
    claimed: number
    makeups: number
}

export type CalendarDayState = 'claimed' | 'today' | 'missed' | 'upcoming'

export interface CalendarCycle {
    /** The stored values as of now, rolled into the current cycle; what a claim writes on top of. */
    stored: { start: number, claimed: number, makeups: number }
    /** 0-based index of today in the cycle. */
    today: number
    states: CalendarDayState[]
    makeupsLeft: number
    /** The day a make-up claim would take, 0-based: the oldest missed one; null when none is missed. */
    makeupDay: number | null
    /** When the next day starts, and when this cycle ends, ms epoch. */
    nextDayAt: number
    endsAt: number
}

export function isCalendarClaimed(claimed: number, index: number): boolean {
    return ((claimed >>> index) & 1) === 1
}

export function calendarCycle(stored: CalendarStored, now: number): CalendarCycle {
    const day = calendarDayNumber(now)
    let start = stored.start ?? day
    let claimed = stored.claimed
    let makeups = stored.makeups
    // a cycle that has run out rolls into the one it became, fresh
    if (day - start >= CALENDAR_DAYS) {
        start += Math.floor((day - start) / CALENDAR_DAYS) * CALENDAR_DAYS
        claimed = 0
        makeups = 0
    }
    // a start ahead of the clock (a skewed host) reads as day 1 rather than a negative day
    const today = Math.max(0, Math.min(CALENDAR_DAYS - 1, day - start))
    const states: CalendarDayState[] = []
    let makeupDay: number | null = null
    for (let i = 0; i < CALENDAR_DAYS; i++) {
        if (isCalendarClaimed(claimed, i)) states.push('claimed')
        else if (i === today) states.push('today')
        else if (i < today) {
            states.push('missed')
            makeupDay ??= i
        } else states.push('upcoming')
    }
    return {
        stored: { start, claimed, makeups },
        today,
        states,
        makeupsLeft: Math.max(0, CALENDAR_MAKEUPS_PER_CYCLE - makeups),
        makeupDay,
        nextDayAt: (day + 1) * DAY_MS,
        endsAt: (start + CALENDAR_DAYS) * DAY_MS
    }
}

/**
 * The day a claim takes, 0-based, or why it can't: today's, unless already taken; a make-up's, the
 * oldest missed day while the cycle has make-ups left.
 */
export function calendarClaimDay(cycle: CalendarCycle, makeup: boolean): { day: number } | { refused: string } {
    if (!makeup) {
        return cycle.states[cycle.today] === 'today' ? { day: cycle.today } : { refused: "Today's reward is already claimed" }
    }
    if (cycle.makeupDay === null) return { refused: 'No missed day to make up' }
    if (cycle.makeupsLeft < 1) return { refused: 'No make-ups left this cycle' }
    return { day: cycle.makeupDay }
}

/** The stored values once `day` is claimed. */
export function calendarAfterClaim(cycle: CalendarCycle, day: number, makeup: boolean): { start: number, claimed: number, makeups: number } {
    return {
        start: cycle.stored.start,
        claimed: cycle.stored.claimed | (1 << day),
        makeups: cycle.stored.makeups + (makeup ? 1 : 0)
    }
}

export function calendarReward(day: number): CalendarReward {
    return CALENDAR_REWARDS[day]!
}
