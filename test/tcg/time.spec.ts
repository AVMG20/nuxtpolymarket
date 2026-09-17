import { describe, it, expect } from 'vitest'
import { amsterdamDateKey, amsterdamWeekday, amsterdamMidnightAfter, bundleWindow } from '#shared/utils/tcg/time'

// 2026 DST facts (Europe/Amsterdam):
// - Spring forward: Sun 2026-03-29 02:00 CET → 03:00 CEST (23-hour day)
// - Fall back:      Sun 2026-10-25 03:00 CEST → 02:00 CET (25-hour day)
// CET = UTC+1, CEST = UTC+2

function utc(s: string): Date {
    return new Date(s)
}

describe('amsterdamDateKey', () => {
    it('crosses to the next day at Amsterdam midnight, not UTC midnight (winter, CET)', () => {
        expect(amsterdamDateKey(utc('2026-01-15T22:59:00Z'))).toBe('2026-01-15')
        expect(amsterdamDateKey(utc('2026-01-15T23:30:00Z'))).toBe('2026-01-16')
        expect(amsterdamDateKey(utc('2026-01-16T00:30:00Z'))).toBe('2026-01-16')
    })

    it('crosses at 22:00 UTC in summer (CEST)', () => {
        expect(amsterdamDateKey(utc('2026-07-10T21:59:59Z'))).toBe('2026-07-10')
        expect(amsterdamDateKey(utc('2026-07-10T22:00:00Z'))).toBe('2026-07-11')
    })
})

describe('amsterdamWeekday', () => {
    it('reflects the Amsterdam calendar, 0=Sun…6=Sat', () => {
        // 2026-08-07 is a Friday
        expect(amsterdamWeekday(utc('2026-08-07T12:00:00Z'))).toBe(5)
        // 23:30Z on Thursday 2026-08-06 is already Friday in Amsterdam
        expect(amsterdamWeekday(utc('2026-08-06T23:30:00Z'))).toBe(5)
        expect(amsterdamWeekday(utc('2026-08-09T12:00:00Z'))).toBe(0)
    })
})

describe('amsterdamMidnightAfter', () => {
    function assertExactMidnight(from: Date, expectedIso: string) {
        const midnight = amsterdamMidnightAfter(from)
        expect(midnight.toISOString()).toBe(expectedIso)
        // Exactness: the dateKey flips at the returned instant and not one ms earlier
        const before = new Date(midnight.getTime() - 1)
        expect(amsterdamDateKey(midnight)).not.toBe(amsterdamDateKey(before))
        expect(amsterdamDateKey(before)).toBe(amsterdamDateKey(from))
    }

    it('plain winter day (CET, midnight at 23:00Z)', () => {
        assertExactMidnight(utc('2026-01-15T10:00:00Z'), '2026-01-15T23:00:00.000Z')
    })

    it('plain summer day (CEST, midnight at 22:00Z)', () => {
        assertExactMidnight(utc('2026-07-10T10:00:00Z'), '2026-07-10T22:00:00.000Z')
    })

    it('into the 23-hour spring-forward day (2026-03-29 starts in CET)', () => {
        assertExactMidnight(utc('2026-03-28T12:00:00Z'), '2026-03-28T23:00:00.000Z')
    })

    it('out of the 23-hour spring-forward day (next midnight already CEST)', () => {
        // Mar 29 is only 23h long: midnight → next midnight is 23 hours
        assertExactMidnight(utc('2026-03-29T12:00:00Z'), '2026-03-29T22:00:00.000Z')
        const dayStart = utc('2026-03-28T23:00:00Z')
        const dayEnd = amsterdamMidnightAfter(dayStart)
        expect(dayEnd.getTime() - dayStart.getTime()).toBe(23 * 3600 * 1000)
    })

    it('into the 25-hour fall-back day (2026-10-25 starts in CEST)', () => {
        assertExactMidnight(utc('2026-10-24T12:00:00Z'), '2026-10-24T22:00:00.000Z')
    })

    it('out of the 25-hour fall-back day (next midnight already CET)', () => {
        assertExactMidnight(utc('2026-10-25T12:00:00Z'), '2026-10-25T23:00:00.000Z')
        const dayStart = utc('2026-10-24T22:00:00Z')
        const dayEnd = amsterdamMidnightAfter(dayStart)
        expect(dayEnd.getTime() - dayStart.getTime()).toBe(25 * 3600 * 1000)
    })

    it('returns strictly after now, even when now is exactly midnight', () => {
        const midnight = utc('2026-01-15T23:00:00Z') // Jan 16 00:00 Amsterdam
        expect(amsterdamMidnightAfter(midnight).toISOString()).toBe('2026-01-16T23:00:00.000Z')
    })
})

describe('bundleWindow', () => {
    // August 2026 (CEST): Fri 2026-08-07 00:00 Ams = 2026-08-06T22:00Z,
    // Mon 2026-08-10 00:00 Ams = 2026-08-09T22:00Z

    it('closed one minute before Friday 00:00, open exactly at and after it', () => {
        const before = bundleWindow(utc('2026-08-06T21:59:00Z'))
        expect(before.open).toBe(false)
        expect(before.weekKey).toBe('2026-08-07')
        expect(before.windowEndsAt).toBeNull()
        expect(before.nextWindowAt.toISOString()).toBe('2026-08-06T22:00:00.000Z')

        const at = bundleWindow(utc('2026-08-06T22:00:00Z'))
        expect(at.open).toBe(true)
        expect(at.weekKey).toBe('2026-08-07')

        const after = bundleWindow(utc('2026-08-06T22:01:00Z'))
        expect(after.open).toBe(true)
    })

    it('open one minute before Monday 00:00, closed exactly at it', () => {
        const before = bundleWindow(utc('2026-08-09T21:59:00Z'))
        expect(before.open).toBe(true)
        expect(before.weekKey).toBe('2026-08-07')
        expect(before.windowEndsAt?.toISOString()).toBe('2026-08-09T22:00:00.000Z')

        const at = bundleWindow(utc('2026-08-09T22:00:00Z'))
        expect(at.open).toBe(false)
        expect(at.weekKey).toBe('2026-08-14')
        expect(at.windowEndsAt).toBeNull()
        expect(at.nextWindowAt.toISOString()).toBe('2026-08-13T22:00:00.000Z')
    })

    it('weekKey is stable Friday through Sunday and points at the opening Friday', () => {
        const fri = bundleWindow(utc('2026-08-07T12:00:00Z'))
        const sat = bundleWindow(utc('2026-08-08T12:00:00Z'))
        const sun = bundleWindow(utc('2026-08-09T12:00:00Z'))
        for (const w of [fri, sat, sun]) {
            expect(w.open).toBe(true)
            expect(w.weekKey).toBe('2026-08-07')
            expect(w.windowEndsAt?.toISOString()).toBe('2026-08-09T22:00:00.000Z')
            // when open, nextWindowAt is the NEXT window's Friday 00:00
            expect(w.nextWindowAt.toISOString()).toBe('2026-08-13T22:00:00.000Z')
        }
    })

    it('closed weekdays point at the upcoming Friday', () => {
        // Tue 2026-08-11
        const tue = bundleWindow(utc('2026-08-11T12:00:00Z'))
        expect(tue.open).toBe(false)
        expect(tue.weekKey).toBe('2026-08-14')
        expect(tue.nextWindowAt.toISOString()).toBe('2026-08-13T22:00:00.000Z')
    })

    it('handles the fall-back weekend (Sun 2026-10-25 is a 25-hour day)', () => {
        // Window: Fri 2026-10-23 00:00 CEST (2026-10-22T22:00Z) → Mon 2026-10-26 00:00 CET (2026-10-25T23:00Z)
        const sun = bundleWindow(utc('2026-10-25T12:00:00Z'))
        expect(sun.open).toBe(true)
        expect(sun.weekKey).toBe('2026-10-23')
        expect(sun.windowEndsAt?.toISOString()).toBe('2026-10-25T23:00:00.000Z')

        const stillOpen = bundleWindow(utc('2026-10-25T22:59:00Z'))
        expect(stillOpen.open).toBe(true)
        const closed = bundleWindow(utc('2026-10-25T23:00:00Z'))
        expect(closed.open).toBe(false)
        expect(closed.weekKey).toBe('2026-10-30')
    })

    it('handles the spring-forward weekend (Sun 2026-03-29 is a 23-hour day)', () => {
        // Window: Fri 2026-03-27 00:00 CET (2026-03-26T23:00Z) → Mon 2026-03-30 00:00 CEST (2026-03-29T22:00Z)
        const sun = bundleWindow(utc('2026-03-29T12:00:00Z'))
        expect(sun.open).toBe(true)
        expect(sun.weekKey).toBe('2026-03-27')
        expect(sun.windowEndsAt?.toISOString()).toBe('2026-03-29T22:00:00.000Z')

        const stillOpen = bundleWindow(utc('2026-03-29T21:59:00Z'))
        expect(stillOpen.open).toBe(true)
        const closed = bundleWindow(utc('2026-03-29T22:00:00Z'))
        expect(closed.open).toBe(false)
    })
})
