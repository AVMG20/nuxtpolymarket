import { eq, sql } from 'drizzle-orm'
import { readBody } from 'h3'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit, debit } from '#server/utils/balance'
import {
  vaultCap,
  lootboxRoll,
  lootboxRewardValue,
  lootboxGemCount,
  lootboxOpenPrice,
  overclockMultiplier
} from '#shared/utils/miner-config'
import { gemComputeLivePrice, GEM_INITIAL_PRICE } from '#shared/utils/gamelogic/gem-market'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { mode } = await readBody<{ mode?: 'free' | 'paid' }>(event) ?? {}

  const [s, market] = await Promise.all([
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
    db.query.gemMarketState.findFirst()
  ])
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

  const today = new Date().toISOString().slice(0, 10)
  const opensToday = s.lootboxOpensDate === today ? s.lootboxTodayOpens : 0
  const freeRemaining = Math.max(0, s.lootboxSlots - opensToday)

  const cap = vaultCap(s.vaultLevel)
  const gemPrice = market
    ? gemComputeLivePrice(parseFloat(market.price), market.lastUpdatedAt)
    : GEM_INITIAL_PRICE

  const paid = mode === 'paid' || freeRemaining <= 0
  if (!paid && freeRemaining <= 0)
    throw createError({ statusCode: 400, statusMessage: 'No free opens remaining today' })

  // Charge / consume up-front so a roll is never granted for free.
  if (paid) {
    const price = lootboxOpenPrice(cap, gemPrice, s.factoryLevel)
    // debit throws 400 if the user can't afford it
    await debit(userId, price.toFixed(4), 'lootbox')
  } else {
    await db
      .update(minerState)
      .set({ lootboxTodayOpens: opensToday + 1, lootboxOpensDate: today })
      .where(eq(minerState.userId, userId))
  }

  // Roll and pay out. Rig Overclock boosts cash rewards (not gem rewards).
  const reward = lootboxRoll()
  const cashValue = reward.kind === 'cash'
    ? lootboxRewardValue(reward, cap, gemPrice, s.factoryLevel) * overclockMultiplier(s.overclockLevel)
    : lootboxRewardValue(reward, cap, gemPrice, s.factoryLevel)
  const gemsWon = lootboxGemCount(reward, s.factoryLevel)

  if (reward.kind === 'cash') {
    await credit(userId, cashValue.toFixed(4), 'lootbox')
  } else {
    await db.update(user).set({ gems: sql`${user.gems} + ${gemsWon}` }).where(eq(user.id, userId))
  }

  return {
    wonId: reward.id,
    kind: reward.kind,
    rarity: reward.rarity,
    cashValue,
    gemsWon,
    paid,
    freeOpensRemaining: paid ? freeRemaining : freeRemaining - 1
  }
})
