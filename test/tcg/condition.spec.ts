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
    it('throws for any shape other than 2', () => {
        expect(() => gammaSample(1, 0.5)).toThrow()
        expect(() => gammaSample(3, 0.5)).toThrow()
        expect(() => gammaSample(2.5, 0.5)).toThrow()
    })

    it('returns non-negative finite values, even when rng returns 0', () => {
        const zeroRng = () => 0
        const v = gammaSample(2, 0.84, zeroRng)
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
    })

    it('has mean near shape * scale', () => {
        const rng = seededRng(12345)
        const n = 20000
        let sum = 0
        for (let i = 0; i < n; i++) sum += gammaSample(2, 0.84, rng)
        expect(sum / n).toBeCloseTo(2 * 0.84, 1)
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

    it('surface entries carry x, y, angle and type', () => {
        let seen = 0
        for (let i = 0; i < 200 && seen < 20; i++) {
            const cond = mintCondition()
            for (const defect of cond.surface) {
                seen++
                expect(defect.x).toBeGreaterThanOrEqual(0)
                expect(defect.x).toBeLessThan(1)
                expect(defect.y).toBeGreaterThanOrEqual(0)
                expect(defect.y).toBeLessThan(1)
                expect(defect.angle).toBeGreaterThanOrEqual(0)
                expect(defect.angle).toBeLessThan(Math.PI)
                expect(['scratch', 'print_line', 'dimple', 'gloss_loss']).toContain(defect.type)
                expect(defect.category === 6 || defect.category === 7).toBe(true)
            }
        }
        expect(seen).toBeGreaterThan(0)
    })

    it('fraction of untouched sites matches the locked 0.9013 within 3%', () => {
        const mints = 2000
        let untouched = 0
        for (let i = 0; i < mints; i++) {
            const cond = mintCondition()
            for (const site of cond.sites) {
                if (site.value === 10) untouched++
            }
        }
        const fraction = untouched / (mints * 16)
        expect(fraction).toBeGreaterThan(0.9013 - 0.03)
        expect(fraction).toBeLessThan(0.9013 + 0.03)
    })

    it('is deterministic given the same rng sequence', () => {
        const a = mintCondition(seededRng(987654321))
        const b = mintCondition(seededRng(987654321))
        expect(a).toEqual(b)

        const c = mintCondition(seededRng(1))
        expect(c).not.toEqual(a)
    })
})
