import { describe, expect, it } from 'vitest'
import {
    calendarAfterClaim,
    calendarClaimDay,
    calendarCycle,
    calendarDayNumber,
    isCalendarClaimed
} from '#shared/utils/hero-quest/calendar'
import { CALENDAR_DAYS, CALENDAR_MAKEUPS_PER_CYCLE, CALENDAR_REWARDS } from '#shared/utils/hero-quest/constants'

const DAY = 86_400_000
// noon UTC on some day, so a few hours either way stays on it
const NOW = 20_000 * DAY + DAY / 2
const TODAY = calendarDayNumber(NOW)

describe('hero-quest login calendar', () => {
    it('has a reward for every day, the last an even 200 Void Shards', () => {
        expect(CALENDAR_REWARDS).toHaveLength(CALENDAR_DAYS)
        expect(CALENDAR_REWARDS[CALENDAR_DAYS - 1]).toEqual({ kind: 'void_shards', amount: 200 })
    })

    it('climbs: a currency never pays less than it did earlier in the cycle', () => {
        const byKind = new Map<string, number[]>()
        for (const reward of CALENDAR_REWARDS) byKind.set(reward.kind, [...byKind.get(reward.kind) ?? [], reward.amount])
        for (const amounts of byKind.values()) {
            for (let k = 1; k < amounts.length; k++) expect(amounts[k]).toBeGreaterThanOrEqual(amounts[k - 1]!)
        }
    })

    it('starts a fresh account on day 1 today', () => {
        const cycle = calendarCycle({ start: null, claimed: 0, makeups: 0 }, NOW)
        expect(cycle.today).toBe(0)
        expect(cycle.stored.start).toBe(TODAY)
        expect(cycle.states[0]).toBe('today')
        expect(cycle.states.slice(1).every(s => s === 'upcoming')).toBe(true)
        expect(cycle.makeupDay).toBeNull()
    })

    it('counts real days: the days not claimed before today are missed, the oldest first to make up', () => {
        const cycle = calendarCycle({ start: TODAY - 5, claimed: 0b11, makeups: 0 }, NOW)
        expect(cycle.today).toBe(5)
        expect(cycle.states.slice(0, 6)).toEqual(['claimed', 'claimed', 'missed', 'missed', 'missed', 'today'])
        expect(cycle.makeupDay).toBe(2)
        expect(cycle.makeupsLeft).toBe(CALENDAR_MAKEUPS_PER_CYCLE)
    })

    it('starts over every 30 days, claims and make-ups cleared', () => {
        const cycle = calendarCycle({ start: TODAY - 65, claimed: 0b111, makeups: 2 }, NOW)
        expect(cycle.stored).toEqual({ start: TODAY - 5, claimed: 0, makeups: 0 })
        expect(cycle.today).toBe(5)
        expect(calendarCycle({ start: TODAY - 29, claimed: 1, makeups: 1 }, NOW).today).toBe(29)
    })

    it('claims today once', () => {
        const cycle = calendarCycle({ start: TODAY - 2, claimed: 0, makeups: 0 }, NOW)
        expect(calendarClaimDay(cycle, false)).toEqual({ day: 2 })
        const after = calendarAfterClaim(cycle, 2, false)
        expect(isCalendarClaimed(after.claimed, 2)).toBe(true)
        expect(after.makeups).toBe(0)
        expect('refused' in calendarClaimDay(calendarCycle(after, NOW), false)).toBe(true)
    })

    it('makes up the oldest missed day, and only while make-ups are left', () => {
        const cycle = calendarCycle({ start: TODAY - 4, claimed: 0, makeups: 0 }, NOW)
        expect(calendarClaimDay(cycle, true)).toEqual({ day: 0 })
        const after = calendarAfterClaim(cycle, 0, true)
        expect(after.makeups).toBe(1)
        expect(calendarClaimDay(calendarCycle(after, NOW), true)).toEqual({ day: 1 })

        const spent = calendarCycle({ start: TODAY - 4, claimed: 0, makeups: CALENDAR_MAKEUPS_PER_CYCLE }, NOW)
        expect('refused' in calendarClaimDay(spent, true)).toBe(true)
        const none = calendarCycle({ start: TODAY - 2, claimed: 0b11, makeups: 0 }, NOW)
        expect('refused' in calendarClaimDay(none, true)).toBe(true)
    })
})
