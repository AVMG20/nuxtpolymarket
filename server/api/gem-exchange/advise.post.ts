import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { gemOrders, gemTrades } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getGemGuidePrice } from '#server/utils/gem-exchange'
import { askJev } from '#server/utils/jev'
import { isValidGemQuantity } from '#shared/utils/gamelogic/gem-exchange'
import {
    gemAdvisorOptions,
    gemAdvisorPick,
    gemAdvisorQuestion,
    gemAdvisorState,
    type GemAdvisorMarket
} from '#shared/utils/gamelogic/gem-price-advisor'

// The price box's AI button: a good resting price for the offer the player is
// about to place, picked by Jev from offers code has already priced. The
// market is read here, never taken from the client. Nothing is placed.

const TRADE_SAMPLE = 30
const COOLDOWN_MS = 1_500
const CACHE_TTL_MS = 30_000

const lastAsk = new Map<string, number>()
interface AdviseResult {
    price: number
    probability: number
    /** False when Jev was unavailable or unsure and the front of the queue was used. */
    jev: boolean
}

const cache = new Map<string, { at: number, result: AdviseResult }>()

async function readMarket(): Promise<GemAdvisorMarket> {
    const notSelfTrade = sql`${gemTrades.buyerId} is distinct from ${gemTrades.sellerId}`
    const dayAgo = new Date(Date.now() - 24 * 3_600_000)
    const [guidePrice, [book], trades, [today]] = await Promise.all([
        getGemGuidePrice(),
        db.select({
            bestBid: sql<string | null>`max(case when ${gemOrders.side} = 'buy' then ${gemOrders.price} end)`,
            bestAsk: sql<string | null>`min(case when ${gemOrders.side} = 'sell' then ${gemOrders.price} end)`,
            gemsForSale: sql<number>`coalesce(sum(case when ${gemOrders.side} = 'sell' then ${gemOrders.quantity} - ${gemOrders.filled} else 0 end), 0)`.mapWith(Number),
            gemsWanted: sql<number>`coalesce(sum(case when ${gemOrders.side} = 'buy' then ${gemOrders.quantity} - ${gemOrders.filled} else 0 end), 0)`.mapWith(Number)
        }).from(gemOrders).where(eq(gemOrders.status, 'open')),
        db.select({ price: gemTrades.price, quantity: gemTrades.quantity })
            .from(gemTrades)
            .where(notSelfTrade)
            .orderBy(desc(gemTrades.createdAt))
            .limit(TRADE_SAMPLE),
        db.select({ trades: count() }).from(gemTrades).where(and(gte(gemTrades.createdAt, dayAgo), notSelfTrade))
    ])
    return {
        guidePrice,
        bestBid: book?.bestBid ? parseFloat(book.bestBid) : null,
        bestAsk: book?.bestAsk ? parseFloat(book.bestAsk) : null,
        gemsForSale: book?.gemsForSale ?? 0,
        gemsWanted: book?.gemsWanted ?? 0,
        trades: trades.map(trade => ({ price: parseFloat(trade.price), quantity: trade.quantity })),
        trades24h: today?.trades ?? 0
    }
}

export default defineEventHandler(async (event): Promise<AdviseResult> => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const side = body?.side === 'buy' ? 'buy' as const : body?.side === 'sell' ? 'sell' as const : null
    const quantity = Number(body?.quantity)
    if (!side || !isValidGemQuantity(quantity)) throw createError({ statusCode: 400, statusMessage: 'Invalid request' })

    const now = Date.now()
    if (now - (lastAsk.get(userId) ?? 0) < COOLDOWN_MS) throw createError({ statusCode: 429, statusMessage: 'Slow down a moment' })
    lastAsk.set(userId, now)

    const market = await readMarket()
    const options = gemAdvisorOptions(side, market)
    const state = gemAdvisorState(side, quantity, market)

    // Same side, same order size and same market: same answer, no new call.
    const key = JSON.stringify([side, state, options.map(option => option.price)])
    const hit = cache.get(key)
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.result

    const answers = options.length > 1 ? await askJev(state, { price: gemAdvisorQuestion(side, options) }) : null
    const pick = gemAdvisorPick(options, market.guidePrice, answers?.price)
    const result: AdviseResult = { price: pick.option.price, probability: pick.probability, jev: pick.jev }
    if (answers) {
        if (cache.size >= 200) cache.delete(cache.keys().next().value!)
        cache.set(key, { at: now, result })
    }
    return result
})
