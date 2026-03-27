import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
  rigIncome, vaultCap, rigUpgradeCost, vaultUpgradeCost,
  factoryRate, factoryCap, factoryUpgradeCost, computePending,
  RIG_MAX_LEVEL, VAULT_MAX_LEVEL, FACTORY_MAX_LEVEL,
  minesPurchaseCost, MINES_MAX_COUNT,
  minesUpgradeCost, MINES_UPGRADE_MAX_LEVEL, minesValueMultiplier,
  instantFillCost, SHOP_QUICK_CASH_AMOUNT,
} from '~/shared/utils/miner-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [currentUser, state] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
  ])

  // Auto-create state on first visit
  const s = state ?? (await db.insert(minerState).values({ userId }).returning())[0]!

  const income = rigIncome(s.rigLevel)
  const cap = vaultCap(s.vaultLevel)
  const rate = factoryRate(s.factoryLevel)
  const gemCap = factoryCap(s.factoryLevel)

  const pendingCash = computePending(income, s.lastCollectedAt, cap)
  const pendingGems = computePending(rate, s.factoryLastCollectedAt, gemCap)

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
    minesCount: s.minesCount,
    minesMaxCount: MINES_MAX_COUNT,
    minesNextCost: minesPurchaseCost(s.minesCount),
    minesLevel: s.minesLevel,
    minesMaxLevel: MINES_UPGRADE_MAX_LEVEL,
    minesNextUpgradeCost: minesUpgradeCost(s.minesLevel),
    minesValueMultiplier: minesValueMultiplier(s.minesLevel),
    instantFillCost: instantFillCost(s.vaultLevel),
    quickCashAmount: SHOP_QUICK_CASH_AMOUNT,
    minesPlaysRemaining: (() => {
      const today = new Date().toISOString().slice(0, 10)
      const used = s.minesPlaysDate === today ? s.minesTodayPlays : 0
      return Math.max(0, s.minesCount - used)
    })(),
  }
})
