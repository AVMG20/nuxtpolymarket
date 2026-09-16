import { describe, expect, it } from 'vitest'
import { amountPreview } from '../app/utils/amount-preview'

describe('amountPreview', () => {
    it('spells out shorthand and long plain numbers', () => {
        expect(amountPreview('10m')).toBe('10.000.000')
        expect(amountPreview('2.5k')).toBe('2.500')
        expect(amountPreview('1000000')).toBe('1.000.000')
    })

    it('stays empty for junk, blanks and numbers that already read the same', () => {
        expect(amountPreview('abc')).toBe('')
        expect(amountPreview('')).toBe('')
        expect(amountPreview(undefined)).toBe('')
        expect(amountPreview('500')).toBe('')
    })

    it('floors when the amount is whole-only', () => {
        expect(amountPreview('1.5', true)).toBe('1')
    })
})
