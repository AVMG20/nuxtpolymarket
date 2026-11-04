import { describe, expect, it } from 'vitest'
import { agePackets } from '#shared/utils/rail-tycoon/cargo'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import {
    bookMoney,
    changeLoan,
    chargeSharing,
    deliveryPayment,
    depotSharingFee,
    manhattan,
    monthlyFinance,
    monthlyInterest,
    railSharingFee,
    rtEmptyFinance,
    RtLoanError,
    stationSharingShare
} from '#shared/utils/rail-tycoon/economy'
import type { RtSharingWorld } from '#shared/utils/rail-tycoon/economy'
import type { RtCargoPacket, RtCompany, RtInfrastructure } from '#shared/utils/rail-tycoon/types'

const PASSENGERS = RT_CARGO_IDS.indexOf('passengers')
const MAIL = RT_CARGO_IDS.indexOf('mail')
const COAL = RT_CARGO_IDS.indexOf('coal')

/** distance * amount = 2^21, so a payment is exactly timeFactor * price (or that over 16 below the floor). */
const UNIT_DIST = 64
const UNIT_AMOUNT = 32768

const NO_INFRA: RtInfrastructure = { railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 }

function company(id: number, money: number, loan: number): RtCompany {
    return {
        id,
        name: `Co ${id}`,
        colour: id,
        money,
        loan,
        bankruptMonths: 0,
        foundedTick: 0,
        infrastructure: { ...NO_INFRA },
        financeThisYear: rtEmptyFinance(),
        financeLastYear: rtEmptyFinance(),
        monthIncome: 0,
        monthExpenses: 0,
        monthlyIncome: []
    }
}

function packet(transitPeriods: number): RtCargoPacket {
    return { cargo: PASSENGERS, count: 10, sourceTile: 0, sourceStation: -1, transitPeriods, feederShare: 0 }
}

describe('rail tycoon economy', () => {
    describe('agePackets', () => {
        it('ages every packet by one period per call', () => {
            const load = [packet(0), packet(5)]
            agePackets(load)
            expect(load.map(p => p.transitPeriods)).toEqual([1, 6])
            agePackets(load, 1)
            expect(load.map(p => p.transitPeriods)).toEqual([2, 7])
        })

        it('saturates at the catalog maximum', () => {
            const max = RT_CATALOG.payment.maxTransitPeriods
            const load = [packet(max - 1), packet(max)]
            agePackets(load)
            agePackets(load)
            expect(load.map(p => p.transitPeriods)).toEqual([65535, 65535])
        })
    })

    describe('deliveryPayment', () => {
        it('pays a bus load of 30 passengers over 20 tiles', () => {
            // 20 * 255 * 30 * 3185 >> 21 = 487305000 / 2097152 = 232.36
            expect(deliveryPayment(PASSENGERS, 30, 20, 0)).toBe(232)
        })

        it('doubling distance doubles payment', () => {
            expect(deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 0)).toBe(255 * 3185)
            expect(deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST * 2, 0)).toBe(2 * 255 * 3185)
            expect(deliveryPayment(PASSENGERS, 30, 40, 0)).toBe(2 * deliveryPayment(PASSENGERS, 30, 20, 0))
        })

        it('a slow delivery pays less than a fast one', () => {
            // passengers at 30 periods: 255 - 30 - (30 - 24) = 219
            expect(deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 30)).toBe(219 * 3185)
            expect(deliveryPayment(PASSENGERS, 30, 20, 30)).toBe(199)
            expect(deliveryPayment(PASSENGERS, 30, 20, 30)).toBeLessThan(deliveryPayment(PASSENGERS, 30, 20, 0))
        })

        it('holds flat up to fastDays', () => {
            expect(deliveryPayment(COAL, UNIT_AMOUNT, UNIT_DIST, 7)).toBe(255 * 5916)
            expect(deliveryPayment(COAL, UNIT_AMOUNT, UNIT_DIST, 8)).toBe(254 * 5916)
            expect(deliveryPayment(MAIL, UNIT_AMOUNT, UNIT_DIST, 20)).toBe(255 * 4550)
            expect(deliveryPayment(MAIL, UNIT_AMOUNT, UNIT_DIST, 21)).toBe(254 * 4550)
        })

        it('bulk cargo decays slower than passengers', () => {
            const coalFresh = deliveryPayment(COAL, UNIT_AMOUNT, UNIT_DIST, 0)
            const coalSlow = deliveryPayment(COAL, UNIT_AMOUNT, UNIT_DIST, 30)
            const paxFresh = deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 0)
            const paxSlow = deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 30)
            // coal at 30 periods: 255 - (30 - 7) = 232
            expect(coalSlow).toBe(232 * 5916)
            // coalSlow / coalFresh > paxSlow / paxFresh, cross-multiplied
            expect(BigInt(coalSlow) * BigInt(paxFresh)).toBeGreaterThan(BigInt(paxSlow) * BigInt(coalFresh))
        })

        it('falls past the floor as a 1/16 fixed-point reciprocal', () => {
            // passengers reach the floor of 31 at 124 periods
            expect(deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 124)).toBe(31 * 3185)
            // 125: 2 below the floor, 15872 / 34 = 466, 466 * 3185 / 16 = 92763.125
            expect(deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 125)).toBe(92763)
            // 200: 152 below the floor, 15872 / 184 = 86, 86 * 3185 / 16 = 17119.375
            expect(deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 200)).toBe(17119)
            // saturated transit: the factor bottoms out at 1/16
            expect(deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 65535)).toBe(199)
            expect(deliveryPayment(PASSENGERS, UNIT_AMOUNT, UNIT_DIST, 1000000)).toBe(199)
        })

        it('is monotonic non-increasing in transit for every cargo', () => {
            for (let cargo = 0; cargo < RT_CARGO_IDS.length; cargo++) {
                let previous = deliveryPayment(cargo, 50, 37, 0)
                for (let t = 1; t <= 2000; t++) {
                    const pay = deliveryPayment(cargo, 50, 37, t)
                    expect(pay).toBeLessThanOrEqual(previous)
                    expect(pay).toBeGreaterThanOrEqual(0)
                    previous = pay
                }
            }
        })

        it('is exact past 2^53 and never negative', () => {
            const expected = Number((510n * 255n * 100000000n * 6144n) >> 21n)
            expect(deliveryPayment(RT_CARGO_IDS.indexOf('goods'), 100000000, 510, 0)).toBe(expected)
            expect(expected).toBe(38100585937)
            expect(deliveryPayment(PASSENGERS, -5, 20, 0)).toBe(0)
            expect(deliveryPayment(PASSENGERS, 30, 0, 0)).toBe(0)
            expect(deliveryPayment(PASSENGERS, 30, -3, 0)).toBe(0)
            expect(deliveryPayment(PASSENGERS, 30, 20, -10)).toBe(232)
            expect(deliveryPayment(99, 30, 20, 0)).toBe(0)
        })

        it('measures Manhattan distance between tile indices', () => {
            expect(manhattan(4 * 64 + 3, 1 * 64 + 10, 64)).toBe(10)
            expect(manhattan(0, 255 * 256 + 255, 256)).toBe(510)
            expect(manhattan(77, 77, 128)).toBe(0)
        })
    })

    describe('changeLoan', () => {
        it('borrowing raises money and loan equally', () => {
            const c = company(0, 100000, 100000)
            expect(changeLoan(c, 3)).toEqual({ ok: true, amount: 30000 })
            expect(c.money).toBe(130000)
            expect(c.loan).toBe(130000)
        })

        it('refuses borrowing past the maximum', () => {
            const c = company(0, 100000, 100000)
            expect(changeLoan(c, 20)).toEqual({ ok: true, amount: 200000 })
            expect(c.loan).toBe(300000)
            expect(changeLoan(c, 1)).toEqual({ ok: false, error: RtLoanError.overMaxLoan })
            expect(c.money).toBe(300000)
            expect(c.loan).toBe(300000)
            const d = company(1, 0, 0)
            expect(changeLoan(d, 31)).toEqual({ ok: false, error: RtLoanError.overMaxLoan })
            expect(d.loan).toBe(0)
        })

        it('refuses repaying with too little cash', () => {
            const c = company(0, 5000, 100000)
            expect(changeLoan(c, -1)).toEqual({ ok: false, error: RtLoanError.notEnoughCash })
            expect(c.money).toBe(5000)
            expect(c.loan).toBe(100000)
        })

        it('refuses repaying more than the loan', () => {
            const c = company(0, 50000, 10000)
            expect(changeLoan(c, -2)).toEqual({ ok: false, error: RtLoanError.overLoan })
            expect(c.loan).toBe(10000)
        })

        it('repays in steps, lowering money and loan equally', () => {
            const c = company(0, 100000, 100000)
            expect(changeLoan(c, -10)).toEqual({ ok: true, amount: -100000 })
            expect(c.money).toBe(0)
            expect(c.loan).toBe(0)
        })

        it('refuses zero or fractional steps', () => {
            const c = company(0, 100000, 100000)
            expect(changeLoan(c, 0)).toEqual({ ok: false, error: RtLoanError.badSteps })
            expect(changeLoan(c, 1.5)).toEqual({ ok: false, error: RtLoanError.badSteps })
            expect(c.loan).toBe(100000)
        })
    })

    describe('monthlyFinance', () => {
        it('twelve monthly interest charges equal the yearly rate exactly', () => {
            const c = company(0, 1000000, 10000)
            const charges: number[] = []
            for (let month = 0; month < 12; month++) {
                const before = c.financeThisYear.loanInterest
                monthlyFinance(c, month, 0, NO_INFRA)
                charges.push(before - c.financeThisYear.loanInterest)
            }
            expect(charges).toEqual([16, 17, 17, 16, 17, 17, 16, 17, 17, 16, 17, 17])
            expect(c.financeThisYear.loanInterest).toBe(-200)

            const big = company(1, 1000000, 100000)
            for (let month = 0; month < 12; month++) monthlyFinance(big, month, 0, NO_INFRA)
            expect(big.financeThisYear.loanInterest).toBe(-2000)
        })

        it('charges interest on negative cash too', () => {
            // yearly 2% of 100000 loan plus 2% of 60000 overdraft = 3200
            const c = company(0, -60000, 100000)
            expect(monthlyInterest(c, 0)).toBe(266)
            expect(monthlyInterest(c, 11)).toBe(267)
        })

        it('charges running costs, upkeep, interest and the other cost, and closes the month', () => {
            const c = company(0, 500000, 100000)
            const infra: RtInfrastructure = { railPieces: 10, roadPieces: 5, signals: 2, stationTiles: 3, depots: 1 }
            expect(monthlyFinance(c, 0, 1234, infra)).toBe('ok')
            expect(c.financeThisYear.runningCosts).toBe(-1234)
            expect(c.financeThisYear.property).toBe(-24)
            expect(c.financeThisYear.loanInterest).toBe(-166)
            expect(c.financeThisYear.other).toBe(-25)
            expect(c.money).toBe(500000 - 1449)
            expect(c.monthlyIncome).toEqual([{ income: 0, expenses: -1449 }])
            expect(c.monthIncome).toBe(0)
            expect(c.monthExpenses).toBe(0)
        })

        it('keeps the last 12 months, newest last', () => {
            const c = company(0, 1000000, 0)
            for (let month = 0; month < 14; month++) {
                bookMoney(c, 'trainIncome', month + 1)
                monthlyFinance(c, month % 12, 0, NO_INFRA)
            }
            expect(c.monthlyIncome.length).toBe(12)
            expect(c.monthlyIncome[0]).toEqual({ income: 3, expenses: -25 })
            expect(c.monthlyIncome[11]).toEqual({ income: 14, expenses: -25 })
        })

        it('a company kept below the line for the catalog months returns reset', () => {
            // money - loan = -300001, under -maxLoan
            const c = company(0, -1, 300000)
            const outcomes: string[] = []
            for (let month = 0; month < 10; month++) outcomes.push(monthlyFinance(c, month % 12, 0, NO_INFRA))
            expect(outcomes).toEqual(['ok', 'ok', 'ok', 'warning', 'ok', 'ok', 'ok', 'ok', 'ok', 'reset'])
            expect(c.bankruptMonths).toBe(RT_CATALOG.economy.bankruptcyResetMonths)
            expect(c.monthlyIncome.length).toBe(10)
        })

        it('recovering resets the counter', () => {
            const c = company(0, -1, 300000)
            for (let month = 0; month < 5; month++) monthlyFinance(c, month, 0, NO_INFRA)
            expect(c.bankruptMonths).toBe(5)
            c.money = 1000000
            expect(monthlyFinance(c, 5, 0, NO_INFRA)).toBe('ok')
            expect(c.bankruptMonths).toBe(0)
        })

        it('standing exactly on the line is not bankrupt', () => {
            const c = company(0, 0, 300000)
            monthlyFinance(c, 0, 0, NO_INFRA)
            expect(c.bankruptMonths).toBe(0)
        })
    })

    describe('chargeSharing', () => {
        function world(sharing = true): RtSharingWorld & { companies: RtCompany[] } {
            return { settings: { sharing }, companies: [company(0, 10000, 0), company(1, 10000, 0)] }
        }

        it('same-company use costs nothing', () => {
            const w = world()
            expect(chargeSharing(w, 0, 0, 100, 'rail')).toBe(false)
            expect(w.companies[0]!.money).toBe(10000)
            expect(w.companies[0]!.financeThisYear).toEqual(rtEmptyFinance())
            expect(w.companies[0]!.monthExpenses).toBe(0)
        })

        it('a zero amount does nothing', () => {
            const w = world()
            expect(chargeSharing(w, 0, 1, 0, 'depot')).toBe(false)
            expect(w.companies[0]!.money).toBe(10000)
            expect(w.companies[1]!.money).toBe(10000)
        })

        it('a foreign rail charge moves the fee and books both categories', () => {
            const w = world()
            const fee = railSharingFee(w)
            expect(fee).toBe(1)
            expect(chargeSharing(w, 0, 1, fee, 'rail')).toBe(true)
            const [payer, owner] = w.companies as [RtCompany, RtCompany]
            expect(payer.money).toBe(9999)
            expect(owner.money).toBe(10001)
            expect(payer.financeThisYear.sharingCosts).toBe(-1)
            expect(owner.financeThisYear.sharingIncome).toBe(1)
            expect(payer.monthExpenses).toBe(-1)
            expect(owner.monthIncome).toBe(1)
            expect(payer.monthlyIncome).toEqual([])
            expect(owner.monthlyIncome).toEqual([])
        })

        it('may push the payer negative', () => {
            const w = world()
            expect(chargeSharing(w, 0, 1, 12500, 'station')).toBe(true)
            expect(w.companies[0]!.money).toBe(-2500)
            expect(w.companies[1]!.money).toBe(22500)
        })

        it('stationSharingShare rounds down', () => {
            expect(stationSharingShare(1000)).toBe(250)
            expect(stationSharingShare(999)).toBe(249)
            expect(stationSharingShare(3)).toBe(0)
            expect(stationSharingShare(-40)).toBe(0)
        })

        it('reads the depot fee from the catalog and charges nothing without sharing', () => {
            expect(depotSharingFee(world())).toBe(14)
            expect(railSharingFee(world(false))).toBe(0)
            expect(depotSharingFee(world(false))).toBe(0)
        })
    })

    it('books mid-month income, cost and sharing fee into monthlyIncome once, in their month', () => {
        const w: RtSharingWorld & { companies: RtCompany[] } = {
            settings: { sharing: true },
            companies: [company(0, 1000000, 0), company(1, 1000000, 0)]
        }
        const [a, b] = w.companies as [RtCompany, RtCompany]
        bookMoney(a, 'trainIncome', 700)
        bookMoney(a, 'construction', -300)
        chargeSharing(w, 0, 1, 50, 'station')
        expect(a.monthlyIncome).toEqual([])
        expect(b.monthlyIncome).toEqual([])

        monthlyFinance(a, 0, 0, NO_INFRA)
        monthlyFinance(b, 0, 0, NO_INFRA)
        monthlyFinance(a, 1, 0, NO_INFRA)
        monthlyFinance(b, 1, 0, NO_INFRA)

        expect(a.monthlyIncome).toEqual([{ income: 700, expenses: -375 }, { income: 0, expenses: -25 }])
        expect(b.monthlyIncome).toEqual([{ income: 50, expenses: -25 }, { income: 0, expenses: -25 }])
        expect(a.money).toBe(1000000 + 700 - 300 - 50 - 25 - 25)
        expect(b.money).toBe(1000000 + 50 - 25 - 25)
    })
})
