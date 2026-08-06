import { sql, eq, gte, and, isNull, inArray, desc } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { normaliseCategory, prefixesForLabel, GENERAL_LABEL } from '#shared/utils/analytics-categories'

const RECENT_LIMIT = 100

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const category = getQuery(event).category as string | undefined

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 2)
    threeDaysAgo.setHours(0, 0, 0, 0)

    // Raw categories collapse to one label per game (e.g. every
    // live-blackjack:* variant is "Blackjack"), so the filter matches on the
    // normalised prefix rather than the exact stored string.
    const categoryPrefixSql = sql`lower(split_part(${transactions.category}, ':', 1))`

    const categoryFilter = category
        ? (category === GENERAL_LABEL ? isNull(transactions.category) : inArray(categoryPrefixSql, prefixesForLabel(category)))
        : undefined

    const todayWhere = and(
        eq(transactions.userId, userId),
        gte(transactions.createdAt, todayStart),
        categoryFilter
    )

    const signedDelta = sql<string>`SUM(CASE WHEN ${transactions.type} = 'credit' THEN ${transactions.amount}::numeric ELSE -${transactions.amount}::numeric END)`

    const [dailyStats, categoryRows, perfBuckets, recentTransactions] = await Promise.all([
        // Last 3 days, credits vs debits per day — the bar chart (never filtered).
        db.select({
            date: sql<string>`DATE(${transactions.createdAt})`.as('date'),
            type: transactions.type,
            total: sql<string>`SUM(${transactions.amount}::numeric)`.as('total')
        })
            .from(transactions)
            .where(and(
                eq(transactions.userId, userId),
                gte(transactions.createdAt, threeDaysAgo)
            ))
            .groupBy(sql`DATE(${transactions.createdAt})`, transactions.type)
            .orderBy(sql`DATE(${transactions.createdAt})`),

        // Today grouped by category + type — powers the category list and, summed
        // client-side, the summary cards. Always the full set so the user can
        // switch between categories without a refetch.
        db.select({
            category: transactions.category,
            type: transactions.type,
            total: sql<string>`SUM(${transactions.amount}::numeric)`.as('total'),
            count: sql<number>`COUNT(*)::int`.as('count')
        })
            .from(transactions)
            .where(and(
                eq(transactions.userId, userId),
                gte(transactions.createdAt, todayStart)
            ))
            .groupBy(transactions.category, transactions.type),

        // Today's running balance, bucketed by minute so the line chart gets at
        // most ~1440 points instead of one per transaction (respects the filter).
        db.select({
            bucket: sql<Date>`date_trunc('minute', ${transactions.createdAt})`.as('bucket'),
            delta: signedDelta.as('delta')
        })
            .from(transactions)
            .where(todayWhere)
            .groupBy(sql`date_trunc('minute', ${transactions.createdAt})`)
            .orderBy(sql`date_trunc('minute', ${transactions.createdAt})`),

        // A single screenful of the most recent rows for the list (respects the
        // filter). The full-day total lives in the summary count instead.
        db.select({
            id: transactions.id,
            amount: transactions.amount,
            type: transactions.type,
            category: transactions.category,
            createdAt: transactions.createdAt
        })
            .from(transactions)
            .where(todayWhere)
            .orderBy(desc(transactions.createdAt))
            .limit(RECENT_LIMIT)
    ])

    const categoryStats = Object.values(
        categoryRows.reduce<Record<string, { category: string, credits: number, debits: number, count: number }>>((acc, row) => {
            const label = normaliseCategory(row.category)
            const entry = acc[label] ??= { category: label, credits: 0, debits: 0, count: 0 }
            if (row.type === 'credit') entry.credits += parseFloat(row.total)
            else entry.debits += parseFloat(row.total)
            entry.count += row.count
            return acc
        }, {})
    )
        .map(s => ({ ...s, net: s.credits - s.debits, volume: s.credits + s.debits }))
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

    // Summary reflects the active filter: one category's totals, or all of today.
    const scoped = category
        ? categoryStats.filter(s => s.category === category)
        : categoryStats
    const totalCredits = scoped.reduce((sum, s) => sum + s.credits, 0)
    const totalDebits = scoped.reduce((sum, s) => sum + s.debits, 0)
    const txCount = scoped.reduce((sum, s) => sum + s.count, 0)

    let running = 0
    const perfSeries = perfBuckets.map((b) => {
        running += parseFloat(b.delta)
        return { t: b.bucket, value: running }
    })

    return {
        summary: {
            totalCredits,
            totalDebits,
            net: totalCredits - totalDebits,
            txCount
        },
        categoryStats,
        dailyStats,
        perfSeries,
        recentTransactions: recentTransactions.map(tx => ({ ...tx, category: normaliseCategory(tx.category) }))
    }
})
