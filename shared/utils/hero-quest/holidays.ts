/**
 * Holiday gift windows (`holiday-events.md` §2): when each holiday's gift can be claimed.
 *
 * A window opens on the holiday's UTC day and stays open `HOLIDAY_CLAIM_WINDOW_DAYS`, the holiday
 * itself counted. A gift belongs to the year its holiday falls in, so a window that runs past New
 * Year's Eve still claims the earlier year's gift. No catch-up: a closed window never opens again,
 * so nothing has to be stored for one that was missed.
 *
 * Pure, so the gift the client shows and the window the server enforces are one function.
 */

import { HOLIDAY_CLAIM_WINDOW_DAYS, HOLIDAY_GIFTS, type HolidayGift } from './constants'
import { HOLIDAYS, type HolidayDef, type HolidayId } from './content/holidays'

const DAY_MS = 86_400_000

/** The UTC day number (days since the epoch) a holiday falls on in `year`; null for a year its table lacks. */
export function holidayDayIn(holiday: HolidayDef, year: number): number | null {
    let month: number
    let day: number
    if (holiday.date.kind === 'fixed') {
        month = holiday.date.month
        day = holiday.date.day
    } else if (holiday.date.kind === 'easter') {
        ({ month, day } = easterSunday(year))
    } else {
        const md = holiday.date.dates[year]
        if (!md) return null
        const [m, d] = md.split('-').map(Number)
        month = m!
        day = d!
    }
    return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS)
}

/** Western Easter Sunday in `year`: the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): { month: number, day: number } {
    const a = year % 19
    const b = Math.floor(year / 100)
    const c = year % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const n = h + l - 7 * m + 114
    return { month: Math.floor(n / 31), day: (n % 31) + 1 }
}

export interface HolidayWindow {
    holiday: HolidayDef
    /** The year the holiday fell in: the claim's key, with its ID. */
    year: number
    /** First and last-plus-one UTC day of the window, and the same as ms epoch. */
    opensDay: number
    closesDay: number
    opensAt: number
    closesAt: number
}

function windowOf(holiday: HolidayDef, year: number, windowDays: number): HolidayWindow | null {
    const opensDay = holidayDayIn(holiday, year)
    if (opensDay === null) return null
    const closesDay = opensDay + windowDays
    return { holiday, year, opensDay, closesDay, opensAt: opensDay * DAY_MS, closesAt: closesDay * DAY_MS }
}

/**
 * Every gift claimable at `now`, earliest-opened first. Last year's holidays are checked too, for a
 * window that opened in late December and runs into January.
 */
export function openHolidayWindows(now: number, holidays: readonly HolidayDef[] = HOLIDAYS, windowDays = HOLIDAY_CLAIM_WINDOW_DAYS): HolidayWindow[] {
    const today = Math.floor(now / DAY_MS)
    const year = new Date(now).getUTCFullYear()
    const out: HolidayWindow[] = []
    for (const y of [year - 1, year]) {
        for (const holiday of holidays) {
            const w = windowOf(holiday, y, windowDays)
            if (w && today >= w.opensDay && today < w.closesDay) out.push(w)
        }
    }
    return out.sort((a, b) => a.opensDay - b.opensDay)
}

/** The open window for one holiday at `now`, or null. */
export function openHolidayWindow(id: HolidayId, now: number, holidays: readonly HolidayDef[] = HOLIDAYS, windowDays = HOLIDAY_CLAIM_WINDOW_DAYS): HolidayWindow | null {
    return openHolidayWindows(now, holidays, windowDays).find(w => w.holiday.id === id) ?? null
}

export function holidayGift(id: HolidayId): HolidayGift {
    return HOLIDAY_GIFTS[id]
}

/** A gift's Gold for an hour's income: its minutes of it, in whole coins (`gold-economy.md` §6). */
export function holidayGiftGold(gift: HolidayGift, goldPerHour: number): number {
    return Math.floor(goldPerHour * gift.goldMinutes / 60)
}
