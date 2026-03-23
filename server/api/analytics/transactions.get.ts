import { sql, eq, gte, and, desc } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions } from '#server/database/schema'
import { auth } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const userId = session.user.id

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 2)
  threeDaysAgo.setHours(0, 0, 0, 0)

  const [todayTxs, dailyStats] = await Promise.all([
    db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        gte(transactions.createdAt, todayStart)
      ),
      orderBy: [desc(transactions.createdAt)],
    }),
    db.select({
      date: sql<string>`DATE(${transactions.createdAt})`.as('date'),
      type: transactions.type,
      total: sql<string>`SUM(${transactions.amount}::numeric)`.as('total'),
    })
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        gte(transactions.createdAt, threeDaysAgo)
      ))
      .groupBy(sql`DATE(${transactions.createdAt})`, transactions.type)
      .orderBy(sql`DATE(${transactions.createdAt})`),
  ])

  const totalCredits = todayTxs
    .filter(t => t.type === 'credit')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0)

  const totalDebits = todayTxs
    .filter(t => t.type === 'debit')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0)

  return {
    todayTransactions: todayTxs,
    dailyStats,
    summary: {
      totalCredits,
      totalDebits,
      net: totalCredits - totalDebits,
      txCount: todayTxs.length,
    },
  }
})
