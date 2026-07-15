export const BANK_CAP = 1_000_000_000
export const BANK_MIN_DAILY_RATE = 0.02
export const BANK_MAX_DAILY_RATE = 0.04
export const LOAN_DAILY_RATE = 0.07
export const LOAN_MULTIPLIER = 10

const CURVE_STEEPNESS = 4
const CURVE_NORMALIZER = 1 - Math.exp(-CURVE_STEEPNESS)

/** 2% at zero, rising exponentially to 4% at a 1B savings balance. */
export function bankDailyRate(balance: number) {
  const progress = Math.min(Math.max(balance, 0), BANK_CAP) / BANK_CAP
  const curve = (1 - Math.exp(-CURVE_STEEPNESS * progress)) / CURVE_NORMALIZER
  return BANK_MIN_DAILY_RATE + (BANK_MAX_DAILY_RATE - BANK_MIN_DAILY_RATE) * curve
}

export function growBankBalance(balance: number, lastSettledAt: Date, now = new Date()) {
  const elapsedDays = Math.max(0, now.getTime() - lastSettledAt.getTime()) / 86_400_000
  if (!elapsedDays || balance === 0) return balance
  if (balance > 0) return balance * (1 + bankDailyRate(balance)) ** elapsedDays
  return balance * (1 + LOAN_DAILY_RATE) ** elapsedDays
}

/** Loan eligibility is a high-water mark, never a cumulative transfer count. */
export function nextMaxPrincipal(previousMax: number, currentPrincipal: number) {
  return Math.max(previousMax, currentPrincipal)
}

export function loanAllowance(totalDeposited: number, activeLoanPrincipal: number) {
  return Math.max(0, totalDeposited * LOAN_MULTIPLIER - activeLoanPrincipal)
}

/** What can leave the bank right now: positive savings plus unused loan room. */
export function withdrawalAllowance(balance: number, totalDeposited: number, activeLoanPrincipal: number) {
  return Math.max(0, balance) + loanAllowance(totalDeposited, activeLoanPrincipal)
}

export function debtFloor(loanPrincipal: number) {
  return -loanPrincipal * LOAN_MULTIPLIER
}
