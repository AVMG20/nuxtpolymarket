import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { rtNewCompany } from '#shared/utils/rail-tycoon/world'
import {
    createRtWindows,
    rtCommandErrorText,
    rtFormatDate,
    rtFormatMoney,
    rtLoanActions,
    rtWindowKey,
    RT_WINDOW_ORIGIN,
    RT_WINDOW_STEP
} from '../../app/utils/rail-tycoon/windows'

describe('createRtWindows', () => {
    it('keys a window by kind, plus the entity id when it has one', () => {
        expect(rtWindowKey('finances')).toBe('finances')
        expect(rtWindowKey('vehicle', 7)).toBe('vehicle:7')
        expect(rtWindowKey('station', 0)).toBe('station:0')
    })

    it('focuses an open window instead of opening a second one', () => {
        const windows = createRtWindows()
        const first = windows.open('finances')
        windows.open('minimap')
        expect(windows.top()).toBe('minimap')
        const again = windows.open('finances')
        expect(again).toBe(first)
        expect(windows.list).toHaveLength(2)
        expect(windows.top()).toBe('finances')
    })

    it('opens one window per vehicle and per station', () => {
        const windows = createRtWindows()
        windows.open('vehicle', 1)
        windows.open('vehicle', 2)
        windows.open('vehicle', 1)
        windows.open('station', 1)
        expect(windows.list.map(entry => entry.key)).toEqual(['vehicle:1', 'vehicle:2', 'station:1'])
        expect(windows.isOpen('vehicle', 2)).toBe(true)
        expect(windows.isOpen('vehicle', 3)).toBe(false)
    })

    it('merges the props of a repeated open into the open window', () => {
        const windows = createRtWindows()
        windows.open('buyVehicle', 300, { depotKind: 0 })
        const entry = windows.open('buyVehicle', 300, { depotKind: 1 })
        expect(entry.props).toEqual({ depotKind: 1 })
    })

    it('cascades new windows and reuses the slot of a closed one', () => {
        const windows = createRtWindows({ origin: { x: 10, y: 20 }, step: 30, slots: 3 })
        const a = windows.open('finances')
        const b = windows.open('minimap')
        const c = windows.open('vehicleList')
        expect([a.x, a.y]).toEqual([10, 20])
        expect([b.x, b.y]).toEqual([40, 50])
        expect([c.x, c.y]).toEqual([70, 80])
        // every slot taken: the cascade starts over at the origin
        const d = windows.open('vehicle', 1)
        expect([d.x, d.y]).toEqual([10, 20])
        windows.close('minimap')
        windows.close('vehicle:1')
        const e = windows.open('station', 4)
        expect([e.x, e.y]).toEqual([40, 50])
    })

    it('uses the default cascade', () => {
        const windows = createRtWindows()
        windows.open('finances')
        const second = windows.open('minimap')
        expect([second.x, second.y]).toEqual([RT_WINDOW_ORIGIN.x + RT_WINDOW_STEP, RT_WINDOW_ORIGIN.y + RT_WINDOW_STEP])
    })

    it('raises a focused window above every other and leaves the front one alone', () => {
        const windows = createRtWindows()
        const a = windows.open('finances')
        const b = windows.open('minimap')
        expect(b.z).toBeGreaterThan(a.z)
        windows.focus('finances')
        expect(a.z).toBeGreaterThan(b.z)
        const z = a.z
        windows.focus('finances')
        expect(a.z).toBe(z)
        windows.focus('nothing')
        expect(windows.top()).toBe('finances')
    })

    it('closes one, some or all windows', () => {
        const windows = createRtWindows()
        windows.open('finances')
        windows.open('vehicle', 1)
        windows.open('vehicle', 2)
        windows.open('station', 3)
        windows.close('finances')
        windows.close('finances')
        expect(windows.list).toHaveLength(3)
        windows.closeWhere(entry => entry.kind === 'vehicle')
        expect(windows.list.map(entry => entry.key)).toEqual(['station:3'])
        windows.closeAll()
        expect(windows.list).toHaveLength(0)
        expect(windows.top()).toBeNull()
    })
})

describe('formatters', () => {
    it('formats money in pounds with the sign in front', () => {
        expect(rtFormatMoney(0)).toBe('£0')
        expect(rtFormatMoney(1234567)).toBe('£1,234,567')
        expect(rtFormatMoney(-25000)).toBe('-£25,000')
        expect(rtFormatMoney(-0.4)).toBe('£0')
        expect(rtFormatMoney(99.6)).toBe('£100')
    })

    it('formats the date as the original status bar', () => {
        expect(rtFormatDate({ day: 1, month: 0, year: 1950 })).toBe('1st Jan 1950')
        expect(rtFormatDate({ day: 2, month: 1, year: 1951 })).toBe('2nd Feb 1951')
        expect(rtFormatDate({ day: 3, month: 2, year: 1952 })).toBe('3rd Mar 1952')
        expect(rtFormatDate({ day: 11, month: 10, year: 1960 })).toBe('11th Nov 1960')
        expect(rtFormatDate({ day: 22, month: 11, year: 1960 })).toBe('22nd Dec 1960')
        expect(rtFormatDate({ day: 31, month: 6, year: 1960 })).toBe('31st Jul 1960')
    })

    it('names refused commands and falls back for unknown codes', () => {
        expect(rtCommandErrorText(10)).toBe('Not enough cash')
        expect(rtCommandErrorText(200)).toBe('That action was refused')
    })
})

describe('rtLoanActions', () => {
    const economy = RT_CATALOG.economy

    it('allows nothing without a company', () => {
        expect(rtLoanActions(null)).toEqual({ borrow: false, repay: false })
    })

    it('follows changeLoan without touching the company', () => {
        const company = rtNewCompany(0, 'Player', 0, 0)
        company.loan = economy.maxLoan - economy.loanStep
        company.money = economy.loanStep
        expect(rtLoanActions(company)).toEqual({ borrow: true, repay: true })
        expect(company.loan).toBe(economy.maxLoan - economy.loanStep)
        expect(company.money).toBe(economy.loanStep)

        company.loan = economy.maxLoan
        expect(rtLoanActions(company).borrow).toBe(false)

        company.money = economy.loanStep - 1
        expect(rtLoanActions(company).repay).toBe(false)

        company.money = economy.loanStep * 10
        company.loan = 0
        expect(rtLoanActions(company)).toEqual({ borrow: true, repay: false })
    })
})
