import { describe, expect, it } from 'vitest'
import { leadChanges, NC_RACE_DURATION, NC_RACE_STEP, planRace } from '#shared/utils/neighcasso/race'

describe('planRace', () => {
    it('only lets the chosen winner reach the post, and only on the last frame', () => {
        for (let i = 0; i < 300; i++) {
            const seats = [0, 1, 2, 3, 4, 5].slice(0, 2 + (i % 5))
            const winner = seats[i % seats.length]!
            const { lanes } = planRace(seats, winner)
            const frames = Math.round(NC_RACE_DURATION / NC_RACE_STEP) + 1
            for (const lane of lanes) {
                expect(lane.frames).toHaveLength(frames)
                expect(lane.frames[0]).toBe(0)
                const last = lane.frames.at(-1)!
                if (lane.seat === winner) {
                    expect(last).toBe(1)
                    expect(Math.max(...lane.frames.slice(0, -1))).toBeLessThan(1)
                } else {
                    expect(Math.max(...lane.frames)).toBeLessThan(1)
                }
                for (const v of lane.frames) expect(v).toBeGreaterThanOrEqual(0)
            }
        }
    })

    it('gives the crowd some back-and-forth most of the time', () => {
        let dramatic = 0
        for (let i = 0; i < 100; i++) {
            if (leadChanges(planRace([0, 1, 2, 3], i % 4).lanes) >= 2) dramatic++
        }
        expect(dramatic).toBeGreaterThan(80)
    })

    it('keeps the winner out of trouble on the home straight', () => {
        for (let i = 0; i < 200; i++) {
            const { events } = planRace([0, 1, 2], 1)
            for (const e of events.filter(e => e.seat === 1)) {
                expect(e.at + e.duration).toBeLessThanOrEqual(NC_RACE_DURATION - 2.5)
            }
        }
    })

    it('refuses a winner that is not running', () => {
        expect(() => planRace([0, 1], 3)).toThrow()
    })
})
