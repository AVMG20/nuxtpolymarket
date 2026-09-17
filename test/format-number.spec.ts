import { describe, expect, it } from 'vitest'
import formatNumber from '../app/utils/format-number'

describe('formatNumber', () => {
    it('formats standard non-compact numbers', () => {
        expect(formatNumber(1000, false)).toBe('1.000')
        expect(formatNumber(50000000, false)).toBe('50.000.000')
    })

    it('formats compact numbers with m, B, T, K suffixes', () => {
        expect(formatNumber(1000)).toBe('1K')
        expect(formatNumber(1200)).toBe('1,2K')
        expect(formatNumber(50000000)).toBe('50m')
        expect(formatNumber(1500000)).toBe('1,5m')
        expect(formatNumber(1000000000)).toBe('1B')
        expect(formatNumber(2500000000)).toBe('2,5B')
        expect(formatNumber(1000000000000)).toBe('1T')
    })
})
