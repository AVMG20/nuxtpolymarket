import { describe, it, expect, afterEach, vi } from 'vitest'
import { randomFloat, randomInt, randomPick, randomWeighted } from '../../shared/utils/random'

afterEach(() => {
    vi.restoreAllMocks()
})

/** Force the raw entropy randomFloat() reads, without stub-random's packing. */
function stubEntropy(fill: number) {
    return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        (array as unknown as Uint32Array).fill(fill)
        return array
    })
}

describe('randomFloat bounds', () => {
    // The bug this pins: `x / 0xFFFFFFFF` reaches exactly 1.0 on all-ones entropy,
    // so Math.floor(r * len) indexes one past the end of an array. randomFloat
    // divides by 2^53 and must stay in [0, 1) for every possible input.
    it('stays below 1 when every entropy bit is set', () => {
        stubEntropy(0xFFFFFFFF)
        expect(randomFloat()).toBeLessThan(1)
        expect(randomFloat()).toBeGreaterThan(0.9999999)
    })

    it('returns 0 when no entropy bit is set', () => {
        stubEntropy(0)
        expect(randomFloat()).toBe(0)
    })

    it('never indexes off the end of an array on all-ones entropy', () => {
        stubEntropy(0xFFFFFFFF)
        expect(randomPick(['a', 'b', 'c'])).toBe('c')
        expect(randomInt(1, 6)).toBe(6)
    })
})

interface Item { id: string; weight: number }

const items: Item[] = [
    { id: 'a', weight: 10 },
    { id: 'b', weight: 20 },
    { id: 'c', weight: 30 }
]

describe('randomWeighted', () => {
    it('picks the first item when the roll lands exactly on the lower boundary', () => {
        const picked = randomWeighted(items, i => i.weight, () => 0)
        expect(picked.id).toBe('a')
    })

    it('picks whichever bucket the roll falls inside', () => {
        // total = 60. rng() = 0.2 → roll = 12, past 'a' (10), lands in 'b' (10..30)
        const picked = randomWeighted(items, i => i.weight, () => 0.2)
        expect(picked.id).toBe('b')
    })

    it('falls back to the last item as rng() approaches (but never reaches) 1', () => {
        const picked = randomWeighted(items, i => i.weight, () => 0.999999)
        expect(picked.id).toBe('c')
    })

    it('never picks a zero-weight item when non-zero siblings exist', () => {
        const withZero: Item[] = [
            { id: 'zero-a', weight: 0 },
            { id: 'real', weight: 5 },
            { id: 'zero-b', weight: 0 }
        ]
        for (let i = 0; i < 50; i++) {
            const rng = () => i / 50
            expect(randomWeighted(withZero, item => item.weight, rng).id).toBe('real')
        }
    })

    it('always returns the only item in a single-item list', () => {
        const single: Item[] = [{ id: 'only', weight: 42 }]
        expect(randomWeighted(single, i => i.weight, () => 0).id).toBe('only')
        expect(randomWeighted(single, i => i.weight, () => 0.999999).id).toBe('only')
    })
})
