import { describe, expect, it } from 'vitest'
import { humanizeKey, jsonToCells, valueCell } from '../app/utils/sheet-json'

describe('humanizeKey', () => {
    it('turns keys into labels', () => {
        expect(humanizeKey('totalDeposited')).toBe('Total deposited')
        expect(humanizeKey('stats.bestPayout')).toBe('Stats best payout')
        expect(humanizeKey('xpToNext')).toBe('Xp to next')
    })
})

describe('valueCell', () => {
    it('reads numeric strings, dates and timestamps', () => {
        expect(valueCell('1000000.0000')).toEqual({ v: 1000000, fmt: 'number' })
        expect(valueCell(12)).toEqual({ v: 12, fmt: 'int' })
        expect(valueCell(true)).toEqual({ v: true })
        expect(valueCell('2026-10-27T10:05:00.000Z').v).toMatch(/^10\/27\/2026 /)
        expect(valueCell(1793101850649, 'serverNow').v).toMatch(/\d+\/\d+\/\d{4} /)
        expect(valueCell(['a', 'b'])).toEqual({ v: 'a, b' })
    })
})

describe('jsonToCells', () => {
    it('lists fields, flattening nested records', () => {
        const { cells } = jsonToCells({ balance: '10.5000', levels: { hull: 2 } })
        expect(cells.A1?.v).toBe('Field')
        expect(cells.A2?.v).toBe('Balance')
        expect(cells.B2?.v).toBe(10.5)
        expect(cells.A3?.v).toBe('Levels hull')
        expect(cells.B3?.v).toBe(2)
    })

    it('renders lists of records and id maps as tables', () => {
        const { cells, nextRow } = jsonToCells({
            agents: [{ name: 'Vex', level: 3, gear: { tool: 'Drill' } }, { name: 'Ash', level: 1, gear: { tool: null } }],
            plots: { p1: { crop: 'kale' }, p2: { crop: 'leek' } }
        })
        expect(cells.A1?.v).toBe('Agents (2)')
        expect([cells.A2?.v, cells.B2?.v, cells.C2?.v]).toEqual(['Name', 'Level', 'Gear tool'])
        expect([cells.A3?.v, cells.B3?.v, cells.C3?.v]).toEqual(['Vex', 3, 'Drill'])
        expect(cells.C4).toBeUndefined()
        expect(cells.A6?.v).toBe('Plots (2)')
        expect([cells.A7?.v, cells.B7?.v]).toEqual(['Id', 'Crop'])
        expect([cells.A8?.v, cells.B8?.v]).toEqual(['p1', 'kale'])
        expect(nextRow).toBe(10)
    })

    it('honours the start row', () => {
        const { cells } = jsonToCells({ a: 1 }, 4)
        expect(cells.A5?.v).toBe('Field')
        expect(cells.B6?.v).toBe(1)
    })
})
