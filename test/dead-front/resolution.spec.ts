import { describe, expect, it } from 'vitest'
import { dfAdaptivePixelRatio, dfNewPrGovernor, dfPixelRatioBounds, dfStepPrGovernor } from '../../app/utils/dead-front/engine/resolution'

// CLAUDE.md: never render below native resolution on a dpr 1 screen.

describe('pixel ratio policy', () => {
    it('never renders below native on standard screens and supersamples when affordable', () => {
        const b = dfPixelRatioBounds(1, 1920, 1080, 'high')
        expect(b.min).toBe(1)
        expect(b.max).toBeCloseTo(1.5)
        expect(dfPixelRatioBounds(1, 1920, 1080, 'low').max).toBe(1)
        // a big standard-density screen is capped by the pixel budget but stays native
        const big = dfPixelRatioBounds(1, 3840, 2160, 'high')
        expect(big.min).toBe(1)
        expect(big.max).toBeGreaterThanOrEqual(1)
        expect(big.max).toBeLessThan(1.5)
    })

    it('lets high-density screens back off but not past the floor', () => {
        const b = dfPixelRatioBounds(2, 1440, 900, 'high')
        expect(b.min).toBeCloseTo(1.2)
        expect(b.max).toBe(2)
        let pr = 2
        for (let i = 0; i < 20; i++) pr = dfAdaptivePixelRatio(pr, 30, b, 0, false)
        expect(pr).toBeCloseTo(b.min)
        pr = dfAdaptivePixelRatio(pr, 15, b, 5, false)
        expect(pr).toBeGreaterThan(b.min)
        expect(dfAdaptivePixelRatio(1.5, 15, b, 5, true)).toBe(1.5)
    })

    describe('governor', () => {
        const b = dfPixelRatioBounds(1, 1920, 1080, 'high')
        /** Runs `seconds` of frames `ms` long; returns the pixel ratios it switched to. */
        function run(g: ReturnType<typeof dfNewPrGovernor>, clock: { t: number }, seconds: number, ms: number | ((t: number) => number)): number[] {
            const changes: number[] = []
            const end = clock.t + seconds
            while (clock.t < end) {
                const f = typeof ms === 'number' ? ms : ms(clock.t)
                clock.t += f / 1000
                const before = g.pr
                const pr = dfStepPrGovernor(g, f / 1000, clock.t, b)
                if (pr !== before) changes.push(pr)
            }
            return changes
        }

        it('ignores a single long frame', () => {
            const g = dfNewPrGovernor(b.max)
            const clock = { t: 0 }
            run(g, clock, 3, 16.7)
            expect(run(g, clock, 0.2, () => 250)).toEqual([])
            expect(run(g, clock, 10, 16.7)).toEqual([])
            expect(g.pr).toBe(b.max)
        })

        it('steps down under sustained load, never below native on a dpr 1 screen', () => {
            const g = dfNewPrGovernor(b.max)
            const clock = { t: 0 }
            const changes = run(g, clock, 30, 33.3)
            expect(changes.length).toBeGreaterThan(0)
            expect(g.pr).toBe(b.min)
            expect(g.pr).toBe(1)
        })

        it('steps down on judder that the average hides', () => {
            const g = dfNewPrGovernor(b.max)
            const clock = { t: 0 }
            // one frame in six misses vsync: averages ~19.4 ms, under the plain average's line
            let n = 0
            const changes = run(g, clock, 5, () => (++n % 6 === 0 ? 33.3 : 16.7))
            expect(changes.length).toBeGreaterThan(0)
            expect(g.pr).toBeLessThan(b.max)
        })

        it('steps down when one frame in twenty misses vsync (p95 under 60)', () => {
            const g = dfNewPrGovernor(b.max)
            const clock = { t: 0 }
            let n = 0
            const changes = run(g, clock, 5, () => (++n % 20 === 0 ? 33.3 : 16.7))
            expect(changes.length).toBeGreaterThan(0)
            expect(g.pr).toBeLessThan(b.max)
        })

        it('shrugs off a stray hitch every few seconds', () => {
            const g = dfNewPrGovernor(b.max)
            const clock = { t: 0 }
            let n = 0
            // one 50 ms frame every ~4 s: under 1% of frames
            expect(run(g, clock, 30, () => (++n % 240 === 0 ? 50 : 16.7))).toEqual([])
            expect(g.pr).toBe(b.max)
        })

        it('does not climb into a level that keeps missing frames', () => {
            const g = dfNewPrGovernor(b.min)
            const clock = { t: 0 }
            // fine on average, but one frame in twenty misses vsync
            let n = 0
            expect(run(g, clock, 30, () => (++n % 20 === 0 ? 33.3 : 16.2))).toEqual([])
            expect(g.pr).toBe(b.min)
        })

        it('locks out a step up that had to be taken back, longer each time', () => {
            const g = dfNewPrGovernor(1)
            const clock = { t: 0 }
            // fast at native, too slow at any supersampling
            const ms = () => (g.pr > 1 ? 33.3 : 16.7)
            const ups: number[] = []
            const end = 400
            while (clock.t < end) {
                const before = g.pr
                const f = ms()
                clock.t += f / 1000
                const pr = dfStepPrGovernor(g, f / 1000, clock.t, b)
                if (pr > before) ups.push(clock.t)
            }
            expect(ups.length).toBeGreaterThan(1)
            expect(ups.length).toBeLessThan(5)
            const gaps = ups.slice(1).map((t, i) => t - ups[i]!)
            for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!)
        })
    })
})
