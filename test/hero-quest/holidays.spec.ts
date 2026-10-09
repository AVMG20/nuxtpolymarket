import { describe, expect, it } from 'vitest'
import { HOLIDAYS, LUNAR_NEW_YEAR_DATES, isHolidayId, type HolidayDef } from '#shared/utils/hero-quest/content/holidays'
import { holidayDayIn, holidayGift, holidayGiftGold, nextHolidayWindow, openHolidayWindow, openHolidayWindows } from '#shared/utils/hero-quest/holidays'
import { HOLIDAY_CLAIM_WINDOW_DAYS, HOLIDAY_GIFTS } from '#shared/utils/hero-quest/constants'
import { GACHA_SYSTEMS } from '#shared/utils/hero-quest/gacha'

const DAY = 86_400_000
/** `hour` o'clock UTC on a date. */
const at = (year: number, month: number, day: number, hour = 12) => Date.UTC(year, month - 1, day, hour)

describe('hero-quest holiday gifts', () => {
    it('has the first-pass roster with stable, unique IDs, and a gift for each', () => {
        expect(HOLIDAYS.map(h => h.id)).toEqual(['holiday_new_year', 'holiday_lunar_new_year', 'holiday_halloween', 'holiday_christmas'])
        expect(Object.keys(HOLIDAY_GIFTS).sort()).toEqual(HOLIDAYS.map(h => h.id).sort())
        expect(isHolidayId('holiday_halloween')).toBe(true)
        expect(isHolidayId('holiday_easter')).toBe(false)
    })

    it('authors a mixed bundle per holiday: Gold and Gems on each, Seals only of real gachas', () => {
        for (const h of HOLIDAYS) {
            const gift = holidayGift(h.id)
            expect(gift.goldMinutes).toBeGreaterThan(0)
            expect(gift.gems).toBeGreaterThan(0)
            for (const [system, amount] of Object.entries(gift.seals)) {
                expect(GACHA_SYSTEMS).toContain(system)
                expect(Number.isInteger(amount) && amount! > 0).toBe(true)
            }
        }
        // a bigger holiday carries a richer bundle than a smaller one (§3)
        expect(HOLIDAY_GIFTS.holiday_christmas.gems).toBeGreaterThan(HOLIDAY_GIFTS.holiday_halloween.gems)
    })

    it('sizes the Gold as minutes of income, in whole coins', () => {
        expect(holidayGiftGold({ goldMinutes: 30, gems: 0, seals: {} }, 1000)).toBe(500)
        expect(holidayGiftGold({ goldMinutes: 7, gems: 0, seals: {} }, 100)).toBe(11)
        expect(holidayGiftGold({ goldMinutes: 60, gems: 0, seals: {} }, 0)).toBe(0)
    })

    describe('windows', () => {
        it('opens on the holiday and stays open the window, the holiday counted, in UTC days', () => {
            const halloween = (now: number) => openHolidayWindow('holiday_halloween', now)
            expect(halloween(at(2026, 10, 30, 23))).toBeNull()
            expect(halloween(at(2026, 10, 31, 0))?.year).toBe(2026)
            const last = at(2026, 10, 31 + HOLIDAY_CLAIM_WINDOW_DAYS - 1, 23)
            expect(halloween(last)).not.toBeNull()
            expect(halloween(last + DAY)).toBeNull()
            const w = halloween(at(2026, 11, 1))!
            expect(w.closesAt - w.opensAt).toBe(HOLIDAY_CLAIM_WINDOW_DAYS * DAY)
            expect(w.opensAt).toBe(at(2026, 10, 31, 0))
        })

        it('reads Lunar New Year off its table, a different day each year', () => {
            expect(openHolidayWindow('holiday_lunar_new_year', at(2026, 2, 17))?.year).toBe(2026)
            expect(openHolidayWindow('holiday_lunar_new_year', at(2026, 2, 16))).toBeNull()
            expect(openHolidayWindow('holiday_lunar_new_year', at(2027, 2, 6))?.year).toBe(2027)
            expect(openHolidayWindow('holiday_lunar_new_year', at(2027, 2, 17))).toBeNull()
            expect(openHolidayWindow('holiday_lunar_new_year', at(2028, 1, 26))?.year).toBe(2028)
        })

        it('keeps the Lunar New Year table well-formed and far enough ahead', () => {
            const years = Object.keys(LUNAR_NEW_YEAR_DATES).map(Number).sort((a, b) => a - b)
            // every year present from the first to the last, and at least twenty years past launch
            expect(years.at(-1)! - years[0]! + 1).toBe(years.length)
            expect(years.at(-1)!).toBeGreaterThanOrEqual(2046)
            const lunar = HOLIDAYS.find(h => h.id === 'holiday_lunar_new_year')!
            for (const year of years) {
                // always between January 21 and February 20
                const day = holidayDayIn(lunar, year)!
                expect(day).toBeGreaterThanOrEqual(Math.floor(at(year, 1, 21, 0) / DAY))
                expect(day).toBeLessThanOrEqual(Math.floor(at(year, 2, 20, 0) / DAY))
            }
        })

        it('has no Lunar New Year gift in a year past its table', () => {
            const lunar = HOLIDAYS.find(h => h.id === 'holiday_lunar_new_year')!
            const beyond = Math.max(...Object.keys(LUNAR_NEW_YEAR_DATES).map(Number)) + 1
            expect(holidayDayIn(lunar, beyond)).toBeNull()
            expect(openHolidayWindows(at(beyond, 1, 25)).map(w => w.holiday.id)).not.toContain('holiday_lunar_new_year')
        })

        it('keys New Year\'s Day to the year it opens, and Christmas to the one it closes', () => {
            expect(openHolidayWindow('holiday_new_year', at(2027, 1, 1, 0))?.year).toBe(2027)
            expect(openHolidayWindow('holiday_new_year', at(2026, 12, 31, 23))).toBeNull()
            expect(openHolidayWindow('holiday_christmas', at(2026, 12, 27, 23))?.year).toBe(2026)
            expect(openHolidayWindow('holiday_christmas', at(2026, 12, 28))).toBeNull()
        })

        it('carries a window over the year boundary under the year its holiday fell in', () => {
            const eve: HolidayDef = { id: 'holiday_new_year', name: 'Eve', date: { kind: 'fixed', month: 12, day: 31 } }
            const open = openHolidayWindows(at(2027, 1, 2), [eve], 3)
            expect(open).toHaveLength(1)
            expect(open[0]!.year).toBe(2026)
            expect(openHolidayWindows(at(2027, 1, 3), [eve], 3)).toHaveLength(0)
        })

        it('names the next gift to open, across the year boundary', () => {
            expect(nextHolidayWindow(at(2026, 10, 9))?.holiday.id).toBe('holiday_halloween')
            // inside Halloween's window the next is Christmas, not Halloween again
            expect(nextHolidayWindow(at(2026, 10, 31))?.holiday.id).toBe('holiday_christmas')
            const next = nextHolidayWindow(at(2026, 12, 26))!
            expect(next.holiday.id).toBe('holiday_new_year')
            expect(next.year).toBe(2027)
            expect(nextHolidayWindow(at(2027, 1, 2))?.holiday.id).toBe('holiday_lunar_new_year')
        })

        it('opens no gift on an ordinary day', () => {
            expect(openHolidayWindows(at(2026, 6, 15))).toEqual([])
        })
    })
})
