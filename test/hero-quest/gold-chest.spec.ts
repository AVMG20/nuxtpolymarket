/**
 * The Gold chest: settles bank the run's Gold in `hq_state.pending_gold` instead of crediting the
 * shared balance per settle, and opening the chest pays it out as one transaction, once.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState, transactions } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { collectChest, ensureHqState, settleHq } from '#server/utils/hero-quest'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

describe.skipIf(SKIP)('the Gold chest, through the database', () => {
    const USER_ID = 'test-hero-quest-gold-chest-user'

    async function cleanup() {
        await db.delete(hqState).where(eq(hqState.userId, USER_ID))
        await cleanupUser(USER_ID)
    }

    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
        await ensureHqState(USER_ID)
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    /** A window long enough to kill something, settled. */
    async function settleWindow(seconds = 120) {
        await db.update(hqState).set({ lastSettledAt: new Date(Date.now() - seconds * 1000) }).where(eq(hqState.userId, USER_ID))
        return settleHq(USER_ID)
    }

    const goldRows = () => db.select().from(transactions).where(and(eq(transactions.userId, USER_ID), eq(transactions.category, 'hero-quest')))

    it('banks a settle\'s Gold in the chest without touching the balance', async () => {
        const { result, state } = await settleWindow()
        expect(result!.goldEarned).toBeGreaterThan(0)
        expect(Number(state.pendingGold)).toBeCloseTo(result!.goldEarned, 3)
        expect(Number(await getBalance(USER_ID))).toBe(0)
        expect(await goldRows()).toHaveLength(0)
    })

    it('adds every settle to what the chest already holds', async () => {
        const first = await settleWindow()
        const second = await settleWindow()
        expect(Number(second.state.pendingGold)).toBeCloseTo(first.result!.goldEarned + second.result!.goldEarned, 3)
    })

    it('pays the chest as one transaction and empties it', async () => {
        const { state } = await settleWindow()
        const paid = await collectChest(USER_ID)
        expect(Number(paid.collected)).toBeCloseTo(Number(state.pendingGold), 4)
        expect(Number(paid.balance)).toBeCloseTo(Number(state.pendingGold), 4)
        expect(await goldRows()).toHaveLength(1)
        const [row] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
        expect(Number(row!.pendingGold)).toBe(0)
    })

    it('refuses an empty chest', async () => {
        await expect(collectChest(USER_ID)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('pays a burst of opens once', async () => {
        const { state } = await settleWindow()
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => collectChest(USER_ID)))
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(Number(await getBalance(USER_ID))).toBeCloseTo(Number(state.pendingGold), 4)
        expect(await goldRows()).toHaveLength(1)
    })
})
