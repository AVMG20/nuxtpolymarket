import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, minerState, bankState } from '#server/database/schema'
import { gemComputeLivePrice, gemSellGems, GEM_INITIAL_PRICE } from '#shared/utils/gamelogic/gem-market'
import { overclockMultiplier, catalystMultiplier } from '#shared/utils/miner-config'
import { debtFloor, growBankBalance } from '#shared/utils/gamelogic/bank'

export default defineEventHandler(async () => {
  const [users, market] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        balance: user.balance,
        gems: user.gems,
        prestigeLevel: user.prestigeLevel,
        rigLevel: minerState.rigLevel,
        vaultLevel: minerState.vaultLevel,
        factoryLevel: minerState.factoryLevel,
        overclockLevel: minerState.overclockLevel,
        catalystLevel: minerState.catalystLevel,
        bankBalance: bankState.balance,
        bankLastSettledAt: bankState.lastSettledAt,
        bankLoanPrincipal: bankState.loanPrincipal,
      })
      .from(user)
      .leftJoin(minerState, eq(minerState.userId, user.id))
      .leftJoin(bankState, eq(bankState.userId, user.id)),
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
      const storedBankBalance = parseFloat(u.bankBalance ?? '0')
      const loanPrincipal = parseFloat(u.bankLoanPrincipal ?? '0')
      let bankBalance = u.bankLastSettledAt
        ? growBankBalance(storedBankBalance, u.bankLastSettledAt)
        : storedBankBalance
      if (bankBalance < 0 && loanPrincipal > 0) bankBalance = Math.max(bankBalance, debtFloor(loanPrincipal))
      const totalWealth = balance + gemValue + bankBalance
      const totalLevels = (u.rigLevel ?? 1) + (u.vaultLevel ?? 1) + (u.factoryLevel ?? 1)
      return {
        id: u.id,
        name: u.name,
        prestigeLevel: u.prestigeLevel,
        balance: u.balance,
        bankBalance,
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
    .sort((a, b) => b.prestigeLevel - a.prestigeLevel || b.totalLevels - a.totalLevels || b.totalWealth - a.totalWealth)
})
