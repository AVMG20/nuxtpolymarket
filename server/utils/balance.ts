import { eq, sql, desc } from 'drizzle-orm'
import { db } from '../database'
import { user, transactions } from '../database/schema'
import { RAKEBACK_RATE } from '../../shared/utils/profile'

export async function credit(userId: string, amount: string, category?: string) {
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({ userId, amount, type: 'credit', category })
    await tx.update(user)
      .set({ balance: sql`${user.balance} + ${amount}::numeric` })
      .where(eq(user.id, userId))
  })
}

export async function debit(userId: string, amount: string, category?: string) {
  await db.transaction(async (tx) => {
    const current = await tx.query.user.findFirst({ where: eq(user.id, userId), columns: { balance: true } })
    if (!current || parseFloat(current.balance) < parseFloat(amount)) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })

    await tx.insert(transactions).values({ userId, amount, type: 'debit', category })

    await tx.update(user)
      .set({ balance: sql`${user.balance} - ${amount}::numeric` })
      .where(eq(user.id, userId))
  })
}

export async function accumulateRake(userId: string, wagerAmount: number) {
  const rake = (wagerAmount * RAKEBACK_RATE).toFixed(4)
  await db.update(user)
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
