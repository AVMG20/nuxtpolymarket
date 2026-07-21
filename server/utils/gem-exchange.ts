import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '../database'
import { gemOrders, gemTrades } from '../database/schema'
import { credit, debit, creditGems, debitGems } from './balance'
import {
    GEM_EXCHANGE_MAX_OPEN_ORDERS,
    GEM_GUIDE_PRICE_FALLBACK,
    isValidGemPrice,
    isValidGemQuantity,
    isValidGemOrderTotal,
    gemOrderTotal,
    matchGemOrder,
    type GemOrderFill
} from '#shared/utils/gamelogic/gem-exchange'

// App-unique advisory lock key. Every mutation of the order book (place,
// cancel) takes this transaction-scoped lock first, so matching is fully
// serialized — a fill can never race a cancel or another fill.
const GEM_EXCHANGE_LOCK_KEY = 761_442_010

async function lockBook(tx: DbExecutor) {
    await tx.execute(sql`select pg_advisory_xact_lock(${GEM_EXCHANGE_LOCK_KEY})`)
}

/**
 * Volume-weighted average trade price over the last 24h, falling back to the
 * most recent trade and finally to the launch anchor. Used wherever the rest
 * of the game needs a coin value for one gem (leaderboard wealth, lootbox
 * pricing) and as the default price in the exchange UI.
 */
export async function getGemGuidePrice(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 3_600_000)
    // Self-trades (a player filling their own offer) are wash volume with an
    // arbitrary self-chosen price — counting them would let a single player
    // drag the guide price anywhere, and that price feeds lootbox economics.
    const notSelfTrade = sql`${gemTrades.buyerId} is distinct from ${gemTrades.sellerId}`
    const [vwapRow] = await db
        .select({ vwap: sql<string | null>`sum(${gemTrades.price} * ${gemTrades.quantity}) / nullif(sum(${gemTrades.quantity}), 0)` })
        .from(gemTrades)
        .where(and(gte(gemTrades.createdAt, cutoff), notSelfTrade))
    if (vwapRow?.vwap) return parseFloat(vwapRow.vwap)

    const last = await db.query.gemTrades.findFirst({
        where: notSelfTrade,
        orderBy: desc(gemTrades.createdAt),
        columns: { price: true }
    })
    return last ? parseFloat(last.price) : GEM_GUIDE_PRICE_FALLBACK
}

export interface PlaceGemOrderResult {
    orderId: string
    side: 'buy' | 'sell'
    status: 'open' | 'filled'
    quantity: number
    filled: number
    remaining: number
    price: number
    /** Volume-weighted average price across immediate fills, null if none. */
    avgFillPrice: number | null
    /** Coins actually spent on fills (buy) or received (sell). */
    coinsMoved: number
}

/**
 * Place a limit order, escrow its funds and match it against the book.
 *
 * Buy orders escrow `quantity × price` coins up front; each fill at a cheaper
 * ask immediately refunds the difference (Grand Exchange change). Sell orders
 * escrow the gems. Sellers are paid the full fill price the moment a fill
 * happens — there is no collection box to empty.
 */
export async function placeGemOrder(
    userId: string,
    side: 'buy' | 'sell',
    price: number,
    quantity: number
): Promise<PlaceGemOrderResult> {
    if (side !== 'buy' && side !== 'sell') {
        throw createError({ statusCode: 400, statusMessage: 'Invalid order side' })
    }
    if (!isValidGemPrice(price)) {
        throw createError({ statusCode: 400, statusMessage: 'Price must be at least 0.01 coins with at most 2 decimals' })
    }
    if (!isValidGemQuantity(quantity)) {
        throw createError({ statusCode: 400, statusMessage: 'Quantity must be a whole number of gems' })
    }
    if (!isValidGemOrderTotal(price, quantity)) {
        throw createError({ statusCode: 400, statusMessage: 'Offer total is too large' })
    }

    return db.transaction(async (tx) => {
        await lockBook(tx)

        const [countRow] = await tx
            .select({ openCount: sql<number>`count(*)`.mapWith(Number) })
            .from(gemOrders)
            .where(and(eq(gemOrders.userId, userId), eq(gemOrders.status, 'open')))
        if ((countRow?.openCount ?? 0) >= GEM_EXCHANGE_MAX_OPEN_ORDERS) {
            throw createError({ statusCode: 400, statusMessage: `All ${GEM_EXCHANGE_MAX_OPEN_ORDERS} exchange slots are in use — cancel or wait for an offer to fill` })
        }

        // Escrow before matching: debit/debitGems throw 400 on insufficient funds.
        if (side === 'buy') {
            await debit(userId, gemOrderTotal(price, quantity).toFixed(4), 'gem exchange', tx)
        } else {
            await debitGems(userId, quantity, tx)
        }

        const opposite = side === 'buy' ? 'sell' : 'buy'
        const priceStr = price.toFixed(4)
        const restingRows = await tx
            .select()
            .from(gemOrders)
            .where(and(
                eq(gemOrders.status, 'open'),
                eq(gemOrders.side, opposite),
                side === 'buy' ? lte(gemOrders.price, priceStr) : gte(gemOrders.price, priceStr)
            ))
            .orderBy(
                side === 'buy' ? asc(gemOrders.price) : desc(gemOrders.price),
                asc(gemOrders.createdAt)
            )

        const book = restingRows.map(row => ({
            id: row.id,
            userId: row.userId,
            price: parseFloat(row.price),
            remaining: row.quantity - row.filled
        }))
        const { fills, remaining } = matchGemOrder({ side, price, quantity, book })

        let coinsMoved = 0
        for (const fill of fills) {
            await applyFill(tx, userId, side, price, fill)
            coinsMoved += gemOrderTotal(fill.price, fill.quantity)
        }

        const filled = quantity - remaining
        const status = remaining === 0 ? 'filled' as const : 'open' as const
        const [order] = await tx.insert(gemOrders).values({
            userId,
            side,
            price: priceStr,
            quantity,
            filled,
            status
        }).returning({ id: gemOrders.id })

        const filledValue = fills.reduce((sum, fill) => sum + gemOrderTotal(fill.price, fill.quantity), 0)
        return {
            orderId: order!.id,
            side,
            status,
            quantity,
            filled,
            remaining,
            price,
            avgFillPrice: filled > 0 ? filledValue / filled : null,
            coinsMoved
        }
    })
}

/** Settle one fill: move coins and gems, refund buy-side change, log the trade. */
async function applyFill(
    tx: DbExecutor,
    takerId: string,
    takerSide: 'buy' | 'sell',
    takerLimitPrice: number,
    fill: GemOrderFill
) {
    const [resting] = await tx.update(gemOrders)
        .set({
            filled: sql`${gemOrders.filled} + ${fill.quantity}`,
            status: sql`case when ${gemOrders.filled} + ${fill.quantity} >= ${gemOrders.quantity} then 'filled' else 'open' end`,
            updatedAt: new Date()
        })
        .where(and(eq(gemOrders.id, fill.orderId), eq(gemOrders.status, 'open')))
        .returning({ id: gemOrders.id })
    // The advisory lock makes this unreachable, but paying out against an
    // order someone managed to close would mint value — so hard-stop anyway.
    if (!resting) {
        throw createError({ statusCode: 500, statusMessage: 'Order book conflict' })
    }

    const fillTotal = gemOrderTotal(fill.price, fill.quantity)
    if (takerSide === 'buy') {
        const change = gemOrderTotal(takerLimitPrice, fill.quantity) - fillTotal
        if (change > 0) await credit(takerId, change.toFixed(4), 'gem exchange', tx)
        await creditGems(takerId, fill.quantity, tx)
        await credit(fill.userId, fillTotal.toFixed(4), 'gem exchange', tx)
    } else {
        // Resting buyer escrowed exactly fill.price per gem — no change due.
        await credit(takerId, fillTotal.toFixed(4), 'gem exchange', tx)
        await creditGems(fill.userId, fill.quantity, tx)
    }

    await tx.insert(gemTrades).values({
        buyerId: takerSide === 'buy' ? takerId : fill.userId,
        sellerId: takerSide === 'buy' ? fill.userId : takerId,
        price: fill.price.toFixed(4),
        quantity: fill.quantity
    })
}

/** Cancel an open order and refund the escrow backing its unfilled remainder. */
export async function cancelGemOrder(userId: string, orderId: string) {
    return db.transaction(async (tx) => {
        await lockBook(tx)

        const [order] = await tx.update(gemOrders)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(and(
                eq(gemOrders.id, orderId),
                eq(gemOrders.userId, userId),
                eq(gemOrders.status, 'open')
            ))
            .returning()
        if (!order) throw createError({ statusCode: 400, statusMessage: 'Offer is no longer open' })

        const remaining = order.quantity - order.filled
        if (remaining > 0) {
            if (order.side === 'buy') {
                await credit(userId, gemOrderTotal(parseFloat(order.price), remaining).toFixed(4), 'gem exchange', tx)
            } else {
                await creditGems(userId, remaining, tx)
            }
        }

        return { ok: true, orderId, side: order.side as 'buy' | 'sell', refundedQuantity: remaining }
    })
}
