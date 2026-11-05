import { describe, expect, it } from 'vitest'
import { botLapTime, CIRCUIT_FACTOR, MEDAL_FACTORS, medalFor, medalKey, medalTimes, medalTimesFor, medalUpgrade, nextMedal } from '../../app/utils/nitro-rush/medals'
import { compileCustomTrack } from '#shared/utils/nitro-rush/custom'
import { drive, LONG_RECTANGLE, RECTANGLE, trackOf } from './bot-lap'

const SPRINT = ['straight-20', 'start', 'straight-100', 'right-tight', 'straight-100', 'finish', 'straight-200'] as const

describe('medal times', () => {
    it('sets gold, silver and bronze as shares of the bot lap', () => {
        expect(medalTimesFor(100, false)).toEqual({ gold: 87, silver: 95, bronze: 110 })
        expect(MEDAL_FACTORS.gold).toBeLessThan(MEDAL_FACTORS.silver)
        expect(MEDAL_FACTORS.silver).toBeLessThan(MEDAL_FACTORS.bronze)
    })

    it('sets a circuit tighter than a sprint of the same bot lap, for the tank it gets back at the line', () => {
        const sprint = medalTimesFor(100, false)
        const circuit = medalTimesFor(100, true)
        expect(CIRCUIT_FACTOR).toBeLessThan(1)
        for (const m of ['gold', 'silver', 'bronze'] as const) expect(circuit[m]).toBeCloseTo(Math.round(sprint[m] * CIRCUIT_FACTOR * 10) / 10, 9)
    })

    it('rounds each time to the nearest tenth', () => {
        for (const lap of [10.06, 23.137, 57.7, 61.234]) {
            const times = medalTimesFor(lap, false)
            for (const m of ['gold', 'silver', 'bronze'] as const) {
                expect(times[m]).toBeCloseTo(Math.round(lap * MEDAL_FACTORS[m] * 10) / 10, 9)
                expect(Math.abs(times[m] - lap * MEDAL_FACTORS[m])).toBeLessThanOrEqual(0.05 + 1e-9)
                expect(Math.round(times[m] * 1000) % 100).toBe(0)
            }
        }
    })
})

describe('which medal a lap earns', () => {
    const times = medalTimesFor(20, false)

    it('awards a medal for a lap equal to its time', () => {
        expect(medalFor(times.gold, times)).toBe('gold')
        expect(medalFor(times.silver, times)).toBe('silver')
        expect(medalFor(times.bronze, times)).toBe('bronze')
    })

    it('reads the lap as it is shown, to the millisecond', () => {
        expect(medalFor(times.gold + 0.0004, times)).toBe('gold')
        expect(medalFor(times.gold + 0.001, times)).toBe('silver')
    })

    it('gives the best medal a lap is under', () => {
        expect(medalFor(times.gold - 3, times)).toBe('gold')
        expect(medalFor((times.gold + times.silver) / 2, times)).toBe('silver')
        expect(medalFor((times.silver + times.bronze) / 2, times)).toBe('bronze')
    })

    it('gives no medal past bronze, with no lap or with no times', () => {
        expect(medalFor(times.bronze + 0.001, times)).toBeNull()
        expect(medalFor(times.bronze + 30, times)).toBeNull()
        expect(medalFor(null, times)).toBeNull()
        expect(medalFor(times.gold, null)).toBeNull()
    })

    it('names the next medal up, and none at gold', () => {
        expect(nextMedal(null, times)).toEqual({ medal: 'bronze', time: times.bronze })
        expect(nextMedal('bronze', times)).toEqual({ medal: 'silver', time: times.silver })
        expect(nextMedal('silver', times)).toEqual({ medal: 'gold', time: times.gold })
        expect(nextMedal('gold', times)).toBeNull()
        expect(nextMedal(null, null)).toBeNull()
    })

    it('counts a lap as a new medal only when it beats the one held', () => {
        expect(medalUpgrade(times.bronze, null, times)).toBe('bronze')
        expect(medalUpgrade(times.silver, times.bronze, times)).toBe('silver')
        expect(medalUpgrade(times.gold, times.bronze, times)).toBe('gold')
        expect(medalUpgrade(times.silver - 0.05, times.silver, times)).toBeNull()
        expect(medalUpgrade(times.bronze, times.gold, times)).toBeNull()
        expect(medalUpgrade(times.bronze + 1, null, times)).toBeNull()
        expect(medalUpgrade(times.gold, null, null)).toBeNull()
    })
})

describe('the bot lap behind the medals', () => {
    it('times a loop on its first flying lap', () => {
        const track = trackOf(true, RECTANGLE)
        const lap = botLapTime(track)!
        expect(lap).toBeCloseTo(drive(track, 1).end, 3)
        // The standing first lap from the grid is slower.
        expect(drive(track, 0).end).toBeGreaterThan(lap + 0.01)
    })

    it('times a sprint on its only run', () => {
        const track = trackOf(false, [...SPRINT])
        expect(botLapTime(track)!).toBeCloseTo(drive(track).end, 3)
    })

    it('gives the same times every time', () => {
        const track = trackOf(true, LONG_RECTANGLE)
        expect(botLapTime(track)).toBe(botLapTime(trackOf(true, LONG_RECTANGLE)))
        const def = compileCustomTrack({ id: 'custom-same', name: 'Same', closed: true, sections: RECTANGLE }).def!
        const again = compileCustomTrack({ id: 'custom-same', name: 'Same', closed: true, sections: RECTANGLE }).def!
        expect(medalTimes(def)).toEqual(medalTimes(again))
        expect(medalTimes(def)).toEqual(medalTimesFor(botLapTime(trackOf(true, RECTANGLE))!, true))
    })

    it('works the times out again when a course keeps its id but changes its road', () => {
        const before = compileCustomTrack({ id: 'custom-edit', name: 'Edit', closed: true, sections: RECTANGLE }).def!
        const renamed = compileCustomTrack({ id: 'custom-edit', name: 'Renamed', closed: true, sections: RECTANGLE }).def!
        const after = compileCustomTrack({ id: 'custom-edit', name: 'Edit', closed: true, sections: LONG_RECTANGLE }).def!
        expect(medalKey(renamed)).toBe(medalKey(before))
        expect(medalKey(after)).not.toBe(medalKey(before))
        expect(medalTimes(after)!.gold).toBeGreaterThan(medalTimes(before)!.gold)
    })
})
