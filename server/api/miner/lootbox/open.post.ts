import { eq, sql } from 'drizzle-orm'
import { readBody } from 'h3'
import { db } from '#server/database'
import { minerState, user, gemMarketState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import {
  vaultCap,
  lootboxRoll,
  lootboxRewardValue,
  lootboxGemCount,
  lootboxOpenGemCost,
  overclockMultiplier,
} from '#shared/utils/miner-config'
import { gemComputeLivePrice, GEM_INITIAL_PRICE } from '#shared/utils/gamelogic/gem-market'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { mode } = await readBody<{ mode?: 'free' | 'paid' }>(event) ?? {}
  const userId = session.user.id

  const [s, market, currentUser] = await Promise.all([
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
    db.query.gemMarketState.findFirst(),
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
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
    const gemCost = lootboxOpenGemCost(s.vaultLevel)
    if ((currentUser?.gems ?? 0) < gemCost)
      throw createError({ statusCode: 400, statusMessage: `Need ${gemCost} gems` })
    await db.update(user).set({ gems: sql`${user.gems} - ${gemCost}` }).where(eq(user.id, userId))
  } else {
    await db
      .update(minerState)
      .set({ lootboxTodayOpens: opensToday + 1, lootboxOpensDate: today })
      .where(eq(minerState.userId, userId))
  }

  // Roll and pay out. Rig Overclock boosts cash rewards (not gem rewards).
  const reward = lootboxRoll()
  const cashValue = reward.kind === 'cash'
    ? lootboxRewardValue(reward, cap, gemPrice) * overclockMultiplier(s.overclockLevel)
    : lootboxRewardValue(reward, cap, gemPrice)
  const gemsWon = lootboxGemCount(reward, gemPrice)

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
    freeOpensRemaining: paid ? freeRemaining : freeRemaining - 1,
  }
})
