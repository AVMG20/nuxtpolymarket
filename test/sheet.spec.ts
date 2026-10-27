import { describe, expect, it } from 'vitest'
import { cellKey, colName, evaluateFormula, formatCellNumber, parseKey, scratchCell } from '../app/utils/sheet'

const values: Record<string, number> = { A1: 2, A2: 3, A3: 5, B1: 10 }
const lookup = (key: string) => values[key] ?? null

describe('sheet cell keys', () => {
    it('names columns like a spreadsheet', () => {
        expect(colName(0)).toBe('A')
        expect(colName(25)).toBe('Z')
        expect(colName(26)).toBe('AA')
        expect(cellKey(9, 1)).toBe('B10')
    })

    it('round-trips keys', () => {
        expect(parseKey('AA12')).toEqual({ r: 11, c: 26 })
        expect(parseKey('nope')).toBeNull()
    })
})

describe('evaluateFormula', () => {
    it('does arithmetic with precedence and refs', () => {
        expect(evaluateFormula('=1+2*3', lookup)).toBe(7)
        expect(evaluateFormula('=(A1+A2)*B1', lookup)).toBe(50)
        expect(evaluateFormula('=-A1^2', lookup)).toBe(4)
        expect(evaluateFormula('=C9', lookup)).toBe(0)
    })

    it('runs range functions', () => {
        expect(evaluateFormula('=SUM(A1:A3)', lookup)).toBe(10)
        expect(evaluateFormula('=average(A1:A3, B1)', lookup)).toBe(5)
        expect(evaluateFormula('=MAX(A1:B3)', lookup)).toBe(10)
        expect(evaluateFormula('=COUNT(A1:A9)', lookup)).toBe(3)
        expect(evaluateFormula('=ROUND(10/3, 2)', lookup)).toBe(3.33)
    })

    it('returns sheet errors', () => {
        expect(evaluateFormula('=1/0', lookup)).toBe('#DIV/0!')
        expect(evaluateFormula('=VLOOKUP(1)', lookup)).toBe('#NAME?')
        expect(evaluateFormula('=1+', lookup)).toBe('#ERROR!')
        expect(evaluateFormula('=A1:A3+1', lookup)).toBe('#VALUE!')
    })
})

describe('scratchCell', () => {
    it('stores numbers, text and formulas', () => {
        expect(scratchCell('42', lookup)).toEqual({ v: 42 })
        expect(scratchCell('hello', lookup)).toEqual({ v: 'hello' })
        expect(scratchCell('=A1*2', lookup)).toEqual({ v: 4, f: '=A1*2' })
    })
})

describe('formatCellNumber', () => {
    it('formats like Sheets number formats', () => {
        expect(formatCellNumber(1234.5, 'number')).toBe('1,234.50')
        expect(formatCellNumber(0.49, 'percent')).toBe('49.00%')
        expect(formatCellNumber(2, 'multiple')).toBe('2.00x')
        expect(formatCellNumber(0.1 + 0.2)).toBe('0.3')
    })
})
