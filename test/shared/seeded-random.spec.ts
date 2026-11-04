import { describe, expect, it } from 'vitest'
import { SeededRandom, createSeededRandom } from '#shared/utils/random'

function draws(rng: SeededRandom, count: number): number[] {
    const out: number[] = []
    for (let i = 0; i < count; i++) out.push(rng.next())
    return out
}

describe('SeededRandom', () => {
    it('gives identical 1000-value sequences for the same seed', () => {
        expect(draws(new SeededRandom(12345), 1000)).toEqual(draws(createSeededRandom(12345), 1000))
    })

    it('keeps its exact sequence: Rail Tycoon saves and lockstep peers replay it', () => {
        const rng = new SeededRandom(12345)
        expect([rng.next(), rng.next(), rng.next(), rng.randomInt(1, 6), rng.randomRatio(1, 4)])
            .toEqual([4207900869, 1317490944, 2079646450, 5, false])
    })

    it('gives different sequences for different seeds', () => {
        expect(draws(new SeededRandom(1), 1000)).not.toEqual(draws(new SeededRandom(2), 1000))
    })

    it('returns u32 integers only', () => {
        for (const v of draws(new SeededRandom(0xffffffff), 1000)) {
            expect(Number.isInteger(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(0xffffffff)
        }
    })

    it('resumes the identical remaining sequence from a saved state', () => {
        const a = new SeededRandom(777)
        draws(a, 500)
        const saved = a.state
        const rest = draws(a, 500)
        const b = new SeededRandom(1)
        b.state = saved
        expect(draws(b, 500)).toEqual(rest)
    })

    it('keeps randomInt(1, 6) within 5 percent of uniform over 60000 draws', () => {
        const rng = new SeededRandom(42)
        const counts = [0, 0, 0, 0, 0, 0]
        for (let i = 0; i < 60000; i++) {
            const face = rng.randomInt(1, 6)
            expect(Number.isInteger(face)).toBe(true)
            counts[face - 1]!++
        }
        for (const c of counts) {
            expect(c).toBeGreaterThanOrEqual(9500)
            expect(c).toBeLessThanOrEqual(10500)
        }
    })

    it('keeps randomRatio(1, 4) within 5 percent of 10000 over 40000 draws', () => {
        const rng = new SeededRandom(4242)
        let hits = 0
        for (let i = 0; i < 40000; i++) if (rng.randomRatio(1, 4)) hits++
        expect(hits).toBeGreaterThanOrEqual(9500)
        expect(hits).toBeLessThanOrEqual(10500)
    })

    it('keeps randomFloat in [0, 1) and randomChance near its probability', () => {
        const rng = new SeededRandom(99)
        let hits = 0
        for (let i = 0; i < 40000; i++) {
            const f = rng.randomFloat()
            expect(f).toBeGreaterThanOrEqual(0)
            expect(f).toBeLessThan(1)
            if (rng.randomChance(0.25)) hits++
        }
        expect(hits).toBeGreaterThanOrEqual(9500)
        expect(hits).toBeLessThanOrEqual(10500)
        expect(rng.randomChance(0)).toBe(false)
        expect(rng.randomChance(1)).toBe(true)
    })

    it('picks every element of a list, and only those', () => {
        const rng = new SeededRandom(5)
        const items = ['a', 'b', 'c', 'd'] as const
        const seen = new Set<string>()
        for (let i = 0; i < 400; i++) seen.add(rng.randomPick(items))
        expect([...seen].sort()).toEqual([...items])
    })

    it('handles degenerate and full-width ranges', () => {
        const rng = new SeededRandom(9)
        expect(rng.randomInt(5, 5)).toBe(5)
        expect(rng.randomRatio(0, 7)).toBe(false)
        expect(rng.randomRatio(7, 7)).toBe(true)
        const v = rng.randomInt(0, 0xffffffff)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(0xffffffff)
        expect(rng.randomInt(-3, -1)).toBeLessThan(0)
    })

    it('refuses bad seeds, states and ranges', () => {
        expect(() => new SeededRandom(-1)).toThrow(RangeError)
        expect(() => new SeededRandom(2 ** 32)).toThrow(RangeError)
        expect(() => new SeededRandom(1.5)).toThrow(RangeError)
        const rng = new SeededRandom(1)
        expect(() => {
            rng.state = -1
        }).toThrow(RangeError)
        expect(() => rng.randomInt(2, 1)).toThrow(RangeError)
        expect(() => rng.randomInt(0, 2 ** 32)).toThrow(RangeError)
        expect(() => rng.randomInt(0.5, 2)).toThrow(RangeError)
        expect(() => rng.randomRatio(1, 0)).toThrow(RangeError)
        expect(() => rng.randomRatio(-1, 4)).toThrow(RangeError)
    })
})
