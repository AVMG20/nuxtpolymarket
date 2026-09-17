import { eq, and, gte, like, sql, desc } from 'drizzle-orm'
import { db, type DbExecutor } from '../database'
import { user, transactions } from '../database/schema'
import { applyBankGarnish } from './bank'
import { RAKEBACK_RATE } from '../../shared/utils/profile'

// Postgres numeric accepts 'NaN', which would silently poison a balance forever.
function assertAmount(amount: string) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid amount' })
  }
}

/**
 * Money coming back that the player already owned is not an earning: refunds,
 * escrow returns and crash-recovery payouts must not be garnished, or a
 * cancelled order would cost 10% to place.
 */
function isEarning(category?: string) {
  if (!category) return true
  return !/refund|recovery|cancel|^bank/.test(category)
}

async function applyCredit(ex: DbExecutor, userId: string, amount: string, category?: string) {
  await ex.insert(transactions).values({ userId, amount, type: 'credit', category })
  const [updated] = await ex.update(user)
    .set({ balance: sql`${user.balance} + ${amount}::numeric` })
    .where(eq(user.id, userId))
    .returning({ balance: user.balance })

  // The wallet row is locked above before bank_state is touched below — that
  // order is what keeps the garnish from deadlocking against the bank endpoints.
  if (!isEarning(category)) return updated!.balance
  const garnished = await applyBankGarnish(ex, userId, Number(amount))
  if (garnished <= 0) return updated!.balance

  const levy = garnished.toFixed(4)
  const [afterLevy] = await ex.update(user)
    .set({ balance: sql`${user.balance} - ${levy}::numeric` })
    .where(eq(user.id, userId))
    .returning({ balance: user.balance })
  await ex.insert(transactions).values({ userId, amount: levy, type: 'debit', category: 'bank:garnish' })
  return afterLevy!.balance
}

// The `balance >= amount` guard lives in the WHERE clause so the check and the
// decrement are one statement — two concurrent debits can never both pass and
// push the balance negative (the read-then-write pattern this replaces could).
async function applyDebit(ex: DbExecutor, userId: string, amount: string, category?: string) {
  const [updated] = await ex.update(user)
    .set({ balance: sql`${user.balance} - ${amount}::numeric` })
    .where(and(eq(user.id, userId), sql`${user.balance} >= ${amount}::numeric`))
    .returning({ balance: user.balance })
  if (!updated) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })

  await ex.insert(transactions).values({ userId, amount, type: 'debit', category })
  return updated.balance
}

export async function credit(userId: string, amount: string, category?: string, tx?: DbExecutor) {
  assertAmount(amount)
  if (tx) return applyCredit(tx, userId, amount, category)
  return db.transaction(t => applyCredit(t, userId, amount, category))
}

export async function debit(userId: string, amount: string, category?: string, tx?: DbExecutor) {
  assertAmount(amount)
  if (tx) return applyDebit(tx, userId, amount, category)
  return db.transaction(t => applyDebit(t, userId, amount, category))
}

// Atomically spend gems. The `gte` guard lives in the WHERE clause so the check and
// the decrement are a single statement — two concurrent spends can never both pass and
// push the balance negative (the read-then-write pattern this replaces could). Throws a
// 400 when the user can't afford `cost` and returns the remaining gem balance otherwise.
export async function debitGems(userId: string, cost: number, tx: DbExecutor = db) {
  if (!Number.isInteger(cost) || cost < 0) throw createError({ statusCode: 400, statusMessage: 'Invalid gem amount' })

  const [updated] = await tx.update(user)
    .set({ gems: sql`${user.gems} - ${cost}` })
    .where(and(eq(user.id, userId), gte(user.gems, cost)))
    .returning({ gems: user.gems })
  if (!updated) throw createError({ statusCode: 400, statusMessage: 'Not enough gems' })
  return updated.gems
}

// Same shape as debitGems: the `gte` guard is part of the UPDATE, so the check
// and the decrement cannot be separated by a concurrent purchase. Prestige
// tokens are never credited here — the only thing that raises them is an
// ascent, which SETS them to the tier allowance (see server/utils/prestige.ts).
export async function debitPrestigeTokens(userId: string, cost: number, tx: DbExecutor = db) {
  if (!Number.isInteger(cost) || cost < 0) throw createError({ statusCode: 400, statusMessage: 'Invalid token amount' })

  const [updated] = await tx.update(user)
    .set({ prestigeTokens: sql`${user.prestigeTokens} - ${cost}` })
    .where(and(eq(user.id, userId), gte(user.prestigeTokens, cost)))
    .returning({ prestigeTokens: user.prestigeTokens })
  if (!updated) throw createError({ statusCode: 400, statusMessage: 'Not enough prestige tokens' })
  return updated.prestigeTokens
}

export async function creditGems(userId: string, count: number, tx: DbExecutor = db) {
  if (!Number.isInteger(count) || count < 0) throw createError({ statusCode: 400, statusMessage: 'Invalid gem amount' })
  if (count === 0) return

  await tx.update(user)
    .set({ gems: sql`${user.gems} + ${count}` })
    .where(eq(user.id, userId))
}

export async function accumulateRake(userId: string, wagerAmount: number, tx: DbExecutor = db) {
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

// Today's profit or loss across one game's ledger rows, matched on a category
// prefix so a game's sub-categories ('foo:double', 'foo:refund') all count. The
// day boundary is the database's, so every player rolls over at the same moment.
export async function getDailyNet(userId: string, categoryPrefix: string) {
  const [row] = await db
    .select({
      net: sql<string>`coalesce(sum(case when ${transactions.type} = 'credit' then ${transactions.amount} else -${transactions.amount} end), 0)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      like(transactions.category, `${categoryPrefix}%`),
      sql`${transactions.createdAt} >= date_trunc('day', localtimestamp)`
    ))
  return Number(row?.net ?? 0)
}

export async function getHistory(userId: string, limit = 50) {
  return db.query.transactions.findMany({
    where: eq(transactions.userId, userId),
    orderBy: desc(transactions.createdAt),
    limit,
  })
}
