import { sql, gte, eq, desc, isNull, inArray, and, type SQL } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions, user } from '#server/database/schema'
import { GENERAL_LABEL, normaliseCategory, prefixesForLabel } from '#shared/utils/analytics-categories'
import { GENRES, genreForLabel, prefixesForGenre, type Genre } from '#shared/utils/game-genres'

// Every read the audit page makes goes through here, so the two endpoints and
// the tests that cover them all interpret the ledger the same way.

export const AUDIT_WINDOWS = {
    '24h': { hours: 24, bucket: 'hour' },
    '7d': { hours: 24 * 7, bucket: 'day' },
    '30d': { hours: 24 * 30, bucket: 'day' }
} as const

export type AuditWindow = keyof typeof AUDIT_WINDOWS

/**
 * Which side of the ledger a figure is measured on.
 * - `net`     — debits minus credits: what the house kept.
 * - `emitted` — credits only: what the game handed to players, ignoring stake.
 * - `spent`   — debits only: what players put in.
 */
export type AuditMetric = 'net' | 'emitted' | 'spent'

export const AUDIT_METRICS: AuditMetric[] = ['net', 'emitted', 'spent']

export function parseWindow(raw: unknown): AuditWindow {
    return typeof raw === 'string' && raw in AUDIT_WINDOWS ? raw as AuditWindow : '24h'
}

export function parseMetric(raw: unknown): AuditMetric {
    return AUDIT_METRICS.includes(raw as AuditMetric) ? raw as AuditMetric : 'net'
}

export function windowStart(window: AuditWindow): Date {
    return new Date(Date.now() - AUDIT_WINDOWS[window].hours * 60 * 60 * 1000)
}

export const creditedSql = sql<string>`SUM(CASE WHEN ${transactions.type} = 'credit' THEN ${transactions.amount}::numeric ELSE 0 END)`
export const debitedSql = sql<string>`SUM(CASE WHEN ${transactions.type} = 'debit' THEN ${transactions.amount}::numeric ELSE 0 END)`

/** Aggregate to sort by, for the metric the caller picked. */
export function metricSql(metric: AuditMetric): SQL<string> {
    if (metric === 'emitted') return creditedSql
    if (metric === 'spent') return debitedSql
    return sql<string>`${debitedSql} - ${creditedSql}`
}

export const categoryPrefixSql = sql<string>`lower(split_part(${transactions.category}, ':', 1))`

/**
 * Matches every raw category that collapses onto one display label, so
 * `live-blackjack:side:...` and `blackjack` both count as Blackjack.
 */
export function categoryFilterForLabel(label: string): SQL | undefined {
    if (label === GENERAL_LABEL) return isNull(transactions.category)
    return inArray(categoryPrefixSql, prefixesForLabel(label))
}

/**
 * Buckets a row into its genre in SQL, so distinct-player counts per genre are
 * exact — folding per-category counts in JS would double-count anyone who
 * played two games in the same genre. `economy` is the fallback, matching
 * `genreForLabel`.
 */
export const genreSql = sql<Genre>`CASE ${sql.join(
    GENRES.filter(genre => genre !== 'economy')
        .map(genre => sql`WHEN ${inArray(categoryPrefixSql, prefixesForGenre(genre))} THEN ${genre}`),
    sql` `
)} ELSE 'economy' END`

/**
 * Group by this, not by `genreSql` itself. Repeating the CASE renumbers its
 * bound parameters, so Postgres does not recognise the two copies as the same
 * expression and rejects the query — group by the output alias instead.
 */
export const GENRE_ALIAS = 'genre'
export const genreGroupBySql = sql.raw(`"${GENRE_ALIAS}"`)

export function inWindowFor(window: AuditWindow, label?: string): SQL | undefined {
    const since = gte(transactions.createdAt, windowStart(window))
    if (!label) return since
    return and(since, categoryFilterForLabel(label))
}

const distinctPlayersSql = sql<number>`COUNT(DISTINCT ${transactions.userId})::int`
const txCountSql = sql<number>`COUNT(*)::int`

export interface AuditGameRow {
    label: string
    genre: Genre
    /** Paid out to players. */
    credits: number
    /** Put in by players. */
    debits: number
    txCount: number
    players: number
}

export interface AuditSeriesRow {
    bucket: Date
    label: string
    credits: number
    debits: number
}

export interface AuditPlayerRow {
    userId: string
    name: string
    image: string | null
    credits: number
    debits: number
    txCount: number
}

/**
 * Site-wide totals for the window: one row per game, a bucketed series, and
 * distinct-player counts per scope.
 *
 * Both sides of the ledger are returned raw — `credits` (paid out to players)
 * and `debits` (put in by players) — so the client can switch which one it
 * measures by without another round trip.
 */
export async function auditOverview(window: AuditWindow) {
    const { hours, bucket } = AUDIT_WINDOWS[window]
    const inWindow = inWindowFor(window)
    const bucketSql = sql<Date>`date_trunc(${sql.raw(`'${bucket}'`)}, ${transactions.createdAt})`
    // No bound parameters, so repeating this expression in GROUP BY renders
    // identically and Postgres matches the two copies. `genreSql` cannot do the
    // same — see `genreGroupBySql`.
    const prefixSql = sql<string>`COALESCE(${categoryPrefixSql}, '')`

    // Player counts are never summed from the per-category rows: that would
    // double-count anyone who touched two games, or two variants of one game.
    // Each scope gets its own COUNT(DISTINCT ...) instead.
    const [perCategory, series, [totals], playersPerPrefix, playersPerGenre] = await Promise.all([
        db.select({
            category: transactions.category,
            credits: creditedSql.as('credits'),
            debits: debitedSql.as('debits'),
            txCount: txCountSql.as('tx_count')
        })
            .from(transactions)
            .where(inWindow)
            .groupBy(transactions.category),

        db.select({
            bucket: bucketSql.as('bucket'),
            category: transactions.category,
            credits: creditedSql.as('credits'),
            debits: debitedSql.as('debits')
        })
            .from(transactions)
            .where(inWindow)
            .groupBy(bucketSql, transactions.category)
            .orderBy(bucketSql),

        db.select({ players: distinctPlayersSql.as('players') })
            .from(transactions)
            .where(inWindow),

        db.select({ prefix: prefixSql.as('prefix'), players: distinctPlayersSql.as('players') })
            .from(transactions)
            .where(inWindow)
            .groupBy(prefixSql),

        db.select({ genre: genreSql.as(GENRE_ALIAS), players: distinctPlayersSql.as('players') })
            .from(transactions)
            .where(inWindow)
            .groupBy(genreGroupBySql)
    ])

    // Exact for every label backed by a single prefix. The handful backed by
    // several (Blackjack is `blackjack` + `live-blackjack`) take the largest
    // contributing prefix, since the union would need a scan of its own.
    const playersByLabel = new Map<string, number>()
    for (const row of playersPerPrefix) {
        const label = normaliseCategory(row.prefix === '' ? null : row.prefix)
        playersByLabel.set(label, Math.max(playersByLabel.get(label) ?? 0, row.players))
    }

    const byLabel = new Map<string, AuditGameRow>()
    for (const row of perCategory) {
        const label = normaliseCategory(row.category)
        let entry = byLabel.get(label)
        if (!entry) {
            entry = { label, genre: genreForLabel(label), credits: 0, debits: 0, txCount: 0, players: 0 }
            byLabel.set(label, entry)
        }
        entry.credits += parseFloat(row.credits ?? '0')
        entry.debits += parseFloat(row.debits ?? '0')
        entry.txCount += row.txCount
    }

    const games: AuditGameRow[] = [...byLabel.values()].map(entry => ({
        ...entry,
        players: playersByLabel.get(entry.label) ?? 0
    }))

    return {
        window,
        since: windowStart(window),
        days: hours / 24,
        bucket,
        totalPlayers: totals?.players ?? 0,
        playersByGenre: Object.fromEntries(
            playersPerGenre.map(row => [row.genre, row.players])
        ) as Partial<Record<Genre, number>>,
        games,
        series: series.map((row): AuditSeriesRow => ({
            bucket: row.bucket,
            label: normaliseCategory(row.category),
            credits: parseFloat(row.credits ?? '0'),
            debits: parseFloat(row.debits ?? '0')
        }))
    }
}

/** Who moved the most money through one game over the window. */
export async function topPlayersForLabel(
    label: string,
    window: AuditWindow,
    metric: AuditMetric,
    limit: number
): Promise<AuditPlayerRow[]> {
    const rows = await db.select({
        userId: transactions.userId,
        name: user.name,
        image: user.image,
        credits: creditedSql.as('credits'),
        debits: debitedSql.as('debits'),
        txCount: txCountSql.as('tx_count')
    })
        .from(transactions)
        .innerJoin(user, eq(user.id, transactions.userId))
        .where(inWindowFor(window, label))
        .groupBy(transactions.userId, user.name, user.image)
        .orderBy(desc(metricSql(metric)))
        .limit(limit)

    return rows.map(row => ({
        userId: row.userId,
        name: row.name,
        image: row.image,
        credits: parseFloat(row.credits ?? '0'),
        debits: parseFloat(row.debits ?? '0'),
        txCount: row.txCount
    }))
}
