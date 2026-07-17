import { describe, it, expect, afterEach, vi } from 'vitest'
import { stubRandomFloat } from '../setup/stub-random'
import { playWheel, WHEEL_CONFIGS, type WheelDifficulty } from '../../shared/utils/gamelogic/wheel'

afterEach(() => {
    vi.restoreAllMocks()
})

describe('playWheel maximum roll', () => {
    // The mapping loop leaves segmentIndex/multiplier at 0 if idx is ever >=
    // totalSegments, so a losing 0x is indistinguishable from falling off the end.
    // The all-ones entropy case that could actually push idx that far is pinned in
    // test/shared/random.spec.ts — stubRandomFloat cannot reach it, since it packs
    // the low bits of buf[0] with zeroes.
    it('selects the last segment at the top of the roll range', () => {
        stubRandomFloat(() => 1 - Number.EPSILON / 2)
        for (const difficulty of Object.keys(WHEEL_CONFIGS) as WheelDifficulty[]) {
            const segments = WHEEL_CONFIGS[difficulty]
            const last = segments[segments.length - 1]!
            const result = playWheel(100, { difficulty })
            expect(result.segmentIndex).toBe(segments.length - 1)
            expect(result.multiplier).toBe(last.multiplier)
        }
    })
})

// Same crypto.getRandomValues(len-1 array) pattern as dice.ts — see the note
// in dice.spec.ts. Centered fractions (f = (idx + 0.5) / totalSegments) land
// comfortably inside a single segment bucket regardless of the ~1e-9 wobble.

describe('playWheel validation', () => {
    it('defaults difficulty to medium when no options are given', () => {
        stubRandomFloat(() => 0.05)
        expect(playWheel(100).difficulty).toBe('medium')
    })

    it('rejects an unknown difficulty', () => {
        expect(() => playWheel(100, { difficulty: 'extreme' })).toThrow()
    })

    it('accepts each configured difficulty', () => {
        stubRandomFloat(() => 0.05)
        for (const difficulty of ['easy', 'medium', 'hard']) {
            expect(() => playWheel(100, { difficulty })).not.toThrow()
        }
    })
})

describe('WHEEL_CONFIGS segment layout', () => {
    it('every difficulty has 10 total segments', () => {
        for (const segments of Object.values(WHEEL_CONFIGS)) {
            expect(segments.reduce((sum, seg) => sum + seg.count, 0)).toBe(10)
        }
    })

    it('matches the documented win chance per difficulty', () => {
        const winChance = (segments: typeof WHEEL_CONFIGS.easy) =>
            segments.filter(seg => seg.multiplier > 0).reduce((sum, seg) => sum + seg.count, 0) / 10

        expect(winChance(WHEEL_CONFIGS.easy)).toBeCloseTo(0.6, 10)
        expect(winChance(WHEEL_CONFIGS.medium)).toBeCloseTo(0.5, 10)
        expect(winChance(WHEEL_CONFIGS.hard)).toBeCloseTo(0.3, 10)
    })
})

describe('playWheel segment selection', () => {
    it('picks the segment the roll lands in, easy difficulty', () => {
        stubRandomFloat(() => 0.05) // idx 0 -> red, loss
        const loss = playWheel(100, { difficulty: 'easy' })
        expect(loss.segmentIndex).toBe(0)
        expect(loss.multiplier).toBe(0)
        expect(loss.won).toBe(false)
        expect(loss.payout).toBe(0)

        stubRandomFloat(() => 0.95) // idx 9 -> yellow, top win
        const win = playWheel(100, { difficulty: 'easy' })
        expect(win.segmentIndex).toBe(3)
        expect(win.multiplier).toBe(2)
        expect(win.won).toBe(true)
        expect(win.payout).toBe(200)
    })

    it('picks the segment the roll lands in, hard difficulty', () => {
        stubRandomFloat(() => 0.65) // idx 6 -> still red, loss
        const loss = playWheel(100, { difficulty: 'hard' })
        expect(loss.segmentIndex).toBe(0)
        expect(loss.won).toBe(false)

        stubRandomFloat(() => 0.75) // idx 7 -> blue
        const blue = playWheel(100, { difficulty: 'hard' })
        expect(blue.segmentIndex).toBe(1)
        expect(blue.multiplier).toBe(1.8)

        stubRandomFloat(() => 0.95) // idx 9 -> yellow, top win
        const top = playWheel(100, { difficulty: 'hard' })
        expect(top.segmentIndex).toBe(3)
        expect(top.multiplier).toBe(5)
        expect(top.payout).toBe(500)
    })
})

describe('playWheel payout', () => {
    it('pays bet x segment multiplier on a win and nothing on a loss', () => {
        stubRandomFloat(() => 0.75) // medium idx 7 -> green (2x)
        const win = playWheel(300, { difficulty: 'medium' })
        expect(win.won).toBe(true)
        expect(win.payout).toBe(300 * win.multiplier)

        stubRandomFloat(() => 0.25) // medium idx 2 -> red (0x)
        const loss = playWheel(300, { difficulty: 'medium' })
        expect(loss.won).toBe(false)
        expect(loss.payout).toBe(0)
    })

    it('does not include a separate cost field — the caller stakes exactly bet', () => {
        stubRandomFloat(() => 0.05)
        const result = playWheel(100, { difficulty: 'medium' })
        expect('cost' in result).toBe(false)
    })
})
