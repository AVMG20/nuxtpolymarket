/**
 * Player-to-player gifts. The debit guard is the only thing standing between
 * a burst of parallel gifts and an overdrawn wallet, so the concurrency cases
 * matter more than the happy path. Needs the local Postgres from .env.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { giftToUser } from '#server/utils/gift'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const SENDER = 'test-gift-sender'
const RECEIVER = 'test-gift-receiver'

async function getGems(id: string) {
    const row = await db.query.user.findFirst({ where: eq(user.id, id), columns: { gems: true } })
    return row!.gems
}

describe.skipIf(SKIP)('giftToUser', () => {
    beforeEach(async () => {
        await cleanupUser(SENDER)
        await cleanupUser(RECEIVER)
    })
    afterEach(async () => {
        await cleanupUser(SENDER)
        await cleanupUser(RECEIVER)
    })
    afterAll(async () => { await db.$client.end() })

    it('moves coins and gems from sender to receiver', async () => {
        await seedUser(SENDER, { balance: '1000.0000', gems: 50 })
        await seedUser(RECEIVER, { balance: '0', gems: 0 })

        await giftToUser(SENDER, RECEIVER, { coins: 250, gems: 20 })

        expect(await getBalance(SENDER)).toBe('750.0000')
        expect(await getBalance(RECEIVER)).toBe('250.0000')
        expect(await getGems(SENDER)).toBe(30)
        expect(await getGems(RECEIVER)).toBe(20)
    })

    it('rejects gifting yourself, empty gifts and unknown players', async () => {
        await seedUser(SENDER, { balance: '1000.0000', gems: 50 })
        await seedUser(RECEIVER)

        await expect(giftToUser(SENDER, SENDER, { coins: 10 })).rejects.toThrow()
        await expect(giftToUser(SENDER, RECEIVER, {})).rejects.toThrow()
        await expect(giftToUser(SENDER, RECEIVER, { coins: 0, gems: 0 })).rejects.toThrow()
        await expect(giftToUser(SENDER, RECEIVER, { gems: 1.5 })).rejects.toThrow()
        await expect(giftToUser(SENDER, RECEIVER, { coins: -5 })).rejects.toThrow()
        await expect(giftToUser(SENDER, RECEIVER, { coins: true })).rejects.toThrow()
        await expect(giftToUser(SENDER, RECEIVER, { gems: [5] })).rejects.toThrow()
        await expect(giftToUser(SENDER, RECEIVER, { coins: 'NaN' })).rejects.toThrow()
        await expect(giftToUser(SENDER, 'test-gift-nobody', { coins: 10 })).rejects.toThrow()
        expect(await getBalance(SENDER)).toBe('1000.0000')
        expect(await getGems(SENDER)).toBe(50)
    })

    it('rolls the whole gift back when the gem leg fails', async () => {
        await seedUser(SENDER, { balance: '1000.0000', gems: 5 })
        await seedUser(RECEIVER)

        await expect(giftToUser(SENDER, RECEIVER, { coins: 100, gems: 10 })).rejects.toThrow()

        expect(await getBalance(SENDER)).toBe('1000.0000')
        expect(await getBalance(RECEIVER)).toBe('0.0000')
    })

    it('lets only one of N concurrent full-wallet gifts through', async () => {
        await seedUser(SENDER, { balance: '1000.0000' })
        await seedUser(RECEIVER)

        const result = await burst(10, () => giftToUser(SENDER, RECEIVER, { coins: 1000 }))

        expect(result).toEqual({ ok: 1, rejected: 9 })
        expect(await getBalance(SENDER)).toBe('0.0000')
        expect(await getBalance(RECEIVER)).toBe('1000.0000')
    })

    it('survives two players gifting each other at once without deadlocking', async () => {
        await seedUser(SENDER, { balance: '500.0000', gems: 10 })
        await seedUser(RECEIVER, { balance: '500.0000', gems: 10 })

        const result = await burst(10, i => i % 2 === 0
            ? giftToUser(SENDER, RECEIVER, { coins: 10, gems: 1 })
            : giftToUser(RECEIVER, SENDER, { coins: 10, gems: 1 }))

        expect(result).toEqual({ ok: 10, rejected: 0 })
        expect(await getBalance(SENDER)).toBe('500.0000')
        expect(await getBalance(RECEIVER)).toBe('500.0000')
        expect(await getGems(SENDER)).toBe(10)
    })
})
