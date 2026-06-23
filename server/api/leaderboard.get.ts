import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, minerState, gemMarketState } from '#server/database/schema'
import { gemComputeLivePrice, gemSellGems, GEM_INITIAL_PRICE } from '#shared/utils/gamelogic/gem-market'
import { overclockMultiplier, catalystMultiplier } from '#shared/utils/miner-config'

export default defineEventHandler(async () => {
  const [users, market] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        balance: user.balance,
        gems: user.gems,
        rigLevel: minerState.rigLevel,
        vaultLevel: minerState.vaultLevel,
        factoryLevel: minerState.factoryLevel,
        overclockLevel: minerState.overclockLevel,
        catalystLevel: minerState.catalystLevel,
      })
      .from(user)
      .leftJoin(minerState, eq(minerState.userId, user.id)),
    db.query.gemMarketState.findFirst(),
  ])

  const livePrice = market
    ? gemComputeLivePrice(parseFloat(market.price), market.lastUpdatedAt)
    : GEM_INITIAL_PRICE

  return users
    .map(u => {
      const balance = parseFloat(u.balance)
      const gems = u.gems ?? 0
      const gemValue = gems > 0 ? gemSellGems(livePrice, gems).revenue : 0
      const totalWealth = balance + gemValue
      const totalLevels = (u.rigLevel ?? 1) + (u.vaultLevel ?? 1) + (u.factoryLevel ?? 1)
      return {
        id: u.id,
        name: u.name,
        balance: u.balance,
        gems,
        gemValue,
        rigLevel: u.rigLevel ?? 1,
        vaultLevel: u.vaultLevel ?? 1,
        factoryLevel: u.factoryLevel ?? 1,
        overclockPct: Math.round((overclockMultiplier(u.overclockLevel ?? 0) - 1) * 100),
        catalystPct: Math.round((catalystMultiplier(u.catalystLevel ?? 0) - 1) * 100),
        totalLevels,
        totalWealth,
      }
    })
    .sort((a, b) => b.totalLevels - a.totalLevels || b.totalWealth - a.totalWealth)
})
