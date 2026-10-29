import { describe, expect, it } from 'vitest'
import { NC_RACE_DURATION, NC_RACE_STEP, planRace } from '#shared/utils/neighcasso/race'

describe('planRace', () => {
    it('only lets the chosen winner reach the post, and only on the last frame', () => {
        const frames = Math.round(NC_RACE_DURATION / NC_RACE_STEP) + 1
        const problems: string[] = []
        for (let i = 0; i < 50; i++) {
            const seats = [0, 1, 2, 3, 4, 5].slice(0, 2 + (i % 5))
            const winner = seats[i % seats.length]!
            const { lanes } = planRace(seats, winner)
            for (const lane of lanes) {
                const tag = `race ${i} seat ${lane.seat}`
                if (lane.frames.length !== frames) problems.push(`${tag}: ${lane.frames.length} frames`)
                if (lane.frames[0] !== 0) problems.push(`${tag}: does not start at the gate`)
                if (lane.frames.some(v => v < 0)) problems.push(`${tag}: runs backwards past the gate`)
                const early = Math.max(...lane.frames.slice(0, -1))
                const last = lane.frames.at(-1)!
                if (early >= 1) problems.push(`${tag}: reaches the post early`)
                if (lane.seat === winner ? last !== 1 : last >= 1) problems.push(`${tag}: wrong finish ${last}`)
            }
        }
        expect(problems).toEqual([])
    })

    it('refuses a winner that is not running', () => {
        expect(() => planRace([0, 1], 3)).toThrow()
    })
})
