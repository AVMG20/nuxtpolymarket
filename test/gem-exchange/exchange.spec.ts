import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray, or } from 'drizzle-orm'
import { db } from '#server/database'
import { user, gemOrders, gemTrades } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { placeGemOrder, cancelGemOrder } from '#server/utils/gem-exchange'
import { GEM_EXCHANGE_MAX_OPEN_ORDERS } from '#shared/utils/gamelogic/gem-exchange'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const BUYER = 'test-gemx-buyer'
const SELLER = 'test-gemx-seller'
const USERS = [BUYER, SELLER]

async function getGems(id: string) {
    const row = await db.query.user.findFirst({ where: eq(user.id, id), columns: { gems: true } })
    return row!.gems
}

async function openOrders(id: string) {
    return db.query.gemOrders.findMany({
        where: (orders, { and, eq: whereEq }) => and(whereEq(orders.userId, id), whereEq(orders.status, 'open'))
    })
}

// These specs share one exchange book with whatever else uses the database
// (a running dev server included). Cancel every open order — refunding its
// owner's escrow properly — so a stray real offer can never cross a test one.
async function clearBook() {
    const open = await db.query.gemOrders.findMany({ where: eq(gemOrders.status, 'open') })
    for (const order of open) {
        await cancelGemOrder(order.userId, order.id).catch(() => {})
    }
}

// Trades reference users with SET NULL, so they must go before the users do —
// orphaned rows would leak into the guide price of the real dev market.
async function cleanup() {
    await clearBook()
    await db.delete(gemTrades).where(or(inArray(gemTrades.buyerId, USERS), inArray(gemTrades.sellerId, USERS)))
    await db.delete(gemOrders).where(inArray(gemOrders.userId, USERS))
    for (const id of USERS) await cleanupUser(id)
}

describe.skipIf(SKIP)('gem exchange (database)', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('matches a crossing buy against a resting sell and settles both sides', async () => {
        await seedUser(BUYER, { balance: '10000.0000' })
        await seedUser(SELLER, { gems: 10 })

        const sell = await placeGemOrder(SELLER, 'sell', 300, 10)
        expect(sell.status).toBe('open')
        expect(await getGems(SELLER)).toBe(0) // gems escrowed

        const buy = await placeGemOrder(BUYER, 'buy', 300, 10)
        expect(buy.status).toBe('filled')
        expect(buy.filled).toBe(10)
        expect(buy.avgFillPrice).toBe(300)

        expect(await getGems(BUYER)).toBe(10)
        expect(await getBalance(BUYER)).toBe('7000.0000')
        expect(await getBalance(SELLER)).toBe('3000.0000')

        const trades = await db.select().from(gemTrades).where(eq(gemTrades.sellerId, SELLER))
        expect(trades).toHaveLength(1)
        expect(trades[0]!.quantity).toBe(10)
    })

    it('fills at the resting price and refunds the buyer the difference', async () => {
        await seedUser(BUYER, { balance: '3500.0000' })
        await seedUser(SELLER, { gems: 10 })

        await placeGemOrder(SELLER, 'sell', 290, 10)
        const buy = await placeGemOrder(BUYER, 'buy', 350, 10)

        expect(buy.status).toBe('filled')
        expect(buy.avgFillPrice).toBe(290)
        // Escrowed 3500, paid 2900, change 600 back
        expect(await getBalance(BUYER)).toBe('600.0000')
        expect(await getGems(BUYER)).toBe(10)
        expect(await getBalance(SELLER)).toBe('2900.0000')
    })

    it('leaves the unfilled remainder of a partially matched offer on the book', async () => {
        await seedUser(BUYER, { balance: '5000.0000' })
        await seedUser(SELLER, { gems: 10 })

        await placeGemOrder(SELLER, 'sell', 300, 10)
        const buy = await placeGemOrder(BUYER, 'buy', 300, 4)
        expect(buy.status).toBe('filled')

        const [remainingSell] = await openOrders(SELLER)
        expect(remainingSell!.filled).toBe(4)
        expect(remainingSell!.quantity).toBe(10)
        expect(await getGems(BUYER)).toBe(4)
    })

    it('cancelling refunds the escrow backing the unfilled remainder', async () => {
        await seedUser(BUYER, { balance: '3000.0000' })
        await seedUser(SELLER, { gems: 20 })

        const buy = await placeGemOrder(BUYER, 'buy', 300, 10)
        expect(await getBalance(BUYER)).toBe('0.0000')
        await cancelGemOrder(BUYER, buy.orderId)
        expect(await getBalance(BUYER)).toBe('3000.0000')

        const sell = await placeGemOrder(SELLER, 'sell', 300, 20)
        expect(await getGems(SELLER)).toBe(0)
        const result = await cancelGemOrder(SELLER, sell.orderId)
        expect(result.refundedQuantity).toBe(20)
        expect(await getGems(SELLER)).toBe(20)
    })

    it('rejects placement when funds are insufficient, leaving no order behind', async () => {
        await seedUser(BUYER, { balance: '100.0000', gems: 2 })

        await expect(placeGemOrder(BUYER, 'buy', 300, 1)).rejects.toThrow()
        await expect(placeGemOrder(BUYER, 'sell', 300, 5)).rejects.toThrow()

        expect(await openOrders(BUYER)).toHaveLength(0)
        expect(await getBalance(BUYER)).toBe('100.0000')
        expect(await getGems(BUYER)).toBe(2)
    })

    it('rejects invalid prices, quantities and oversized totals', async () => {
        await seedUser(BUYER, { balance: '10000.0000' })

        await expect(placeGemOrder(BUYER, 'buy', 300.005, 1)).rejects.toThrow()
        await expect(placeGemOrder(BUYER, 'buy', 0, 1)).rejects.toThrow()
        await expect(placeGemOrder(BUYER, 'buy', 300, 0)).rejects.toThrow()
        await expect(placeGemOrder(BUYER, 'buy', 300, 2.5)).rejects.toThrow()
        // cent-exactness of the total would overflow float64 integers
        await expect(placeGemOrder(BUYER, 'buy', 90_000_000_000_000, 2)).rejects.toThrow()
    })

    it('caps a player at the maximum number of open offers', async () => {
        await seedUser(BUYER, { balance: '1000.0000' })

        // Seed the cap directly — placing 100 real orders is pointlessly slow
        await db.insert(gemOrders).values(Array.from({ length: GEM_EXCHANGE_MAX_OPEN_ORDERS }, () => ({
            userId: BUYER,
            side: 'buy',
            price: '0.0100',
            quantity: 1
        })))
        await expect(placeGemOrder(BUYER, 'buy', 0.01, 1)).rejects.toThrow()
        expect(await openOrders(BUYER)).toHaveLength(GEM_EXCHANGE_MAX_OPEN_ORDERS)
    })

    it('lets a player fill their own offer as a clean wash', async () => {
        await seedUser(BUYER, { balance: '3000.0000', gems: 10 })

        await placeGemOrder(BUYER, 'sell', 300, 10)
        const buy = await placeGemOrder(BUYER, 'buy', 300, 10)

        expect(buy.status).toBe('filled')
        expect(buy.filled).toBe(10)
        // Round trip with no tax: everything comes back
        expect(await getGems(BUYER)).toBe(10)
        expect(await getBalance(BUYER)).toBe('3000.0000')
        expect(await openOrders(BUYER)).toHaveLength(0)
    })

    it('conserves every coin and gem under a concurrent buy burst', async () => {
        // Seller offers 50 gems; buyer fires 10 concurrent 10-gem orders (100
        // gems of demand). Exactly 50 gems must change hands, and coins must be
        // fully accounted for across balances and open escrow.
        await seedUser(BUYER, { balance: '30000.0000' })
        await seedUser(SELLER, { gems: 50 })

        await placeGemOrder(SELLER, 'sell', 300, 50)
        const result = await burst(10, () => placeGemOrder(BUYER, 'buy', 300, 10))
        expect(result.ok).toBe(10)

        expect(await getGems(BUYER)).toBe(50)
        expect(await getGems(SELLER)).toBe(0)

        const trades = await db.select().from(gemTrades).where(eq(gemTrades.sellerId, SELLER))
        expect(trades.reduce((sum, trade) => sum + trade.quantity, 0)).toBe(50)

        expect(await getBalance(SELLER)).toBe('15000.0000')

        // 5 orders filled instantly, 5 rest open with 15,000 coins escrowed
        const buyerOpen = await openOrders(BUYER)
        const escrow = buyerOpen.reduce((sum, order) => sum + (order.quantity - order.filled) * parseFloat(order.price), 0)
        const buyerBalance = parseFloat(await getBalance(BUYER))
        expect(buyerBalance + escrow + 15000).toBeCloseTo(30000, 4)
    })

    it('lets only one of N concurrent cancels refund the escrow', async () => {
        await seedUser(SELLER, { gems: 25 })

        const sell = await placeGemOrder(SELLER, 'sell', 300, 25)
        const result = await burst(10, () => cancelGemOrder(SELLER, sell.orderId))

        expect(result).toEqual({ ok: 1, rejected: 9 })
        expect(await getGems(SELLER)).toBe(25)
    })
})
