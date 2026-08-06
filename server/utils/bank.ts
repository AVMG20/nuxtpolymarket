import { eq, and, gte, inArray, lt, sql, desc } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { bankHistory, bankState, transactions, user } from '#server/database/schema'
import {
    BANK_CAP,
    LOAN_MULTIPLIER,
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
    loanAllowance
} from '#shared/utils/gamelogic/bank'
import { BANK_MAX_AMOUNT } from '#shared/utils/limits'

type BankRow = typeof bankState.$inferSelect

/**
 * Lock order, project-wide: the `user` row is always locked before `bank_state`.
 * Both bank endpoints and the debt garnish inside credit() touch the two rows in
 * one transaction, so a single direction is what keeps them from deadlocking.
 */

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

export function parseBankAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > BANK_MAX_AMOUNT) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid positive amount' })
  }
  return round(amount)
}

export async function getLockedBankState(tx: DbExecutor, userId: string) {
  await tx.insert(bankState).values({ userId }).onConflictDoNothing()
  const [state] = await tx.select().from(bankState).where(eq(bankState.userId, userId)).for('update')
  if (!state) throw createError({ statusCode: 500, statusMessage: 'Could not initialize bank account' })
  return state
}

/** The bail-out ledger as the shared math wants it. */
export function bailoutStateOf(state: Pick<BankRow, 'bailoutUntil' | 'bailoutDebt' | 'bailoutRepaid'>): BailoutState {
  return {
    until: state.bailoutUntil,
    debt: parseFloat(state.bailoutDebt),
    repaid: parseFloat(state.bailoutRepaid)
  }
}

export async function settleBankState(tx: DbExecutor, state: BankRow, now = new Date()) {
  const balance = parseFloat(state.balance)
  const loanPrincipal = parseFloat(state.loanPrincipal)
  let settledBalance = growBankBalance(balance, state.lastSettledAt, now, bailoutStateOf(state))
  if (settledBalance < 0 && loanPrincipal > 0) settledBalance = Math.max(settledBalance, debtFloor(loanPrincipal))
  settledBalance = round(settledBalance)

  const [settled] = await tx.update(bankState)
    .set({ balance: settledBalance.toFixed(4), lastSettledAt: now })
    .where(eq(bankState.id, state.id))
    .returning()
  return settled!
}

export async function writeBankHistory(tx: DbExecutor, userId: string, balance: number, action: string, amount = 0) {
  await tx.insert(bankHistory).values({
    userId,
    balance: round(balance).toFixed(4),
    action,
    amount: round(amount).toFixed(4)
  })
}

export function bankSummary(state: BankRow, now = new Date()) {
  const balance = parseFloat(state.balance)
  const totalDeposited = parseFloat(state.maxPrincipal)
  const loanPrincipal = parseFloat(state.loanPrincipal)
  const bailout = bailoutStateOf(state)
  const bailoutActive = isBailoutActive(bailout, now)
  return {
    balance,
    principal: parseFloat(state.principal),
    totalDeposited,
    dailyRate: balance > 0 && !bailoutActive ? bankDailyRate(balance) : 0,
    loanDailyRate: balance < 0 ? 0.07 : 0,
    loanLimit: totalDeposited * LOAN_MULTIPLIER,
    loanAvailable: loanAllowance(totalDeposited, loanPrincipal, bailout, now),
    loanPrincipal,
    debtLimit: -debtFloor(loanPrincipal),
    bankCap: BANK_CAP,
    lastSettledAt: state.lastSettledAt,
    garnishRate: garnishRate(balance, bailout, now),
    canBailOut: canBailOut(balance, loanPrincipal, bailout, now),
    bailoutThreshold: bailoutThreshold(loanPrincipal),
    bailoutActive,
    bailoutAt: state.bailoutAt,
    bailoutUntil: state.bailoutUntil,
    bailoutDebt: bailout.debt,
    bailoutRepaid: bailout.repaid,
    bailoutRemaining: bailoutRemaining(bailout)
  }
}

/**
 * The garnish writes a point per credit, which would drown the activity feed —
 * it is a chart input, not an action the player took.
 */
export const BANK_FEED_ACTIONS = ['deposit', 'withdraw', 'bailout', 'bailout-settled'] as const

export async function getBankHistory(userId: string, limit = 100, offset = 0) {
  return db.query.bankHistory.findMany({
    where: and(eq(bankHistory.userId, userId), inArray(bankHistory.action, [...BANK_FEED_ACTIONS])),
    orderBy: [desc(bankHistory.createdAt)],
    limit,
    offset,
    columns: { id: true, balance: true, action: true, amount: true, createdAt: true }
  })
}

/**
 * Diverts the bank's cut out of an incoming credit and returns what it took, so
 * credit() can debit exactly that much back off the wallet it just paid.
 *
 * Runs inside the caller's transaction, after the wallet row has been updated —
 * see the lock-order note at the top of this file. The unlocked probe is a fast
 * path for the overwhelmingly common no-debt case; when it is stale the worst
 * outcome is that one credit escapes the garnish, never a double charge, since
 * the amount that lands is recomputed under the row lock.
 */
export async function applyBankGarnish(tx: DbExecutor, userId: string, credited: number, now = new Date()) {
  if (!(credited > 0)) return 0

  const [probe] = await tx
    .select({ balance: bankState.balance, bailoutUntil: bankState.bailoutUntil, bailoutDebt: bankState.bailoutDebt, bailoutRepaid: bankState.bailoutRepaid })
    .from(bankState)
    .where(eq(bankState.userId, userId))
  if (!probe) return 0
  if (parseFloat(probe.balance) >= 0 && !isBailoutActive(bailoutStateOf(probe), now)) return 0

  const settled = await settleBankState(tx, await getLockedBankState(tx, userId), now)
  const balance = parseFloat(settled.balance)
  const bailout = bailoutStateOf(settled)
  const cut = round(garnishAmount(credited, balance, bailout, now))
  if (cut <= 0) return 0

  if (isBailoutActive(bailout, now)) {
    const repaid = round(bailout.repaid + cut)
    const cleared = repaid >= bailout.debt
    await tx.update(bankState)
      .set({ bailoutRepaid: repaid.toFixed(4), bailoutUntil: cleared ? null : settled.bailoutUntil })
      .where(eq(bankState.id, settled.id))
    await writeBankHistory(tx, userId, balance, cleared ? 'bailout-settled' : 'bailout-levy', cut)
    return cut
  }

  const newBalance = round(balance + cut)
  await tx.update(bankState)
    .set({ balance: newBalance.toFixed(4), loanPrincipal: newBalance >= 0 ? '0' : settled.loanPrincipal })
    .where(eq(bankState.id, settled.id))
  await writeBankHistory(tx, userId, newBalance, 'debt-repayment', cut)
  return cut
}

/**
 * Lifts the whole debt off the bank balance into the bail-out ledger: the
 * account is clean immediately, and the cost is the penalty term — no loans, no
 * interest, and 40% of everything earned goes to paying the lifted debt back.
 */
export async function performBailout(userId: string) {
  return db.transaction(async (tx) => {
    const now = new Date()
    const settled = await settleBankState(tx, await getLockedBankState(tx, userId), now)
    const balance = parseFloat(settled.balance)
    const loanPrincipal = parseFloat(settled.loanPrincipal)
    const bailout = bailoutStateOf(settled)
    if (isBailoutActive(bailout, now)) throw createError({ statusCode: 400, statusMessage: 'A bail-out is already running' })
    if (!canBailOut(balance, loanPrincipal, bailout, now)) {
      throw createError({ statusCode: 400, statusMessage: 'Your debt has not reached the bail-out threshold' })
    }

    const lifted = round(-balance)
    const [updated] = await tx.update(bankState).set({
      balance: '0.0000',
      principal: '0.0000',
      loanPrincipal: '0.0000',
      lastSettledAt: now,
      bailoutAt: now,
      bailoutUntil: bailoutUntilFrom(now),
      bailoutDebt: lifted.toFixed(4),
      bailoutRepaid: '0.0000'
    }).where(eq(bankState.id, settled.id)).returning()
    await writeBankHistory(tx, userId, 0, 'bailout', lifted)
    return bankSummary(updated!, now)
  })
}

/**
 * Pays whatever the levy has not covered yet straight out of the wallet, which
 * ends the penalty early. The wallet guard lives in the WHERE clause rather than
 * going through debit(), which would import this module right back.
 */
export async function repayBailout(userId: string) {
  return db.transaction(async (tx) => {
    const now = new Date()
    // User row first, then bank_state — the project-wide lock order.
    const [wallet] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId)).for('update')
    if (!wallet) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })

    const settled = await settleBankState(tx, await getLockedBankState(tx, userId), now)
    const bailout = bailoutStateOf(settled)
    if (!isBailoutActive(bailout, now)) throw createError({ statusCode: 400, statusMessage: 'No bail-out to repay' })

    const owed = round(bailoutRemaining(bailout))
    if (parseFloat(wallet.balance) < owed) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })

    const [debited] = await tx.update(user)
      .set({ balance: sql`${user.balance} - ${owed.toFixed(4)}::numeric` })
      .where(and(eq(user.id, userId), sql`${user.balance} >= ${owed.toFixed(4)}::numeric`))
      .returning({ balance: user.balance })
    if (!debited) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })
    await tx.insert(transactions).values({ userId, amount: owed.toFixed(4), type: 'debit', category: 'bank:bailout-repayment' })

    const [updated] = await tx.update(bankState)
      .set({ bailoutRepaid: round(bailout.repaid + owed).toFixed(4), bailoutUntil: null })
      .where(eq(bankState.id, settled.id))
      .returning()
    await writeBankHistory(tx, userId, parseFloat(settled.balance), 'bailout-settled', owed)
    return { paid: owed, summary: bankSummary(updated!, now) }
  })
}

const CHART_WINDOW_DAYS = 30
const CHART_POINT_BUDGET = 500
const CHART_WINDOW_ROW_CAP = 2000

const CHART_COLUMNS = { id: true, balance: true, action: true, amount: true, createdAt: true } as const

function downsample<T>(rows: T[], budget: number): T[] {
  if (rows.length <= budget) return rows
  const step = rows.length / budget
  const out: T[] = []
  for (let i = 0; i < budget; i++) out.push(rows[Math.floor(i * step)]!)
  const last = rows[rows.length - 1]!
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

export async function getBankChartHistory(userId: string) {
  const windowStart = new Date(Date.now() - CHART_WINDOW_DAYS * 86_400_000)

  const [earliest, anchorRows, windowRows] = await Promise.all([
    db.query.bankHistory.findFirst({
      where: eq(bankHistory.userId, userId),
      orderBy: [bankHistory.createdAt],
      columns: { createdAt: true }
    }),
    // Anchors the left edge: the balance the window opens at.
    db.query.bankHistory.findMany({
      where: and(eq(bankHistory.userId, userId), lt(bankHistory.createdAt, windowStart)),
      orderBy: [desc(bankHistory.createdAt)],
      limit: 1,
      columns: CHART_COLUMNS
    }),
    db.query.bankHistory.findMany({
      where: and(eq(bankHistory.userId, userId), gte(bankHistory.createdAt, windowStart)),
      orderBy: [desc(bankHistory.createdAt)],
      limit: CHART_WINDOW_ROW_CAP,
      columns: CHART_COLUMNS
    })
  ])

  const points = [...anchorRows, ...downsample(windowRows.reverse(), CHART_POINT_BUDGET)]
  return { points, earliestAt: earliest?.createdAt ?? null }
}
