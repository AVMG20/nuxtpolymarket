import { describe, expect, it } from 'vitest'
import { dfAdaptivePixelRatio, dfPixelRatioBounds } from '../../app/utils/dead-front/engine/resolution'

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
})
