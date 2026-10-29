import { describe, it, expect } from 'vitest'
import { gammaSample, mintCondition } from '#shared/utils/tcg/condition'

// Deterministic rng stub: xorshift32, returns floats in [0, 1)
function seededRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s ^= s << 13
        s ^= s >>> 17
        s ^= s << 5
        s >>>= 0
        return s / 0x100000000
    }
}

describe('gammaSample', () => {
    it('returns non-negative finite values, even when rng returns 0', () => {
        const zeroRng = () => 0
        const v = gammaSample(2, 0.84, zeroRng)
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
    })
})

describe('mintCondition', () => {
    it('returns 16 sites with categories 2-5 and values in [6.3, 10]', () => {
        for (let i = 0; i < 50; i++) {
            const cond = mintCondition()
            expect(cond.sites).toHaveLength(16)
            for (const site of cond.sites) {
                expect(typeof site.id).toBe('string')
                expect(site.category).toBeGreaterThanOrEqual(2)
                expect(site.category).toBeLessThanOrEqual(5)
                expect(site.value).toBeGreaterThanOrEqual(6.3)
                expect(site.value).toBeLessThanOrEqual(10)
            }
        }
    })

    it('returns 8 subs in [6.3, 10] with centering strictly below 10', () => {
        for (let i = 0; i < 50; i++) {
            const cond = mintCondition()
            expect(cond.subs).toHaveLength(8)
            for (const sub of cond.subs) {
                expect(sub).toBeGreaterThanOrEqual(6.3)
                expect(sub).toBeLessThanOrEqual(10)
            }
            expect(cond.subs[0]).toBeLessThan(10)
            expect(cond.subs[1]).toBeLessThan(10)
        }
    })

    it('is deterministic given the same rng sequence', () => {
        const a = mintCondition(seededRng(987654321))
        const b = mintCondition(seededRng(987654321))
        expect(a).toEqual(b)

        const c = mintCondition(seededRng(1))
        expect(c).not.toEqual(a)
    })
})
