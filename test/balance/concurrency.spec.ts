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
import { user, transactions } from '#server/database/schema'
import { credit, debit, getBalance } from '#server/utils/balance'

const SKIP = !process.env.DATABASE_URL
const USER_ID = 'test-balance-race-user'

async function seed(balance: string) {
    await db.insert(user).values({
        id: USER_ID,
        name: 'balance race test',
        email: `${USER_ID}@test.invalid`,
        balance
    })
}

async function cleanup() {
    await db.delete(transactions).where(eq(transactions.userId, USER_ID))
    await db.delete(user).where(eq(user.id, USER_ID))
}

const settled = (results: PromiseSettledResult<unknown>[]) => ({
    ok: results.filter(r => r.status === 'fulfilled').length,
    rejected: results.filter(r => r.status === 'rejected').length
})

describe.skipIf(SKIP)('debit() concurrency', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('lets only one of N concurrent full-balance debits through', async () => {
        await seed('1000.0000')

        const results = await Promise.allSettled(
            Array.from({ length: 10 }, () => debit(USER_ID, '1000.0000', 'test'))
        )

        expect(settled(results)).toEqual({ ok: 1, rejected: 9 })
        expect(await getBalance(USER_ID)).toBe('0.0000')
    })

    it('never drives the balance negative under a concurrent burst', async () => {
        await seed('500.0000')

        await Promise.allSettled(
            Array.from({ length: 20 }, () => debit(USER_ID, '100.0000', 'test'))
        )

        expect(parseFloat(await getBalance(USER_ID))).toBeGreaterThanOrEqual(0)
    })

    it('applies every concurrent debit the balance can actually cover', async () => {
        await seed('1000.0000')

        const results = await Promise.allSettled(
            Array.from({ length: 10 }, () => debit(USER_ID, '100.0000', 'test'))
        )

        expect(settled(results)).toEqual({ ok: 10, rejected: 0 })
        expect(parseFloat(await getBalance(USER_ID))).toBe(0)
    })

    it('writes one ledger row per successful debit', async () => {
        await seed('1000.0000')

        await Promise.allSettled(
            Array.from({ length: 10 }, () => debit(USER_ID, '100.0000', 'test'))
        )

        const rows = await db.select().from(transactions).where(eq(transactions.userId, USER_ID))
        expect(rows).toHaveLength(10)
    })

    it('rejects a negative amount rather than crediting it', async () => {
        await seed('100.0000')

        await expect(debit(USER_ID, '-500.0000', 'test')).rejects.toThrow()
        await expect(credit(USER_ID, '-500.0000', 'test')).rejects.toThrow()
        expect(await getBalance(USER_ID)).toBe('100.0000')
    })

    it('rejects NaN rather than poisoning the balance', async () => {
        await seed('100.0000')

        await expect(debit(USER_ID, 'NaN', 'test')).rejects.toThrow()
        await expect(credit(USER_ID, 'NaN', 'test')).rejects.toThrow()
        expect(await getBalance(USER_ID)).toBe('100.0000')
    })
})
