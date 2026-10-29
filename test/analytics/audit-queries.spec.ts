import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions } from '#server/database/schema'
import {
    AUDIT_METRICS,
    AUDIT_WINDOWS,
    auditOverview,
    parseMetric,
    parseWindow,
    topPlayersForLabel,
    type AuditWindow
} from '#server/utils/audit'
import { GENRES, prefixesForGenre } from '#shared/utils/game-genres'
import { cleanupUser, seedUser } from '../setup/db-helpers'

// The admin audit reads build their CASE and IN clauses from the shared genre tables.
// That composition is easy to break in ways only Postgres notices — a repeated
// expression whose bound parameters renumber is rejected outright — so run the
// real query functions rather than asserting on generated strings.

const WINDOWS = Object.keys(AUDIT_WINDOWS) as AuditWindow[]

const LEDGER_USER = 'test-audit-queries'

/**
 * One row per category the tables know about, plus an uncategorised one and a
 * game nobody has mapped yet.
 *
 * These reads used to assert against whatever the database happened to be
 * holding, which is every row on a developer's machine and none at all on a
 * fresh CI database — so the comparison between the SQL bucket and the JS one
 * silently passed over zero rows there, then failed the moment it was asked to
 * find any. The ledger the specs read is now the ledger they wrote.
 */
async function seedLedger() {
    await seedUser(LEDGER_USER)
    const prefixes = [...new Set(GENRES.flatMap(prefixesForGenre))]
    const categories: (string | null)[] = [
        ...prefixes,
        // A sub-category collapses to its prefix, and both sides of the null case.
        `${prefixes[0]}:side:seed`,
        'a-game-nobody-mapped-yet',
        null
    ]
    await db.insert(transactions).values(categories.map((category, i) => ({
        userId: LEDGER_USER,
        amount: '1.0000',
        type: i % 2 === 0 ? 'credit' : 'debit',
        category
    })))
}

beforeAll(seedLedger)
afterAll(async () => {
    await db.delete(transactions).where(eq(transactions.userId, LEDGER_USER))
    await cleanupUser(LEDGER_USER)
})

describe('auditOverview', () => {
    it('runs for every window', async () => {
        for (const window of WINDOWS) {
            const overview = await auditOverview(window)
            expect(overview.window).toBe(window)
            expect(overview.days).toBe(AUDIT_WINDOWS[window].hours / 24)
            expect(overview.since.getTime()).toBeLessThan(Date.now())
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
