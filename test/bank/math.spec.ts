import { describe, expect, it } from 'vitest'
import {
  BAILOUT_GARNISH_RATE,
  BAILOUT_LOCKOUT_MS,
  BANK_CAP,
  BANK_MAX_DAILY_RATE,
  BANK_MIN_DAILY_RATE,
  DEBT_GARNISH_RATE,
  LOAN_DAILY_RATE,
  NO_BAILOUT,
  type BailoutState,
  bailoutRemaining,
  bailoutThreshold,
  bailoutUntilFrom,
  bankDailyRate,
  canBailOut,
  debtFloor,
  garnishAmount,
  garnishRate,
  growBankBalance,
  isBailoutActive,
  loanAllowance,
  nextMaxPrincipal,
  withdrawalAllowance
} from '../../shared/utils/gamelogic/bank'

const NOW = new Date('2026-06-01T00:00:00.000Z')
const activeBailout = (over: Partial<BailoutState> = {}): BailoutState => ({
  until: new Date(NOW.getTime() + BAILOUT_LOCKOUT_MS),
  debt: 100_000,
  repaid: 0,
  ...over
})

describe('bank savings interest', () => {
  it('scales exponentially from 2% to the 4% cap at 1B', () => {
    expect(bankDailyRate(0)).toBe(BANK_MIN_DAILY_RATE)
    expect(bankDailyRate(BANK_CAP)).toBeCloseTo(BANK_MAX_DAILY_RATE, 12)
    expect(bankDailyRate(BANK_CAP * 2)).toBeCloseTo(BANK_MAX_DAILY_RATE, 12)
    expect(bankDailyRate(BANK_CAP / 2)).toBeGreaterThan(bankDailyRate(BANK_CAP / 10))
  })

  it('settles a six-hour collection as one quarter of a daily compound period', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const sixHoursLater = new Date('2026-01-01T06:00:00.000Z')
    expect(growBankBalance(1_000, start, sixHoursLater)).toBeCloseTo(1_000 * (1 + bankDailyRate(1_000)) ** 0.25, 10)
  })

  it('compounds savings over a full day', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const tomorrow = new Date('2026-01-02T00:00:00.000Z')
    expect(growBankBalance(10_000, start, tomorrow)).toBeCloseTo(10_000 * (1 + bankDailyRate(10_000)), 10)
  })
})

describe('bank loans', () => {
  it('compounds debt at 7% per day', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const tomorrow = new Date('2026-01-02T00:00:00.000Z')
    expect(growBankBalance(-500, start, tomorrow)).toBeCloseTo(-500 * (1 + LOAN_DAILY_RATE), 10)
  })

  it('does not increase total deposited when a user cycles the same 5k', () => {
    const firstDeposit = nextMaxPrincipal(0, 5_000)
    const afterWithdrawal = nextMaxPrincipal(firstDeposit, 0)
    const afterFiveHundredRedeposits = Array.from({ length: 500 }).reduce(
      highWater => nextMaxPrincipal(highWater, 5_000),
      afterWithdrawal
    )
    expect(afterFiveHundredRedeposits).toBe(5_000)
  })

  it('enforces both the 5x loan allowance and the 5x debt-growth stop', () => {
    expect(loanAllowance(5_000, 0)).toBe(25_000)
    expect(loanAllowance(5_000, 23_000)).toBe(2_000)
    expect(loanAllowance(5_000, 25_000)).toBe(0)
    expect(debtFloor(5_000)).toBe(-25_000)
  })

  it('lets withdrawals cross zero only by the unused loan allowance', () => {
    // 100 in savings can be withdrawn, plus a fresh 25k loan allowance.
    expect(withdrawalAllowance(100, 5_000, 0)).toBe(25_100)
    // An existing loan uses part of that room; a negative balance is not savings.
    expect(withdrawalAllowance(-250, 5_000, 1_000)).toBe(24_000)
  })
})

describe('debt garnish', () => {
  it('takes 10% of an earning while a debt is open, and nothing when solvent', () => {
    expect(garnishRate(-1_000)).toBe(DEBT_GARNISH_RATE)
    expect(garnishAmount(500, -1_000)).toBe(50)
    expect(garnishRate(0)).toBe(0)
    expect(garnishRate(2_500)).toBe(0)
    expect(garnishAmount(500, 2_500)).toBe(0)
  })

  it('never takes more than what is still owed', () => {
    expect(garnishAmount(10_000, -300)).toBe(300)
  })

  it('ignores zero and negative credits', () => {
    expect(garnishAmount(0, -1_000)).toBe(0)
    expect(garnishAmount(-50, -1_000)).toBe(0)
  })
})

describe('bail-out eligibility', () => {
  it('unlocks once debt reaches 1.2x what was borrowed', () => {
    expect(bailoutThreshold(100_000_000)).toBe(120_000_000)
    expect(canBailOut(-119_999_999, 100_000_000)).toBe(false)
    expect(canBailOut(-120_000_000, 100_000_000)).toBe(true)
    expect(canBailOut(-500_000_000, 100_000_000)).toBe(true)
  })

  it('is unavailable without a loan, in credit, or during a running penalty', () => {
    expect(canBailOut(-500, 0)).toBe(false)
    expect(canBailOut(1_000, 100)).toBe(false)
    expect(canBailOut(-1_000, 100, activeBailout(), NOW)).toBe(false)
  })
})

describe('bail-out penalty', () => {
  it('runs for 30 days from acceptance', () => {
    const until = bailoutUntilFrom(NOW)
    expect(until.getTime() - NOW.getTime()).toBe(30 * 86_400_000)
    expect(isBailoutActive({ until, debt: 100, repaid: 0 }, NOW)).toBe(true)
    expect(isBailoutActive({ until, debt: 100, repaid: 0 }, new Date(until.getTime() + 1))).toBe(false)
  })

  it('ends the moment the lifted debt is fully levied back', () => {
    const bailout = activeBailout({ repaid: 100_000 })
    expect(bailoutRemaining(bailout)).toBe(0)
    expect(isBailoutActive(bailout, NOW)).toBe(false)
  })

  it('takes 40% of earnings and stops at the outstanding remainder', () => {
    expect(garnishRate(0, activeBailout(), NOW)).toBe(BAILOUT_GARNISH_RATE)
    expect(garnishAmount(1_000, 0, activeBailout(), NOW)).toBe(400)
    expect(garnishAmount(1_000, 0, activeBailout({ repaid: 99_950 }), NOW)).toBe(50)
  })

  it('blocks loans for the whole term and restores them after', () => {
    expect(loanAllowance(5_000, 0, activeBailout(), NOW)).toBe(0)
    expect(withdrawalAllowance(2_000, 5_000, 0, activeBailout(), NOW)).toBe(2_000)
    const afterTerm = new Date(NOW.getTime() + BAILOUT_LOCKOUT_MS + 1)
    expect(loanAllowance(5_000, 0, activeBailout(), afterTerm)).toBe(25_000)
  })

  it('pays no interest on savings during the term, then resumes', () => {
    const bailout = activeBailout()
    const halfway = new Date(NOW.getTime() + 15 * 86_400_000)
    expect(growBankBalance(10_000, NOW, halfway, bailout)).toBe(10_000)

    // Only the day that falls past the term compounds.
    const dayAfter = new Date(bailout.until!.getTime() + 86_400_000)
    expect(growBankBalance(10_000, NOW, dayAfter, bailout)).toBeCloseTo(10_000 * (1 + bankDailyRate(10_000)), 8)
    expect(growBankBalance(10_000, NOW, dayAfter, NO_BAILOUT)).toBeGreaterThan(growBankBalance(10_000, NOW, dayAfter, bailout))
  })
})
