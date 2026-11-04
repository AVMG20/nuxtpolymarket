/**
 * Rail Tycoon money rules: delivery payment, loans, month-end finance and bankruptcy
 * and infrastructure-sharing fees. Money is a safe integer in the smallest unit and
 * every result is an integer. The payment curve, cumulative interest and the bankruptcy line mimic
 * the original game's behaviour; sharing fees are this plan's own design.
 */
import { RT_CARGO_IDS, RT_CATALOG } from './catalog'
import type { RtCompany, RtFinance, RtInfrastructure, RtWorldSettings } from './types'

/** A fresh year of finance categories, every one zero. */
export function rtEmptyFinance(): RtFinance {
    return {
        construction: 0,
        newVehicles: 0,
        runningCosts: 0,
        property: 0,
        loanInterest: 0,
        trainIncome: 0,
        roadIncome: 0,
        sharingIncome: 0,
        sharingCosts: 0,
        other: 0,
        fines: 0
    }
}

/** Categories that count toward a month's income; every other category counts toward its expenses. */
const INCOME_CATEGORIES: ReadonlySet<keyof RtFinance> = new Set<keyof RtFinance>(['trainIncome', 'roadIncome', 'sharingIncome'])

/**
 * Books one money movement: `amount` is the signed change to the company's cash (income positive,
 * cost negative, a refund positive in its cost category). It lands in the current year's category and
 * in the current month's income or expense total, which monthlyFinance pushes at month end.
 */
export function bookMoney(company: RtCompany, category: keyof RtFinance, amount: number): void {
    if (amount === 0) return
    company.money += amount
    company.financeThisYear[category] += amount
    if (INCOME_CATEGORIES.has(category)) {
        company.monthIncome += amount
    } else {
        company.monthExpenses += amount
    }
}

// ---------------------------------------------------------------------------------------------
// Delivery payment
// ---------------------------------------------------------------------------------------------

/** Manhattan distance in tiles between two tile indices (y * side + x) on a map of `side` tiles. */
export function manhattan(tileA: number, tileB: number, side: number): number {
    const ax = tileA % side
    const ay = Math.floor(tileA / side)
    const bx = tileB % side
    const by = Math.floor(tileB / side)
    return Math.abs(ax - bx) + Math.abs(ay - by)
}

/** floor(a * b / 2^shift) for non-negative integers, exact even past 2^53. */
function mulShift(a: number, b: number, shift: number): number {
    const product = a * b
    if (product <= Number.MAX_SAFE_INTEGER) return Math.floor(product / 2 ** shift)
    return Number((BigInt(a) * BigInt(b)) >> BigInt(shift))
}

/**
 * Income for delivering `amount` units of cargo index `cargoId` over `distanceTiles` after
 * `transitPeriods` transit periods. The time factor holds at its start value up to the cargo's
 * fastDays, falls by slope1 per period after that and by slope2 more per period past fastDays +
 * slowDays, and once it would cross the floor it decays as floor / (x / 32 + 1) in 1/16 fixed point.
 * Payment is distance * timeFactor * amount * price >> scaleShift. Never negative; an unknown cargo pays 0.
 */
export function deliveryPayment(cargoId: number, amount: number, distanceTiles: number, transitPeriods: number): number {
    const id = RT_CARGO_IDS[cargoId]
    if (id === undefined) return 0
    const cargo = RT_CATALOG.cargos[id]
    const pay = RT_CATALOG.payment
    const units = Math.max(0, Math.floor(amount))
    const distance = Math.max(0, Math.floor(distanceTiles))
    if (units === 0 || distance === 0) return 0
    const periods = Math.min(pay.maxTransitPeriods, Math.max(0, Math.floor(transitPeriods)))

    const pastFast = Math.max(periods - cargo.fastDays, 0)
    const pastSlow = Math.max(pastFast - cargo.slowDays, 0)
    const linear = pay.timeFactorStart - pay.slope1 * pastFast - pay.slope2 * pastSlow
    const belowFloor = pay.timeFactorFloor - linear
    if (belowFloor > 0) {
        const frac = 1 << pay.timeFactorFracBits
        const factor = Math.max(Math.floor(2 * pay.timeFactorFloor * frac * frac / (belowFloor + 2 * frac)), 1)
        return mulShift(distance * factor * units, cargo.initialPrice, pay.scaleShift + pay.timeFactorFracBits)
    }
    const factor = Math.max(linear, pay.timeFactorFloor)
    return mulShift(distance * factor * units, cargo.initialPrice, pay.scaleShift)
}

// ---------------------------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------------------------

/** Why a loan change was refused. */
export const RtLoanError = {
    /** Steps was zero or not an integer. */
    badSteps: 0,
    /** Borrowing would pass RT_CATALOG.economy.maxLoan. */
    overMaxLoan: 1,
    /** Repaying more than the outstanding loan. */
    overLoan: 2,
    /** Repaying more than the cash on hand. */
    notEnoughCash: 3
} as const
export type RtLoanError = typeof RtLoanError[keyof typeof RtLoanError]

/** ok with the signed change to cash and loan, or a refusal code. */
export type RtLoanResult = { ok: true, amount: number } | { ok: false, error: RtLoanError }

/**
 * Borrows (positive steps) or repays (negative steps) in RT_CATALOG loan steps. Borrowing raises cash
 * and loan by the same amount; repaying lowers both. A loan change is financing, not income or
 * expense, so it books no finance category (as the original).
 */
export function changeLoan(company: RtCompany, steps: number): RtLoanResult {
    if (!Number.isInteger(steps) || steps === 0) return { ok: false, error: RtLoanError.badSteps }
    const economy = RT_CATALOG.economy
    const amount = steps * economy.loanStep
    if (amount > 0) {
        if (company.loan + amount > economy.maxLoan) return { ok: false, error: RtLoanError.overMaxLoan }
    } else {
        if (-amount > company.loan) return { ok: false, error: RtLoanError.overLoan }
        if (-amount > company.money) return { ok: false, error: RtLoanError.notEnoughCash }
    }
    company.loan += amount
    company.money += amount
    return { ok: true, amount }
}

// ---------------------------------------------------------------------------------------------
// Month-end finance
// ---------------------------------------------------------------------------------------------

/** Outcome of a month end: nothing to report, the company-in-trouble warning, or the reset. */
export type RtMonthlyOutcome = 'ok' | 'warning' | 'reset'

/** Monthly upkeep of a company's infrastructure from RT_CATALOG per-piece prices (money, positive). */
export function infrastructureUpkeep(infrastructure: RtInfrastructure): number {
    const upkeep = RT_CATALOG.economy.upkeep
    return infrastructure.railPieces * upkeep.railPiece
        + infrastructure.roadPieces * upkeep.roadPiece
        + infrastructure.signals * upkeep.signal
        + infrastructure.stationTiles * upkeep.stationTile
        + infrastructure.depots * upkeep.depot
}

/** Whether a company stands below the bankruptcy line: cash minus loan under minus the maximum loan. */
export function belowBankruptcyLine(company: RtCompany): boolean {
    return company.money - company.loan < -RT_CATALOG.economy.maxLoan
}

/**
 * This month's interest by the cumulative-share method: the yearly fee on the loan and on negative
 * cash, times (month + 1) / 12, minus the share through the previous month, so twelve months total
 * the yearly fee exactly.
 */
export function monthlyInterest(company: RtCompany, monthIndex: number): number {
    const percent = RT_CATALOG.economy.interestPercent
    let yearly = Math.floor(company.loan * percent / 100)
    if (company.money < 0) yearly += Math.floor(-company.money * percent / 100)
    const month = Math.min(11, Math.max(0, Math.floor(monthIndex)))
    return Math.floor(yearly * (month + 1) / 12) - Math.floor(yearly * month / 12)
}

/** Closes the month: pushes its income and expense totals onto monthlyIncome (last 12) and clears them. */
function closeMonth(company: RtCompany): void {
    company.monthlyIncome.push({ income: company.monthIncome, expenses: company.monthExpenses })
    while (company.monthlyIncome.length > 12) company.monthlyIncome.shift()
    company.monthIncome = 0
    company.monthExpenses = 0
}

/**
 * Month end for one company, `monthIndex` (0 = January) being the month that is closing. In the
 * original's order: running costs accrued this month are charged, the bankruptcy counter is checked
 * (counting up while cash minus loan stays under minus the maximum loan, back to zero once it does
 * not), then infrastructure upkeep, loan interest and the monthly other cost. The month's totals are
 * pushed onto monthlyIncome. Returns 'reset' once the counter reaches bankruptcyResetMonths (the
 * caller resets the company; no further charges are made that month), 'warning' on the month it
 * reaches bankruptcyWarnMonths, otherwise 'ok'.
 */
export function monthlyFinance(company: RtCompany, monthIndex: number, runningCostsAccrued: number, infrastructureCount: RtInfrastructure): RtMonthlyOutcome {
    const economy = RT_CATALOG.economy
    bookMoney(company, 'runningCosts', -Math.max(0, Math.floor(runningCostsAccrued)))

    let outcome: RtMonthlyOutcome = 'ok'
    if (belowBankruptcyLine(company)) {
        company.bankruptMonths++
        if (company.bankruptMonths >= economy.bankruptcyResetMonths) {
            closeMonth(company)
            return 'reset'
        }
        if (company.bankruptMonths === economy.bankruptcyWarnMonths) outcome = 'warning'
    } else {
        company.bankruptMonths = 0
    }

    bookMoney(company, 'property', -infrastructureUpkeep(infrastructureCount))
    bookMoney(company, 'loanInterest', -monthlyInterest(company, monthIndex))
    bookMoney(company, 'other', -economy.monthlyOtherCost)
    closeMonth(company)
    return outcome
}

// ---------------------------------------------------------------------------------------------
// Infrastructure sharing
// ---------------------------------------------------------------------------------------------

/** What a sharing fee pays for. */
export type RtSharingKind = 'rail' | 'station' | 'depot'

/** The part of the world the sharing rules read: its settings and its companies by id. */
export interface RtSharingWorld {
    readonly settings: Pick<RtWorldSettings, 'sharing'>
    readonly companies: readonly (RtCompany | null | undefined)[]
}

function companyById(world: RtSharingWorld, id: number): RtCompany | undefined {
    const direct = world.companies[id]
    if (direct && direct.id === id) return direct
    for (const company of world.companies) {
        if (company && company.id === id) return company
    }
    return undefined
}

/**
 * Moves a sharing fee of `amount` from the payer to the owner for using the owner's `kind` of
 * infrastructure. Nothing happens for the same company, a zero or negative amount, or an id that is
 * not a company (a town). The payer's cash may go negative and counts toward the bankruptcy line like
 * any cost. Books sharingCosts / sharingIncome for the year and both companies' month totals.
 * Returns whether money moved.
 */
export function chargeSharing(world: RtSharingWorld, payerId: number, ownerId: number, amount: number, kind: RtSharingKind): boolean {
    const fee = Math.floor(amount)
    if (payerId === ownerId || !(fee > 0)) return false
    if (kind !== 'rail' && kind !== 'station' && kind !== 'depot') return false
    const payer = companyById(world, payerId)
    const owner = companyById(world, ownerId)
    if (!payer || !owner) return false
    bookMoney(payer, 'sharingCosts', -fee)
    bookMoney(owner, 'sharingIncome', fee)
    return true
}

/** Fee per foreign track piece a train enters; 0 in a world without sharing. */
export function railSharingFee(world: RtSharingWorld): number {
    return world.settings.sharing ? RT_CATALOG.economy.sharing.railFeePerPiece : 0
}

/** The station owner's share of a delivery payment, rounded down. */
export function stationSharingShare(payment: number): number {
    if (!(payment > 0)) return 0
    return Math.floor(Math.floor(payment) * RT_CATALOG.economy.sharing.stationSharePercent / 100)
}

/** Fee for a service visit at another company's depot; 0 in a world without sharing. */
export function depotSharingFee(world: RtSharingWorld): number {
    return world.settings.sharing ? RT_CATALOG.economy.sharing.depotServiceFee : 0
}
