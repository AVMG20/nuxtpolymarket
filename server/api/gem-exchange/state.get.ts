import { and, asc, count, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '#server/database'
import { gemOrders, gemTrades, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getGemGuidePrice } from '#server/utils/gem-exchange'
import {
    GEM_EXCHANGE_HISTORY_DAYS,
    GEM_EXCHANGE_HISTORY_LIMIT,
    GEM_EXCHANGE_ORDER_LIST_LIMIT
} from '#shared/utils/gamelogic/gem-exchange'

const BOOK_DEPTH = 12

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    const userId = session?.user?.id ?? null

    const buyer = alias(user, 'buyer')
    const seller = alias(user, 'seller')
    const dayAgo = new Date(Date.now() - 24 * 3_600_000)
    const historyCutoff = new Date(Date.now() - GEM_EXCHANGE_HISTORY_DAYS * 24 * 3_600_000)
    // Self-trades are wash volume at an arbitrary self-chosen price — excluded
    // from every price/stat query below, not just the "Recent Trades" list.
    const notSelfTrade = sql`${gemTrades.buyerId} is distinct from ${gemTrades.sellerId}`

    const [guidePrice, depthRows, bids, asks, recentTrades, history, stats24hRows, prevTrade] = await Promise.all([
        getGemGuidePrice(),
        // Whole-book depth (the aggregated levels below are truncated)
        db.select({
            gemsForSale: sql<number>`coalesce(sum(case when ${gemOrders.side} = 'sell' then ${gemOrders.quantity} - ${gemOrders.filled} else 0 end), 0)`.mapWith(Number),
            gemsWanted: sql<number>`coalesce(sum(case when ${gemOrders.side} = 'buy' then ${gemOrders.quantity} - ${gemOrders.filled} else 0 end), 0)`.mapWith(Number)
        })
            .from(gemOrders)
            .where(eq(gemOrders.status, 'open')),
        db.select({
            price: gemOrders.price,
            quantity: sql<number>`sum(${gemOrders.quantity} - ${gemOrders.filled})`.mapWith(Number),
            orders: count()
        })
            .from(gemOrders)
            .where(and(eq(gemOrders.status, 'open'), eq(gemOrders.side, 'buy')))
            .groupBy(gemOrders.price)
            .orderBy(desc(gemOrders.price))
            .limit(BOOK_DEPTH),
        db.select({
            price: gemOrders.price,
            quantity: sql<number>`sum(${gemOrders.quantity} - ${gemOrders.filled})`.mapWith(Number),
            orders: count()
        })
            .from(gemOrders)
            .where(and(eq(gemOrders.status, 'open'), eq(gemOrders.side, 'sell')))
            .groupBy(gemOrders.price)
            .orderBy(asc(gemOrders.price))
            .limit(BOOK_DEPTH),
        db.select({
            id: gemTrades.id,
            price: gemTrades.price,
            quantity: gemTrades.quantity,
            createdAt: gemTrades.createdAt,
            buyerId: gemTrades.buyerId,
            buyerName: buyer.name,
            buyerEmblem: buyer.emblem,
            sellerId: gemTrades.sellerId,
            sellerName: seller.name,
            sellerEmblem: seller.emblem
        })
            .from(gemTrades)
            .leftJoin(buyer, eq(gemTrades.buyerId, buyer.id))
            .leftJoin(seller, eq(gemTrades.sellerId, seller.id))
            .where(notSelfTrade)
            .orderBy(desc(gemTrades.createdAt))
            .limit(40),
        db.select({
            price: gemTrades.price,
            quantity: gemTrades.quantity,
            createdAt: gemTrades.createdAt
        })
            .from(gemTrades)
            .where(and(gte(gemTrades.createdAt, historyCutoff), notSelfTrade))
            .orderBy(desc(gemTrades.createdAt))
            .limit(GEM_EXCHANGE_HISTORY_LIMIT),
        db.select({
            volumeGems: sql<number>`coalesce(sum(${gemTrades.quantity}), 0)`.mapWith(Number),
            volumeCoins: sql<string>`coalesce(sum(${gemTrades.price} * ${gemTrades.quantity}), 0)`,
            high: sql<string | null>`max(${gemTrades.price})`,
            low: sql<string | null>`min(${gemTrades.price})`
        })
            .from(gemTrades)
            .where(and(gte(gemTrades.createdAt, dayAgo), notSelfTrade)),
        // Reference price for the 24h change: last trade before the window.
        db.query.gemTrades.findFirst({
            where: and(lt(gemTrades.createdAt, dayAgo), notSelfTrade),
            orderBy: desc(gemTrades.createdAt),
            columns: { price: true }
        })
    ])

    // Every open offer on the exchange, newest first, with the offering
    // player's identity and a `mine` flag so the viewer can cancel their own.
    const openOrders = await db
        .select({
            id: gemOrders.id,
            userId: gemOrders.userId,
            side: gemOrders.side,
            price: gemOrders.price,
            quantity: gemOrders.quantity,
            filled: gemOrders.filled,
            createdAt: gemOrders.createdAt,
            userName: user.name,
            userEmblem: user.emblem
        })
        .from(gemOrders)
        .leftJoin(user, eq(gemOrders.userId, user.id))
        .where(eq(gemOrders.status, 'open'))
        .orderBy(desc(gemOrders.createdAt))
        .limit(GEM_EXCHANGE_ORDER_LIST_LIMIT)

    const lastPrice = recentTrades[0] ? parseFloat(recentTrades[0].price) : null
    const referencePrice = prevTrade
        ? parseFloat(prevTrade.price)
        : (history.length ? parseFloat(history[history.length - 1]!.price) : null)
    const change24h = lastPrice !== null && referencePrice
        ? ((lastPrice - referencePrice) / referencePrice) * 100
        : null

    const stats = stats24hRows[0]

    return {
        guidePrice,
        lastPrice,
        change24h,
        bestBid: bids[0] ? parseFloat(bids[0].price) : null,
        bestAsk: asks[0] ? parseFloat(asks[0].price) : null,
        gemsForSale: depthRows[0]?.gemsForSale ?? 0,
        gemsWanted: depthRows[0]?.gemsWanted ?? 0,
        stats24h: {
            volumeGems: stats?.volumeGems ?? 0,
            volumeCoins: parseFloat(stats?.volumeCoins ?? '0'),
            high: stats?.high ? parseFloat(stats.high) : null,
            low: stats?.low ? parseFloat(stats.low) : null
        },
        book: {
            bids: bids.map(level => ({ price: parseFloat(level.price), quantity: level.quantity, orders: level.orders })),
            asks: asks.map(level => ({ price: parseFloat(level.price), quantity: level.quantity, orders: level.orders }))
        },
        trades: recentTrades.map(trade => ({
            id: trade.id,
            price: parseFloat(trade.price),
            quantity: trade.quantity,
            buyerName: trade.buyerName,
            buyerEmblem: trade.buyerEmblem,
            sellerName: trade.sellerName,
            sellerEmblem: trade.sellerEmblem,
            mine: userId !== null && (trade.buyerId === userId || trade.sellerId === userId),
            iBought: userId !== null && trade.buyerId === userId,
            iSold: userId !== null && trade.sellerId === userId,
            createdAt: trade.createdAt
        })),
        // Oldest-first for charting
        history: history.reverse().map(trade => ({
            price: parseFloat(trade.price),
            quantity: trade.quantity,
            createdAt: trade.createdAt
        })),
        orders: openOrders.map(order => ({
            id: order.id,
            side: order.side as 'buy' | 'sell',
            price: parseFloat(order.price),
            quantity: order.quantity,
            filled: order.filled,
            createdAt: order.createdAt,
            userName: order.userName,
            userEmblem: order.userEmblem,
            mine: userId !== null && order.userId === userId
        })),
        userGems: session?.user?.gems ?? null
    }
})
