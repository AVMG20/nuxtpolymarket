import { describe, expect, it } from 'vitest'
import { evaluateFormula, parseKey } from '../app/utils/sheet'

const values: Record<string, number> = { A1: 2, A2: 3, A3: 5, B1: 10 }
const lookup = (key: string) => values[key] ?? null

describe('sheet cell keys', () => {
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

