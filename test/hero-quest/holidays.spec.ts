import { describe, expect, it } from 'vitest'
import { HOLIDAYS, LUNAR_NEW_YEAR_DATES, isHolidayId, type HolidayDef } from '#shared/utils/hero-quest/content/holidays'
import { easterSunday, holidayDayIn, holidayGift, holidayGiftGold, openHolidayWindow, openHolidayWindows } from '#shared/utils/hero-quest/holidays'
import { HOLIDAY_CLAIM_WINDOW_DAYS, HOLIDAY_GIFTS } from '#shared/utils/hero-quest/constants'
import { GACHA_SYSTEMS } from '#shared/utils/hero-quest/gacha'

const DAY = 86_400_000
/** `hour` o'clock UTC on a date. */
const at = (year: number, month: number, day: number, hour = 12) => Date.UTC(year, month - 1, day, hour)

describe('hero-quest holiday gifts', () => {
    it('has the roster with stable, unique IDs, and a gift for each', () => {
        expect(HOLIDAYS.map(h => h.id)).toEqual(['holiday_new_year', 'holiday_lunar_new_year', 'holiday_valentines', 'holiday_easter', 'holiday_halloween', 'holiday_christmas'])
        expect(new Set(HOLIDAYS.map(h => h.id)).size).toBe(HOLIDAYS.length)
        expect(Object.keys(HOLIDAY_GIFTS).sort()).toEqual(HOLIDAYS.map(h => h.id).sort())
        expect(isHolidayId('holiday_easter')).toBe(true)
        expect(isHolidayId('holiday_diwali')).toBe(false)
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

        it('computes Easter Sunday for any year, the Gregorian way', () => {
            const known: [number, number, number][] = [[2024, 3, 31], [2025, 4, 20], [2026, 4, 5], [2027, 3, 28], [2028, 4, 16], [2038, 4, 25], [2049, 4, 18], [2100, 3, 28]]
            for (const [year, month, day] of known) expect(easterSunday(year)).toEqual({ month, day })
            // always between March 22 and April 25
            for (let year = 2024; year <= 2200; year++) {
                const { month, day } = easterSunday(year)
                expect(month * 100 + day).toBeGreaterThanOrEqual(322)
                expect(month * 100 + day).toBeLessThanOrEqual(425)
            }
            expect(openHolidayWindow('holiday_easter', at(2026, 4, 5))?.year).toBe(2026)
            expect(openHolidayWindow('holiday_easter', at(2026, 4, 4))).toBeNull()
            expect(openHolidayWindow('holiday_easter', at(2027, 3, 28))?.year).toBe(2027)
        })

        it('opens Valentine\'s Day on February 14, beside a Lunar New Year that falls in its window', () => {
            expect(openHolidayWindow('holiday_valentines', at(2026, 2, 14, 0))?.year).toBe(2026)
            expect(openHolidayWindow('holiday_valentines', at(2026, 2, 13, 23))).toBeNull()
            // 2029: Lunar New Year on the 13th, so both gifts are open on the 14th and 15th
            expect(openHolidayWindows(at(2029, 2, 14)).map(w => w.holiday.id)).toEqual(['holiday_lunar_new_year', 'holiday_valentines'])
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

        it('opens no gift on an ordinary day', () => {
            expect(openHolidayWindows(at(2026, 6, 15))).toEqual([])
        })
    })
})
