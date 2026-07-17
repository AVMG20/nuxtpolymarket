import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, transactions } from '#server/database/schema'
import { credit, creditGems, debitGems, getBalance } from '#server/utils/balance'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-gems-race-user'

async function getGems() {
    const row = await db.query.user.findFirst({ where: eq(user.id, USER_ID), columns: { gems: true } })
    return row!.gems
}

describe.skipIf(SKIP)('gems concurrency', () => {
    beforeEach(() => cleanupUser(USER_ID))
    afterEach(() => cleanupUser(USER_ID))
    afterAll(async () => { await db.$client.end() })

    it('lets only one of N concurrent full-balance gem spends through', async () => {
        await seedUser(USER_ID, { gems: 100 })

        const result = await burst(10, () => debitGems(USER_ID, 100))

        expect(result).toEqual({ ok: 1, rejected: 9 })
        expect(await getGems()).toBe(0)
    })

    it('never drives the gem balance negative under a concurrent burst', async () => {
        await seedUser(USER_ID, { gems: 50 })

        await burst(20, () => debitGems(USER_ID, 10))

        expect(await getGems()).toBeGreaterThanOrEqual(0)
    })

    it('rejects a non-integer cost without touching the balance', async () => {
        await seedUser(USER_ID, { gems: 100 })

        await expect(debitGems(USER_ID, 1.5)).rejects.toThrow()
        expect(await getGems()).toBe(100)
    })

    it('rejects a negative cost without touching the balance', async () => {
        await seedUser(USER_ID, { gems: 100 })

        await expect(debitGems(USER_ID, -10)).rejects.toThrow()
        expect(await getGems()).toBe(100)
    })

    it('applies every concurrent gem credit', async () => {
        await seedUser(USER_ID, { gems: 0 })

        const result = await burst(10, () => creditGems(USER_ID, 5))

        expect(result).toEqual({ ok: 10, rejected: 0 })
        expect(await getGems()).toBe(50)
    })

    it('treats creditGems(0) as a no-op', async () => {
        await seedUser(USER_ID, { gems: 25 })

        await creditGems(USER_ID, 0)

        expect(await getGems()).toBe(25)
    })

    it('rejects a non-integer or negative gem credit without touching the balance', async () => {
        await seedUser(USER_ID, { gems: 25 })

        await expect(creditGems(USER_ID, 1.5)).rejects.toThrow()
        await expect(creditGems(USER_ID, -5)).rejects.toThrow()
        expect(await getGems()).toBe(25)
    })

    it('applies every concurrent balance credit and writes one ledger row each', async () => {
        await seedUser(USER_ID, { balance: '0.0000' })

        const result = await burst(10, () => credit(USER_ID, '10.0000', 'test'))

        expect(result).toEqual({ ok: 10, rejected: 0 })
        expect(await getBalance(USER_ID)).toBe('100.0000')

        const rows = await db.select().from(transactions).where(eq(transactions.userId, USER_ID))
        expect(rows).toHaveLength(10)
    })
})
