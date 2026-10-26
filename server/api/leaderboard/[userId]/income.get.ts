import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { windowStart } from '#server/utils/audit'
import { INCOME_WINDOW_DAYS, summariseIncome } from '#shared/utils/player-income'

// A player's coin income over the last week, for the leaderboard's details
// modal. Totals per source only, never individual transactions. One aggregate
// over `transactions_userId_createdAt_idx`; transfers are dropped afterwards
// in `summariseIncome`, since there is one row per category at that point.

export default defineEventHandler(async (event) => {
    await requireUserId(event)

    const userId = getRouterParam(event, 'userId')
    if (!userId) throw createError({ statusCode: 400, statusMessage: 'userId is required' })

    const since = windowStart('7d')
    const rows = await db
        .select({
            category: transactions.category,
            amount: sql<string>`sum(${transactions.amount})`
        })
        .from(transactions)
        .where(and(
            eq(transactions.userId, userId),
            gte(transactions.createdAt, since),
            eq(transactions.type, 'credit')
        ))
        .groupBy(transactions.category)

    return {
        days: INCOME_WINDOW_DAYS,
        since: since.toISOString(),
        ...summariseIncome(rows.map(row => ({ category: row.category, amount: parseFloat(row.amount ?? '0') })))
    }
})
