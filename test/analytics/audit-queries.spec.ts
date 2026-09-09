import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions } from '#server/database/schema'
import {
    AUDIT_METRICS,
    AUDIT_WINDOWS,
    GENRE_ALIAS,
    auditOverview,
    categoryPrefixSql,
    genreGroupBySql,
    genreSql,
    inWindowFor,
    parseMetric,
    parseWindow,
    topPlayersForLabel,
    type AuditWindow
} from '#server/utils/audit'
import { normaliseCategory } from '#shared/utils/analytics-categories'
import { GENRES, genreForLabel } from '#shared/utils/game-genres'

// The audit reads build their CASE and IN clauses from the shared genre tables.
// That composition is easy to break in ways only Postgres notices — a repeated
// expression whose bound parameters renumber is rejected outright — so run the
// real query functions rather than asserting on generated strings.

const WINDOWS = Object.keys(AUDIT_WINDOWS) as AuditWindow[]

describe('auditOverview', () => {
    it('runs for every window', async () => {
        for (const window of WINDOWS) {
            const overview = await auditOverview(window)
            expect(overview.window).toBe(window)
            expect(overview.days).toBe(AUDIT_WINDOWS[window].hours / 24)
            expect(overview.since.getTime()).toBeLessThan(Date.now())
        }
    })

    it('buckets every game into a known genre', async () => {
        const overview = await auditOverview('30d')
        for (const game of overview.games) {
            expect(GENRES).toContain(game.genre)
            expect(game.genre).toBe(genreForLabel(game.label))
        }
    })

    it('agrees with the client mapping — the SQL CASE matches genreForLabel', async () => {
        // The CASE bucket comes from raw prefixes, the page's from display
        // labels. They are built from the same table, so a row bucketed one way
        // in SQL and another way in JS means the two have drifted apart.
        const rows = await db.select({
            genre: genreSql.as(GENRE_ALIAS),
            prefix: sql<string>`COALESCE(${categoryPrefixSql}, '')`.as('prefix')
        })
            .from(transactions)
            .where(inWindowFor('30d'))
            .groupBy(genreGroupBySql, sql`COALESCE(${categoryPrefixSql}, '')`)

        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
            const label = normaliseCategory(row.prefix === '' ? null : row.prefix)
            expect(row.genre, `${row.prefix || '<null>'} → ${label}`).toBe(genreForLabel(label))
        }
    })

    it('counts distinct players per scope rather than summing game rows', async () => {
        const overview = await auditOverview('30d')

        for (const genre of Object.keys(overview.playersByGenre)) {
            expect(GENRES).toContain(genre)
        }

        // Summing per-game counts double-counts anyone who played more than one
        // game, so the site-wide figure must never exceed that sum, and never
        // be smaller than any single game's.
        const summed = overview.games.reduce((total, g) => total + g.players, 0)
        expect(overview.totalPlayers).toBeLessThanOrEqual(summed || overview.totalPlayers)
        for (const game of overview.games) {
            expect(game.players).toBeLessThanOrEqual(overview.totalPlayers)
        }
        for (const players of Object.values(overview.playersByGenre)) {
            expect(players).toBeLessThanOrEqual(overview.totalPlayers)
        }
    })

    it('returns both sides of the ledger as finite numbers', async () => {
        const overview = await auditOverview('30d')
        for (const game of [...overview.games, ...overview.series]) {
            expect(Number.isFinite(game.credits)).toBe(true)
            expect(Number.isFinite(game.debits)).toBe(true)
            expect(game.credits).toBeGreaterThanOrEqual(0)
            expect(game.debits).toBeGreaterThanOrEqual(0)
        }
    })

    it('labels the series the same way as the game rows', async () => {
        const overview = await auditOverview('30d')
        const known = new Set(overview.games.map(g => g.label))
        for (const row of overview.series) {
            expect(known).toContain(row.label)
        }
    })
})

describe('topPlayersForLabel', () => {
    it('ranks by each metric, for single- and multi-prefix labels and the null-category one', async () => {
        for (const label of ['Blackjack', 'Miner', 'General']) {
            for (const metric of AUDIT_METRICS) {
                const players = await topPlayersForLabel(label, '30d', metric, 5)
                expect(players.length).toBeLessThanOrEqual(5)

                const values = players.map(p =>
                    metric === 'emitted' ? p.credits : metric === 'spent' ? p.debits : p.debits - p.credits
                )
                expect(values).toEqual([...values].sort((a, b) => b - a))
            }
        }
    })
})

describe('query parsing', () => {
    it('falls back to safe defaults instead of trusting the query string', () => {
        expect(parseWindow('7d')).toBe('7d')
        expect(parseWindow('nonsense')).toBe('24h')
        expect(parseWindow(undefined)).toBe('24h')
        expect(parseMetric('emitted')).toBe('emitted')
        expect(parseMetric('drop table')).toBe('net')
        expect(parseMetric(undefined)).toBe('net')
    })
})
