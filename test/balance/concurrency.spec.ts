/**
 * Regression test for the debit() TOCTOU race.
 *
 * Before the fix, debit() read the balance, checked it, then wrote — so N
 * concurrent debits all passed the check and all applied, driving the balance
 * negative (10 concurrent bets of 1000 on a 1000 balance left it at -9000).
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions } from '#server/database/schema'
import { credit, debit, getBalance } from '#server/utils/balance'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-balance-race-user'

describe.skipIf(SKIP)('debit() concurrency', () => {
    beforeEach(() => cleanupUser(USER_ID))
    afterEach(() => cleanupUser(USER_ID))
    afterAll(async () => { await db.$client.end() })

    it('lets only one of N concurrent full-balance debits through', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })

        const result = await burst(10, () => debit(USER_ID, '1000.0000', 'test'))

        expect(result).toEqual({ ok: 1, rejected: 9 })
        expect(await getBalance(USER_ID)).toBe('0.0000')
    })

    it('never drives the balance negative under a concurrent burst', async () => {
        await seedUser(USER_ID, { balance: '500.0000' })

        await burst(20, () => debit(USER_ID, '100.0000', 'test'))

        expect(parseFloat(await getBalance(USER_ID))).toBeGreaterThanOrEqual(0)
    })

    it('applies every concurrent debit the balance can actually cover', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })

        const result = await burst(10, () => debit(USER_ID, '100.0000', 'test'))

        expect(result).toEqual({ ok: 10, rejected: 0 })
        expect(parseFloat(await getBalance(USER_ID))).toBe(0)
    })

    it('writes one ledger row per successful debit', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })

        await burst(10, () => debit(USER_ID, '100.0000', 'test'))

        const rows = await db.select().from(transactions).where(eq(transactions.userId, USER_ID))
        expect(rows).toHaveLength(10)
    })

    it('rejects a negative amount rather than crediting it', async () => {
        await seedUser(USER_ID, { balance: '100.0000' })

        await expect(debit(USER_ID, '-500.0000', 'test')).rejects.toThrow()
        await expect(credit(USER_ID, '-500.0000', 'test')).rejects.toThrow()
        expect(await getBalance(USER_ID)).toBe('100.0000')
    })

    it('rejects NaN rather than poisoning the balance', async () => {
        await seedUser(USER_ID, { balance: '100.0000' })

        await expect(debit(USER_ID, 'NaN', 'test')).rejects.toThrow()
        await expect(credit(USER_ID, 'NaN', 'test')).rejects.toThrow()
        expect(await getBalance(USER_ID)).toBe('100.0000')
    })
})
