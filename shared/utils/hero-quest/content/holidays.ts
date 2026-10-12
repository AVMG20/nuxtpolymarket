/**
 * The holiday roster (`holiday-events.md` §1): real-world holidays that each bring a claimable
 * gift, once per holiday per year. First pass; another holiday is a row here and a gift in
 * `HOLIDAY_GIFTS`, never a system change. IDs are stable: a claim row stores them.
 *
 * Dates are UTC days (§2). Most are fixed. Lunar New Year moves with the lunisolar calendar, so it
 * reads a lookup table instead; a year missing from the table simply has no Lunar New Year gift,
 * which `holidays.spec.ts` guards against by asserting the table runs far enough ahead. Easter
 * (Western, Gregorian) is computed, so it needs no table.
 */

export type HolidayId = 'holiday_new_year' | 'holiday_lunar_new_year' | 'holiday_valentines' | 'holiday_easter' | 'holiday_halloween' | 'holiday_christmas'

export type HolidayDate =
    | { kind: 'fixed', month: number, day: number }
    /** Year → `MM-DD`. */
    | { kind: 'table', dates: Readonly<Record<number, string>> }
    /** Western Easter Sunday, computed for any year. */
    | { kind: 'easter' }

export interface HolidayDef {
    id: HolidayId
    name: string
    date: HolidayDate
}

/**
 * Lunar New Year's first day, year → `MM-DD`, as the Gregorian date it falls on in China
 * (UTC+8), taken as the UTC day of the same date.
 */
export const LUNAR_NEW_YEAR_DATES: Readonly<Record<number, string>> = {
    2024: '02-10', 2025: '01-29', 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13',
    2030: '02-03', 2031: '01-23', 2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08',
    2036: '01-28', 2037: '02-15', 2038: '02-04', 2039: '01-24', 2040: '02-12', 2041: '02-01',
    2042: '01-22', 2043: '02-10', 2044: '01-30', 2045: '02-17', 2046: '02-06', 2047: '01-26',
    2048: '02-14', 2049: '02-02', 2050: '01-23'
}

export const HOLIDAYS: readonly HolidayDef[] = [
    { id: 'holiday_new_year', name: "New Year's Day", date: { kind: 'fixed', month: 1, day: 1 } },
    { id: 'holiday_lunar_new_year', name: 'Lunar New Year', date: { kind: 'table', dates: LUNAR_NEW_YEAR_DATES } },
    { id: 'holiday_valentines', name: "Valentine's Day", date: { kind: 'fixed', month: 2, day: 14 } },
    { id: 'holiday_easter', name: 'Easter', date: { kind: 'easter' } },
    { id: 'holiday_halloween', name: 'Halloween', date: { kind: 'fixed', month: 10, day: 31 } },
    { id: 'holiday_christmas', name: 'Christmas', date: { kind: 'fixed', month: 12, day: 25 } }
]

export function isHolidayId(value: unknown): value is HolidayId {
    return typeof value === 'string' && HOLIDAYS.some(h => h.id === value)
}

export function getHoliday(id: HolidayId): HolidayDef {
    const holiday = HOLIDAYS.find(h => h.id === id)
    if (!holiday) throw new Error(`Unknown holiday: ${id}`)
    return holiday
}
