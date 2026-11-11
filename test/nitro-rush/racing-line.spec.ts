import { describe, expect, it } from 'vitest'
import { TrackLine } from '#shared/utils/nitro-rush/track'
import { RACING_MARGIN } from '#shared/utils/nitro-rush/racing-line'
import { Path } from './fork-courses'

const ROAD = { halfWidth: 9, wallOffset: 10.6 }

const lineOf = (path: Path) => new TrackLine({ points: path.pts, ...ROAD, closed: false })
const tightest = (bends: ArrayLike<number>) => Math.max(...Array.from(bends, Math.abs))

describe('racing curvature', () => {
    it('straightens a gentle kink well past the radius of its centreline', () => {
        for (const dir of [1, -1] as const) {
            const line = lineOf(new Path(0, 0).straight(200).arc(dir, 60, Math.PI / 9).straight(200))
            expect(1 / tightest(line.racingCurvature)).toBeGreaterThan(4 / tightest(line.curvature))
            // The apex sits on the inside of the bend.
            expect(Math.sign(line.racingOffsetAt(line.length / 2))).toBe(dir)
        }
    })

    it('leaves a hairpin about as tight as the road', () => {
        const line = lineOf(new Path(0, 0).straight(200).arc(1, 25, Math.PI).straight(200))
        expect(tightest(line.racingCurvature)).toBeCloseTo(tightest(line.curvature), 2)
    })

    it('is zero on a straight', () => {
        const line = lineOf(new Path(0, 0).straight(400))
        expect(tightest(line.racingCurvature)).toBe(0)
        expect(tightest(line.racing.offsets)).toBe(0)
    })

    it('keeps the car clear of the edges', () => {
        const line = lineOf(new Path(0, 0).straight(200).arc(1, 60, Math.PI / 9).straight(100).arc(-1, 25, Math.PI).straight(200))
        expect(tightest(line.racing.offsets)).toBeLessThanOrEqual(ROAD.halfWidth - RACING_MARGIN + 1e-9)
    })
})
