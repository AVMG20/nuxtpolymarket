export const BANK_CAP = 1_000_000_000
export const BANK_MIN_DAILY_RATE = 0.02
export const BANK_MAX_DAILY_RATE = 0.04
export const LOAN_DAILY_RATE = 0.07
/** Borrowing power: this many times the all-time deposit high-water mark. */
export const LOAN_MULTIPLIER = 5
/** Debt stops compounding once it reaches this many times the borrowed principal. */
export const DEBT_CEILING_MULTIPLIER = 5

/** Share of every incoming credit diverted to the bank while a debt is open. */
export const DEBT_GARNISH_RATE = 0.1
/** Share of every incoming credit diverted while a bail-out penalty is running. */
export const BAILOUT_GARNISH_RATE = 0.4
/** How long the no-loans, no-interest, 40%-levy penalty lasts after a bail-out. */
export const BAILOUT_LOCKOUT_DAYS = 30
export const BAILOUT_LOCKOUT_MS = BAILOUT_LOCKOUT_DAYS * 86_400_000
/** A bail-out unlocks once debt has compounded to this many times what was borrowed. */
export const BAILOUT_DEBT_MULTIPLIER = 1.2

/** Sub-cent noise from numeric(19,4) rounding must not keep a penalty alive. */
const SETTLED_EPSILON = 0.0001

const CURVE_STEEPNESS = 4
const CURVE_NORMALIZER = 1 - Math.exp(-CURVE_STEEPNESS)

/**
 * The bail-out ledger, lifted off the bank balance when the bail-out is taken.
 * `debt` is what was owed at that moment, `repaid` is what the levy has clawed
 * back since, and `until` is when the penalty lapses — whichever of the two
 * comes first ends it.
 */
export type BailoutState = { until: Date | null, debt: number, repaid: number }
export const NO_BAILOUT: BailoutState = { until: null, debt: 0, repaid: 0 }

/** 2% at zero, rising exponentially to 4% at a 1B savings balance. */
export function bankDailyRate(balance: number) {
  const progress = Math.min(Math.max(balance, 0), BANK_CAP) / BANK_CAP
  const curve = (1 - Math.exp(-CURVE_STEEPNESS * progress)) / CURVE_NORMALIZER
  return BANK_MIN_DAILY_RATE + (BANK_MAX_DAILY_RATE - BANK_MIN_DAILY_RATE) * curve
}

function ms(now: Date | number) {
  return now instanceof Date ? now.getTime() : now
}

export function bailoutRemaining(bailout: BailoutState) {
  return Math.max(0, bailout.debt - bailout.repaid)
}

/** Running while the term has not lapsed and the lifted debt is not settled. */
export function isBailoutActive(bailout: BailoutState, now: Date | number = new Date()) {
  if (!bailout.until) return false
  return bailout.until.getTime() > ms(now) && bailoutRemaining(bailout) > SETTLED_EPSILON
}

export function bailoutUntilFrom(bailedOutAt: Date) {
  return new Date(bailedOutAt.getTime() + BAILOUT_LOCKOUT_MS)
}

/**
 * Savings earn nothing while a bail-out penalty runs, so the compounding window
 * is clipped to the part of it after `until`. Debt is never frozen this way — a
 * bailed-out account has none, because the bail-out lifted it and loans stay
 * blocked for the whole term.
 */
export function growBankBalance(balance: number, lastSettledAt: Date, now = new Date(), bailout: BailoutState = NO_BAILOUT) {
  const from = balance > 0 && bailout.until
    ? Math.min(now.getTime(), Math.max(lastSettledAt.getTime(), bailout.until.getTime()))
    : lastSettledAt.getTime()
  const elapsedDays = Math.max(0, now.getTime() - from) / 86_400_000
  if (!elapsedDays || balance === 0) return balance
  if (balance > 0) return balance * (1 + bankDailyRate(balance)) ** elapsedDays
  return balance * (1 + LOAN_DAILY_RATE) ** elapsedDays
}

/** Loan eligibility is a high-water mark, never a cumulative transfer count. */
export function nextMaxPrincipal(previousMax: number, currentPrincipal: number) {
  return Math.max(previousMax, currentPrincipal)
}

export function loanAllowance(totalDeposited: number, activeLoanPrincipal: number, bailout: BailoutState = NO_BAILOUT, now: Date | number = new Date()) {
  if (isBailoutActive(bailout, now)) return 0
  return Math.max(0, totalDeposited * LOAN_MULTIPLIER - activeLoanPrincipal)
}

/** What can leave the bank right now: positive savings plus unused loan room. */
export function withdrawalAllowance(balance: number, totalDeposited: number, activeLoanPrincipal: number, bailout: BailoutState = NO_BAILOUT, now: Date | number = new Date()) {
  return Math.max(0, balance) + loanAllowance(totalDeposited, activeLoanPrincipal, bailout, now)
}

export function debtFloor(loanPrincipal: number) {
  return -loanPrincipal * DEBT_CEILING_MULTIPLIER
}

/** The debt level at which the bail-out card unlocks. */
export function bailoutThreshold(loanPrincipal: number) {
  return loanPrincipal * BAILOUT_DEBT_MULTIPLIER
}

export function canBailOut(balance: number, loanPrincipal: number, bailout: BailoutState = NO_BAILOUT, now: Date | number = new Date()) {
  if (isBailoutActive(bailout, now)) return false
  if (loanPrincipal <= 0 || balance >= 0) return false
  return -balance >= bailoutThreshold(loanPrincipal)
}

/**
 * The bank's cut of an incoming credit: 40% during a bail-out penalty, 10%
 * while an ordinary debt is open, nothing otherwise.
 */
export function garnishRate(balance: number, bailout: BailoutState = NO_BAILOUT, now: Date | number = new Date()) {
  if (isBailoutActive(bailout, now)) return BAILOUT_GARNISH_RATE
  return balance < 0 ? DEBT_GARNISH_RATE : 0
}

/** Never takes more than what is still owed, on either track. */
export function garnishAmount(credited: number, balance: number, bailout: BailoutState = NO_BAILOUT, now: Date | number = new Date()) {
  const rate = garnishRate(balance, bailout, now)
  if (rate <= 0 || credited <= 0) return 0
  const owed = isBailoutActive(bailout, now) ? bailoutRemaining(bailout) : -balance
  return Math.min(credited * rate, owed)
}
