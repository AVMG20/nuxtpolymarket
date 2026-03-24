import { desc, gte } from 'drizzle-orm'
import { db } from '#server/database'
import { gemMarketState, gemPriceHistory } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
  INITIAL_PRICE,
  HOURLY_GROWTH_RATE,
  HISTORY_DAYS,
  HISTORY_LIMIT,
  computeLivePrice,
} from './_config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })

  // Get or initialize market state
  let state = await db.query.gemMarketState.findFirst()

  if (!state) {
    const initialPrice = INITIAL_PRICE.toFixed(8)
    await db.insert(gemMarketState).values({ id: 'market', price: initialPrice, lastUpdatedAt: new Date() })
    await db.insert(gemPriceHistory).values({ price: initialPrice, action: 'init', gems: 0 })
    state = { id: 'market', price: initialPrice, lastUpdatedAt: new Date() }
  }

  const storedPrice = parseFloat(state.price)
  const livePrice = computeLivePrice(storedPrice, state.lastUpdatedAt)

  const cutoff = new Date(Date.now() - HISTORY_DAYS * 24 * 3_600_000)
  const history = await db.query.gemPriceHistory.findMany({
    where: gte(gemPriceHistory.createdAt, cutoff),
    orderBy: [desc(gemPriceHistory.createdAt)],
    limit: HISTORY_LIMIT,
    columns: { id: true, price: true, action: true, gems: true, totalAmount: true, createdAt: true },
    with: { user: { columns: { name: true } } },
  })

  return {
    storedPrice,
    livePrice,
    lastUpdatedAt: state.lastUpdatedAt,
    // Pass config to client so it can compute live price client-side
    hourlyGrowthRate: HOURLY_GROWTH_RATE,
    initialPrice: INITIAL_PRICE,
    // History newest-first; client reverses for charting
    history: history.map(h => ({
      price: h.price,
      action: h.action,
      gems: h.gems,
      totalAmount: h.totalAmount,
      userName: h.user?.name ?? null,
      createdAt: h.createdAt,
    })),
    userGems: session?.user?.gems ?? null,
  }
})
