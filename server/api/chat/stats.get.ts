import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

// Today's net result per transaction category for the current user.
// Used by the chat widget's profit/loss share buttons.
export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const rows = await db
    .select({
      category: transactions.category,
      net: sql<string>`sum(case when ${transactions.type} = 'credit' then ${transactions.amount} else -${transactions.amount} end)`
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      gte(transactions.createdAt, startOfToday)
    ))
    .groupBy(transactions.category)

  let best: { category: string, amount: number } | null = null
  let worst: { category: string, amount: number } | null = null
  for (const row of rows) {
    // deposits aren't winnings
    if (row.category === 'deposit') continue
    const amount = parseFloat(row.net)
    const category = row.category ?? 'other'
    if (!best || amount > best.amount) best = { category, amount }
    if (!worst || amount < worst.amount) worst = { category, amount }
  }

  return { best, worst }
})
