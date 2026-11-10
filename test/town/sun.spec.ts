import { describe, expect, it } from 'vitest'
import { solarElevation, townNightLevel, townPlaceFromTimeZone } from '../../app/utils/town/sun'

const AMSTERDAM = { lat: 52.37, lon: 4.9 }

/** The first minute after `from` at which the sun drops below the horizon (refraction included). */
function sunsetAfter(from: Date, lat: number, lon: number): Date {
    let t = from.getTime()
    while (solarElevation(new Date(t), lat, lon) > -0.833) t += 60_000
    return new Date(t)
}

describe('polytown real sun', () => {
    it('sets in Amsterdam when the almanac says it does', () => {
        // Published sunsets for Amsterdam: 16:57 CET on 10 November, 22:06 CEST on 21 June.
        const november = sunsetAfter(new Date('2026-11-10T12:00:00Z'), AMSTERDAM.lat, AMSTERDAM.lon)
        expect(Math.abs(november.getTime() - Date.parse('2026-11-10T15:57:00Z'))).toBeLessThan(5 * 60_000)
        const june = sunsetAfter(new Date('2026-06-21T12:00:00Z'), AMSTERDAM.lat, AMSTERDAM.lon)
        expect(Math.abs(june.getTime() - Date.parse('2026-06-21T20:06:00Z'))).toBeLessThan(5 * 60_000)
    })

    it('sets in Sydney when the almanac says it does, in both seasons', () => {
        // Published sunsets for Sydney: 20:05 AEDT on 21 December, 16:54 AEST on 21 June.
        const sydney = { lat: -33.87, lon: 151.21 }
        const december = sunsetAfter(new Date('2026-12-21T02:00:00Z'), sydney.lat, sydney.lon)
        expect(Math.abs(december.getTime() - Date.parse('2026-12-21T09:05:00Z'))).toBeLessThan(5 * 60_000)
        const june = sunsetAfter(new Date('2026-06-21T02:00:00Z'), sydney.lat, sydney.lon)
        expect(Math.abs(june.getTime() - Date.parse('2026-06-21T06:54:00Z'))).toBeLessThan(5 * 60_000)
    })

    it('stands high at noon and far below at midnight', () => {
        expect(solarElevation(new Date('2026-06-21T11:40:00Z'), AMSTERDAM.lat, AMSTERDAM.lon)).toBeGreaterThan(60)
        expect(solarElevation(new Date('2026-11-10T23:40:00Z'), AMSTERDAM.lat, AMSTERDAM.lon)).toBeLessThan(-40)
    })

    it('is day in daylight, night after twilight, and mid-dusk at sunset', () => {
        expect(townNightLevel(30)).toBe(0)
        expect(townNightLevel(-20)).toBe(1)
        const atSunset = townNightLevel(-0.833)
        expect(atSunset).toBeGreaterThan(0.4)
        expect(atSunset).toBeLessThan(0.6)
    })

    it('places a known time zone at its city and guesses the rest from the offset', () => {
        expect(townPlaceFromTimeZone('Europe/Amsterdam')).toEqual({ lat: 52.37, lon: 4.9 })
        expect(townPlaceFromTimeZone('Australia/Perth')).toEqual({ lat: -31.95, lon: 115.86 })
        // An unlisted zone ten hours ahead with summer time in January is southern, near 150°E.
        expect(townPlaceFromTimeZone('Australia/Unlisted', [-660, -600])).toEqual({ lat: -34, lon: 150 })
        // One an hour ahead with summer time in July is northern, near 15°E.
        expect(townPlaceFromTimeZone('Europe/Unlisted', [-60, -120])).toEqual({ lat: 48, lon: 15 })
    })
})
