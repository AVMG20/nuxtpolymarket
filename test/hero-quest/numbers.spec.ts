import { describe, expect, it } from 'vitest'
import { D, HQ_NOTATIONS, formatHq, formatHqShort, formatSeconds, fromStore, hqNotationSuffix, isHqNotation, toStore } from '#shared/utils/hero-quest/numbers'

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
        it('prints anything under 1000 plainly in every notation', () => {
            for (const notation of HQ_NOTATIONS) {
                expect(formatHq(0, notation)).toBe('0')
                expect(formatHq(999, notation)).toBe('999')
                expect(formatHq(12.345, notation)).toBe('12.35')
                expect(formatHq(-999, notation)).toBe('-999')
            }
        })

        it.each([
            [1000, '1.00e3', '1.00K', '1.00K'],
            [1500, '1.50e3', '1.50K', '1.50K'],
            [2_500_000, '2.50e6', '2.50M', '2.50M'],
            [1.234e10, '1.23e10', '12.34B', '12.34B'],
            [1e15, '1.00e15', '1.00Qa', '1.00AA'],
            [1.5e17, '1.50e17', '150.00Qa', '150.00AA'],
            [1e18, '1.00e18', '1.00Qi', '1.00AB'],
            [1e63, '1.00e63', '1.00Vg', '1.00AQ'],
            [1e66, '1.00e66', '1.00e66', '1.00AR']
        ])('writes %d as %s, %s and %s', (value, scientific, standard, alphabetical) => {
            expect(formatHq(value, 'scientific')).toBe(scientific)
            expect(formatHq(value, 'standard')).toBe(standard)
            expect(formatHq(value, 'alphabetical')).toBe(alphabetical)
        })

        it('rolls a value that rounds up into the next tier', () => {
            expect(formatHq(999.996, 'scientific')).toBe('1.00e3')
            expect(formatHq(999.996, 'standard')).toBe('1.00K')
            expect(formatHq(999_996, 'standard')).toBe('1.00M')
            expect(formatHq(9.99996e14, 'standard')).toBe('1.00Qa')
            expect(formatHq(9.99996e14, 'alphabetical')).toBe('1.00AA')
            expect(formatHq(9.99996e9, 'scientific')).toBe('1.00e10')
            // the last named tier rolls into scientific, not a tier past the ladder
            expect(formatHq(D('9.99996e65'), 'standard')).toBe('1.00e66')
            expect(formatHq(D('9.99996e54770'), 'alphabetical')).toBe('1.00e54771')
            // below the rounding point it stays put
            expect(formatHq(999.994, 'standard')).toBe('999.99')
            expect(formatHq(9.9999e14, 'alphabetical')).toBe('999.99T')
        })

        it('keeps the sign on negatives', () => {
            expect(formatHq(-1500, 'scientific')).toBe('-1.50e3')
            expect(formatHq(-1500, 'standard')).toBe('-1.50K')
            expect(formatHq(-2e15, 'alphabetical')).toBe('-2.00AA')
            expect(formatHq(D('-1e400'), 'standard')).toBe('-1.00e400')
        })

        it('runs alphabetical letters AA to AZ, BA to ZZ, then AAA to ZZZ', () => {
            const at = (tier: number) => formatHq(D(10).pow(3 * tier), 'alphabetical')
            expect(at(4)).toBe('1.00T')
            expect(at(5)).toBe('1.00AA')
            expect(at(5 + 25)).toBe('1.00AZ')
            expect(at(5 + 26)).toBe('1.00BA')
            expect(at(5 + 675)).toBe('1.00ZZ')
            expect(at(5 + 676)).toBe('1.00AAA')
            expect(at(5 + 676 + 17_575)).toBe('1.00ZZZ')
            expect(at(5 + 676 + 17_576)).toMatch(/^1\.00e/)
        })

        it('names each tier once, in order', () => {
            expect(hqNotationSuffix('standard', 1)).toBe('K')
            expect(hqNotationSuffix('standard', 5)).toBe('Qa')
            expect(hqNotationSuffix('scientific', 1)).toBeNull()
            const names = Array.from({ length: 676 + 17_576 }, (_, i) => hqNotationSuffix('alphabetical', i + 5))
            expect(new Set(names).size).toBe(names.length)
            expect(names.every(name => name !== null && /^[A-Z]{2,3}$/.test(name))).toBe(true)
        })

        it('writes Decimals past a double in every notation', () => {
            expect(formatHq(D(5).pow(1000), 'scientific')).toBe('9.33e698')
            expect(formatHq(D(5).pow(1000), 'standard')).toBe('9.33e698')
            expect(formatHq(D(5).pow(1000), 'alphabetical')).toBe('933.26IT')
            // an exponent too big for a double is itself written in the notation
            expect(formatHq(D('ee20'), 'scientific')).toBe('e1.00e20')
            expect(formatHq(D('ee20'), 'standard')).toBe('e100.00Qi')
        })

        it('writes a short form to three figures for the stage', () => {
            expect(formatHqShort(1840, 'scientific')).toBe('1.84e3')
            expect(formatHqShort(99_999, 'standard')).toBe('100K')
            expect(formatHqShort(123_456, 'alphabetical')).toBe('123K')
            expect(formatHqShort(9.999e14, 'standard')).toBe('1.00Qa')
            expect(formatHqShort(2.407e18, 'alphabetical')).toBe('2.41AB')
            expect(formatHqShort(99_999, 'scientific')).toBe('1.00e5')
            expect(formatHqShort(0.123, 'standard')).toBe('0.123')
            expect(formatHqShort('1e-50', 'scientific')).toBe('0')
            expect(formatHqShort('1e-400', 'standard')).toBe('0')
        })

        it('accepts only the three notations', () => {
            for (const notation of HQ_NOTATIONS) expect(isHqNotation(notation)).toBe(true)
            for (const bad of ['engineering', 'Scientific', '', true, 1, null, undefined]) expect(isHqNotation(bad)).toBe(false)
        })
    })

    it('formats durations', () => {
        expect(formatSeconds(0.25)).toBe('250ms')
        expect(formatSeconds(45)).toBe('45.0s')
        expect(formatSeconds(3600)).toBe('1h 0m')
    })
})
