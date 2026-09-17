import { describe, expect, it } from 'vitest'
import { parseAmount } from '../shared/utils/parse-amount'

describe('parseAmount', () => {
    it('reads plain numbers', () => {
        expect(parseAmount('200')).toBe(200)
        expect(parseAmount(' 1 000 000 ')).toBe(1_000_000)
        expect(parseAmount('12.5')).toBe(12.5)
        expect(parseAmount('12,5')).toBe(12.5)
    })

    it('expands k, m, b and t suffixes case-insensitively', () => {
        expect(parseAmount('200k')).toBe(200_000)
        expect(parseAmount('2.5M')).toBe(2_500_000)
        expect(parseAmount('2b')).toBe(2_000_000_000)
        expect(parseAmount('1T')).toBe(1_000_000_000_000)
        expect(parseAmount('1,5k')).toBe(1500)
    })

    it('rejects junk, zero and negatives', () => {
        expect(parseAmount('')).toBeNull()
        expect(parseAmount('abc')).toBeNull()
        expect(parseAmount('0')).toBeNull()
        expect(parseAmount('-5k')).toBeNull()
        expect(parseAmount('5kk')).toBeNull()
        expect(parseAmount('1e5')).toBeNull()
    })
})
