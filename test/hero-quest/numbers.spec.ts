import { describe, expect, it } from 'vitest'
import { D, HQ_NOTATIONS, formatHq, fromStore, isHqNotation, toStore } from '#shared/utils/hero-quest/numbers'

describe('hero-quest numbers', () => {
    it('round-trips beyond native float range', () => {
        const huge = D(5).pow(1000)
        expect(fromStore(toStore(huge)).eq(huge)).toBe(true)
    })

    it('round-trips ordinary values exactly', () => {
        for (const value of [0, 1, 42, 1234.5678, 1e15]) {
            expect(fromStore(toStore(value)).toNumber()).toBeCloseTo(value, 6)
        }
    })

    it('falls back on empty and malformed stored values', () => {
        expect(fromStore(null).toNumber()).toBe(0)
        expect(fromStore(undefined).toNumber()).toBe(0)
        expect(fromStore('').toNumber()).toBe(0)
        expect(fromStore('not-a-number', 7).toNumber()).toBe(7)
    })

    it('formats across the suffix ladder and into scientific notation', () => {
        expect(formatHq(999, 'standard')).toBe('999')
        expect(formatHq(1500, 'standard')).toBe('1.50K')
        expect(formatHq(2_500_000, 'standard')).toBe('2.50M')
        expect(formatHq(D(10).pow(70), 'standard')).toMatch(/e70$/)
    })

    it('never leaks Infinity or NaN into display output', () => {
        for (const notation of HQ_NOTATIONS) {
            expect(formatHq(D(5).pow(1000), notation)).not.toContain('Infinity')
            expect(formatHq(D(5).pow(1000), notation)).not.toContain('NaN')
        }
        expect(formatHq(-1500, 'standard')).toBe('-1.50K')
        expect(formatHq(Infinity, 'scientific')).toBe('∞')
        expect(formatHq(-Infinity, 'standard')).toBe('-∞')
        expect(formatHq(NaN, 'alphabetical')).toBe('NaN')
    })

    describe('notations', () => {
        it('rolls a value that rounds up into the next tier', () => {
            expect(formatHq(999.996, 'scientific')).toBe('1.00e3')
            expect(formatHq(999.996, 'standard')).toBe('1.00K')
            expect(formatHq(999_996, 'standard')).toBe('1.00M')
            expect(formatHq(9.99996e14, 'standard')).toBe('1.00Qa')
            expect(formatHq(9.99996e14, 'alphabetical')).toBe('1.00AA')
            // the last named tier rolls into scientific, not a tier past the ladder
            expect(formatHq(D('9.99996e65'), 'standard')).toBe('1.00e66')
            // below the rounding point it stays put
            expect(formatHq(999.994, 'standard')).toBe('999.99')
            expect(formatHq(9.9999e14, 'alphabetical')).toBe('999.99T')
        })

        it('accepts only the three notations', () => {
            for (const notation of HQ_NOTATIONS) expect(isHqNotation(notation)).toBe(true)
            for (const bad of ['engineering', 'Scientific', '', true, 1, null, undefined]) expect(isHqNotation(bad)).toBe(false)
        })
    })
})
