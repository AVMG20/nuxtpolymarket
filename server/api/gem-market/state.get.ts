import { desc, gte } from 'drizzle-orm'
import { db } from '#server/database'
import { gemMarketState, gemPriceHistory } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
  GEM_INITIAL_PRICE,
  GEM_HOURLY_GROWTH_RATE,
  GEM_HISTORY_DAYS,
  GEM_HISTORY_LIMIT,
  gemComputeLivePrice,
} from '#shared/utils/gamelogic/gem-market'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })

  // Get or initialize market state
  let state = await db.query.gemMarketState.findFirst()

  if (!state) {
    state = await initMarketState();
  }

  const storedPrice = parseFloat(state.price)
  const livePrice = gemComputeLivePrice(storedPrice, state.lastUpdatedAt)

  const cutoff = new Date(Date.now() - GEM_HISTORY_DAYS * 24 * 3_600_000)
  const history = await db.query.gemPriceHistory.findMany({
    where: gte(gemPriceHistory.createdAt, cutoff),
    orderBy: [desc(gemPriceHistory.createdAt)],
    limit: GEM_HISTORY_LIMIT,
    columns: { id: true, price: true, action: true, gems: true, totalAmount: true, createdAt: true },
    with: { user: { columns: { name: true } } },
  })

  return {
    storedPrice,
    livePrice,
    lastUpdatedAt: state.lastUpdatedAt,
    // Passed to client so it can run the same stepped computation
    hourlyGrowthRate: GEM_HOURLY_GROWTH_RATE,
    initialPrice: GEM_INITIAL_PRICE,
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


async function initMarketState() {
  const initialPrice = GEM_INITIAL_PRICE.toFixed(8)
  await db.insert(gemMarketState).values({id: 'market', price: initialPrice, lastUpdatedAt: new Date()})
  await db.insert(gemPriceHistory).values({price: initialPrice, action: 'init', gems: 0})
  return {id: 'market', price: initialPrice, lastUpdatedAt: new Date()}
}
