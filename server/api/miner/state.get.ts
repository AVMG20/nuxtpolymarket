import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user, gemMarketState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
  rigIncome, vaultCap, rigUpgradeCost, vaultUpgradeCost,
  factoryRate, factoryCap, factoryUpgradeCost, computePending,
  RIG_MAX_LEVEL, VAULT_MAX_LEVEL, FACTORY_MAX_LEVEL,
  lootboxSlotCost, LOOTBOX_MAX_SLOTS, lootboxExpectedValue, lootboxOpenPrice,
} from '#shared/utils/miner-config'
import { gemComputeLivePrice, GEM_INITIAL_PRICE } from '#shared/utils/gamelogic/gem-market'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [currentUser, state, market] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
    db.query.gemMarketState.findFirst(),
  ])

  // Auto-create state on first visit
  const s = state ?? (await db.insert(minerState).values({ userId }).returning())[0]!

  const income = rigIncome(s.rigLevel)
  const cap = vaultCap(s.vaultLevel)
  const rate = factoryRate(s.factoryLevel)
  const gemCap = factoryCap(s.factoryLevel)

  const pendingCash = computePending(income, s.lastCollectedAt, cap)
  const pendingGems = computePending(rate, s.factoryLastCollectedAt, gemCap)

  const gemPrice = market
    ? gemComputeLivePrice(parseFloat(market.price), market.lastUpdatedAt)
    : GEM_INITIAL_PRICE
  const today = new Date().toISOString().slice(0, 10)
  const lootboxOpensToday = s.lootboxOpensDate === today ? s.lootboxTodayOpens : 0

  return {
    rigLevel: s.rigLevel,
    rigMaxLevel: RIG_MAX_LEVEL,
    income,
    rigUpgradeCost: rigUpgradeCost(s.rigLevel),
    vaultLevel: s.vaultLevel,
    vaultMaxLevel: VAULT_MAX_LEVEL,
    cap,
    vaultUpgradeCost: vaultUpgradeCost(s.vaultLevel),
    pendingCash,
    lastCollectedAt: s.lastCollectedAt,
    factoryLevel: s.factoryLevel,
    factoryMaxLevel: FACTORY_MAX_LEVEL,
    rate,
    gemCap,
    factoryUpgradeCost: factoryUpgradeCost(s.factoryLevel),
    pendingGems,
    factoryLastCollectedAt: s.factoryLastCollectedAt,
    gems: currentUser?.gems ?? 0,
    gemPrice,
    lootboxSlots: s.lootboxSlots,
    lootboxMaxSlots: LOOTBOX_MAX_SLOTS,
    lootboxNextSlotCost: lootboxSlotCost(s.lootboxSlots),
    lootboxFreeOpensRemaining: Math.max(0, s.lootboxSlots - lootboxOpensToday),
    lootboxAvgValue: lootboxExpectedValue(cap, gemPrice),
    lootboxOpenPrice: lootboxOpenPrice(cap, gemPrice),
  }
})
