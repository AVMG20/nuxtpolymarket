import { describe, expect, it } from 'vitest'
import { D, formatHq, formatSeconds, fromStore, toStore } from '#shared/utils/hero-quest/numbers'

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
        expect(formatHq(999)).toBe('999')
        expect(formatHq(1500)).toBe('1.50K')
        expect(formatHq(2_500_000)).toBe('2.50M')
        expect(formatHq(D(10).pow(40))).toMatch(/e40$/)
    })

    it('never leaks Infinity or NaN into display output', () => {
        expect(formatHq(D(5).pow(1000))).not.toContain('Infinity')
        expect(formatHq(D(5).pow(1000))).not.toContain('NaN')
        expect(formatHq(-1500)).toBe('-1.50K')
    })

    it('formats durations', () => {
        expect(formatSeconds(0.25)).toBe('250ms')
        expect(formatSeconds(45)).toBe('45.0s')
        expect(formatSeconds(3600)).toBe('1h 0m')
    })
})
