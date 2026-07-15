import { describe, expect, it } from 'vitest'
import {
  BANK_CAP,
  BANK_MAX_DAILY_RATE,
  BANK_MIN_DAILY_RATE,
  LOAN_DAILY_RATE,
  bankDailyRate,
  debtFloor,
  growBankBalance,
  loanAllowance,
  nextMaxPrincipal,
  withdrawalAllowance
} from '../../shared/utils/gamelogic/bank'

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

  it('enforces both the 10x loan allowance and the 10x debt-growth stop', () => {
    expect(loanAllowance(5_000, 0)).toBe(50_000)
    expect(loanAllowance(5_000, 48_000)).toBe(2_000)
    expect(loanAllowance(5_000, 50_000)).toBe(0)
    expect(debtFloor(5_000)).toBe(-50_000)
  })

  it('lets withdrawals cross zero only by the unused loan allowance', () => {
    // 100 in savings can be withdrawn, plus a fresh 50k loan allowance.
    expect(withdrawalAllowance(100, 5_000, 0)).toBe(50_100)
    // An existing loan uses part of that room; a negative balance is not savings.
    expect(withdrawalAllowance(-250, 5_000, 1_000)).toBe(49_000)
  })
})
