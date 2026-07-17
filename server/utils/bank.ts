import { eq, and, gte, lt, desc } from 'drizzle-orm'
import { db } from '#server/database'
import { bankHistory, bankState } from '#server/database/schema'
import { BANK_CAP, debtFloor, LOAN_MULTIPLIER, bankDailyRate, growBankBalance, loanAllowance } from '#shared/utils/gamelogic/bank'
import { BANK_MAX_AMOUNT } from '#shared/utils/limits'

type BankTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type BankRow = typeof bankState.$inferSelect

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

export async function getLockedBankState(tx: BankTx, userId: string) {
  await tx.insert(bankState).values({ userId }).onConflictDoNothing()
  const [state] = await tx.select().from(bankState).where(eq(bankState.userId, userId)).for('update')
  if (!state) throw createError({ statusCode: 500, statusMessage: 'Could not initialize bank account' })
  return state
}

export async function settleBankState(tx: BankTx, state: BankRow, now = new Date()) {
  const balance = parseFloat(state.balance)
  const loanPrincipal = parseFloat(state.loanPrincipal)
  let settledBalance = growBankBalance(balance, state.lastSettledAt, now)
  if (settledBalance < 0 && loanPrincipal > 0) settledBalance = Math.max(settledBalance, debtFloor(loanPrincipal))
  settledBalance = round(settledBalance)

  const [settled] = await tx.update(bankState)
    .set({ balance: settledBalance.toFixed(4), lastSettledAt: now })
    .where(eq(bankState.id, state.id))
    .returning()
  return settled!
}

export async function writeBankHistory(tx: BankTx, userId: string, balance: number, action: string, amount = 0) {
  await tx.insert(bankHistory).values({
    userId,
    balance: round(balance).toFixed(4),
    action,
    amount: round(amount).toFixed(4)
  })
}

export function bankSummary(state: BankRow) {
  const balance = parseFloat(state.balance)
  const totalDeposited = parseFloat(state.maxPrincipal)
  const loanPrincipal = parseFloat(state.loanPrincipal)
  return {
    balance,
    principal: parseFloat(state.principal),
    totalDeposited,
    dailyRate: balance > 0 ? bankDailyRate(balance) : 0,
    loanDailyRate: balance < 0 ? 0.07 : 0,
    loanLimit: totalDeposited * LOAN_MULTIPLIER,
    loanAvailable: loanAllowance(totalDeposited, loanPrincipal),
    loanPrincipal,
    debtLimit: loanPrincipal * LOAN_MULTIPLIER,
    bankCap: BANK_CAP,
    lastSettledAt: state.lastSettledAt
  }
}

export async function getBankHistory(userId: string, limit = 100, offset = 0) {
  return db.query.bankHistory.findMany({
    where: eq(bankHistory.userId, userId),
    orderBy: [desc(bankHistory.createdAt)],
    limit,
    offset,
    columns: { id: true, balance: true, action: true, amount: true, createdAt: true }
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
