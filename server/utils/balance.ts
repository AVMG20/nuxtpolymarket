import { eq, and, gte, sql, desc } from 'drizzle-orm'
import { db } from '../database'
import { user, transactions } from '../database/schema'
import { RAKEBACK_RATE } from '../../shared/utils/profile'

// Anything that can run a statement: the pool, or an open transaction. Callers
// that already hold a row lock MUST pass their `tx` — issuing the write on a
// second pool connection would deadlock against the lock they're holding.
export type BalanceExecutor = Pick<typeof db, 'update' | 'insert' | 'select'>

// Postgres numeric accepts 'NaN', which would silently poison a balance forever.
function assertAmount(amount: string) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid amount' })
  }
}

async function applyCredit(ex: BalanceExecutor, userId: string, amount: string, category?: string) {
  await ex.insert(transactions).values({ userId, amount, type: 'credit', category })
  await ex.update(user)
    .set({ balance: sql`${user.balance} + ${amount}::numeric` })
    .where(eq(user.id, userId))
}

// The `balance >= amount` guard lives in the WHERE clause so the check and the
// decrement are one statement — two concurrent debits can never both pass and
// push the balance negative (the read-then-write pattern this replaces could).
async function applyDebit(ex: BalanceExecutor, userId: string, amount: string, category?: string) {
  const [updated] = await ex.update(user)
    .set({ balance: sql`${user.balance} - ${amount}::numeric` })
    .where(and(eq(user.id, userId), sql`${user.balance} >= ${amount}::numeric`))
    .returning({ balance: user.balance })
  if (!updated) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })

  await ex.insert(transactions).values({ userId, amount, type: 'debit', category })
  return updated.balance
}

export async function credit(userId: string, amount: string, category?: string, tx?: BalanceExecutor) {
  assertAmount(amount)
  if (tx) return applyCredit(tx, userId, amount, category)
  await db.transaction(t => applyCredit(t, userId, amount, category))
}

export async function debit(userId: string, amount: string, category?: string, tx?: BalanceExecutor) {
  assertAmount(amount)
  if (tx) return applyDebit(tx, userId, amount, category)
  return db.transaction(t => applyDebit(t, userId, amount, category))
}

// Atomically spend gems. The `gte` guard lives in the WHERE clause so the check and
// the decrement are a single statement — two concurrent spends can never both pass and
// push the balance negative (the read-then-write pattern this replaces could). Throws a
// 400 when the user can't afford `cost` and returns the remaining gem balance otherwise.
export async function debitGems(userId: string, cost: number, tx: Pick<typeof db, 'update'> = db) {
  if (!Number.isInteger(cost) || cost < 0) throw createError({ statusCode: 400, statusMessage: 'Invalid gem amount' })

  const [updated] = await tx.update(user)
    .set({ gems: sql`${user.gems} - ${cost}` })
    .where(and(eq(user.id, userId), gte(user.gems, cost)))
    .returning({ gems: user.gems })
  if (!updated) throw createError({ statusCode: 400, statusMessage: 'Not enough gems' })
  return updated.gems
}

export async function creditGems(userId: string, count: number, tx: Pick<typeof db, 'update'> = db) {
  if (!Number.isInteger(count) || count < 0) throw createError({ statusCode: 400, statusMessage: 'Invalid gem amount' })
  if (count === 0) return

  await tx.update(user)
    .set({ gems: sql`${user.gems} + ${count}` })
    .where(eq(user.id, userId))
}

export async function accumulateRake(userId: string, wagerAmount: number, tx: Pick<typeof db, 'update'> = db) {
  const rake = (wagerAmount * RAKEBACK_RATE).toFixed(4)
  await tx.update(user)
    .set({ rake: sql`${user.rake} + ${rake}::numeric` })
    .where(eq(user.id, userId))
}

export async function getBalance(userId: string) {
  const result = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { balance: true },
  })
  return result?.balance ?? '0'
}

export async function getHistory(userId: string, limit = 50) {
  return db.query.transactions.findMany({
    where: eq(transactions.userId, userId),
    orderBy: desc(transactions.createdAt),
    limit,
  })
}
