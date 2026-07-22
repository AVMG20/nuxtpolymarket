import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
  vaultCap, rigUpgradeCost, vaultUpgradeCost,
  factoryCap, factoryUpgradeCost, computePending,
  RIG_MAX_LEVEL, VAULT_MAX_LEVEL, FACTORY_MAX_LEVEL,
  lootboxSlotCost, LOOTBOX_MAX_SLOTS, lootboxExpectedValue, lootboxOpenPrice,
  effectiveRigIncome, effectiveFactoryRate, overclockMultiplier, catalystMultiplier,
  overclockUpgradeCost, catalystUpgradeCost, OVERCLOCK_MAX_LEVEL, CATALYST_MAX_LEVEL,
} from '#shared/utils/miner-config'
import { getGemGuidePrice } from '#server/utils/gem-exchange'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const [currentUser, state, gemPrice] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { balance: true, gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
    getGemGuidePrice(),
  ])

  // Auto-create state on first visit
  const s = state ?? (await db.insert(minerState).values({ userId }).returning())[0]!

  const income = effectiveRigIncome(s.rigLevel, s.overclockLevel)
  const cap = vaultCap(s.vaultLevel)
  const rate = effectiveFactoryRate(s.factoryLevel, s.catalystLevel)
  const gemCap = factoryCap(s.factoryLevel)

  const pendingCash = computePending(income, s.lastCollectedAt, cap)
  const pendingGems = computePending(rate, s.factoryLastCollectedAt, gemCap)

  const today = new Date().toISOString().slice(0, 10)
  const lootboxOpensToday = s.lootboxOpensDate === today ? s.lootboxTodayOpens : 0

  return {
    walletBalance: parseFloat(currentUser?.balance ?? '0'),
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
    lootboxAvgValue: lootboxExpectedValue(cap),
    lootboxOpenPrice: lootboxOpenPrice(cap),
    // Gem-shop upgrades
    overclockLevel: s.overclockLevel,
    overclockMaxLevel: OVERCLOCK_MAX_LEVEL,
    incomeMultiplier: overclockMultiplier(s.overclockLevel),
    overclockNextCost: overclockUpgradeCost(s.overclockLevel),
    catalystLevel: s.catalystLevel,
    catalystMaxLevel: CATALYST_MAX_LEVEL,
    gemRateMultiplier: catalystMultiplier(s.catalystLevel),
    catalystNextCost: catalystUpgradeCost(s.catalystLevel),
  }
})
