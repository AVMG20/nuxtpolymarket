import { eq } from 'drizzle-orm'
import { readBody } from 'h3'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit, debit } from '#server/utils/balance'
import {
  vaultCap,
  lootboxRoll,
  lootboxRewardValue,
  lootboxOpenPrice,
  overclockMultiplier
} from '#shared/utils/miner-config'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { mode } = await readBody<{ mode?: 'free' | 'paid' }>(event) ?? {}

  const s = await db.query.minerState.findFirst({ where: eq(minerState.userId, userId) })
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

  const today = new Date().toISOString().slice(0, 10)
  const opensToday = s.lootboxOpensDate === today ? s.lootboxTodayOpens : 0
  const freeRemaining = Math.max(0, s.lootboxSlots - opensToday)

  const cap = vaultCap(s.vaultLevel)
  const paid = mode === 'paid' || freeRemaining <= 0
  if (!paid && freeRemaining <= 0)
    throw createError({ statusCode: 400, statusMessage: 'No free opens remaining today' })

  // Charge / consume up-front so a roll is never granted for free.
  if (paid) {
    const price = lootboxOpenPrice(cap)
    // debit throws 400 if the user can't afford it
    await debit(userId, price.toFixed(4), 'lootbox')
  } else {
    await db
      .update(minerState)
      .set({ lootboxTodayOpens: opensToday + 1, lootboxOpensDate: today })
      .where(eq(minerState.userId, userId))
  }

  // Roll and pay out. Rig Overclock boosts all lootbox rewards.
  const reward = lootboxRoll()
  const cashValue = lootboxRewardValue(reward, cap) * overclockMultiplier(s.overclockLevel)
  await credit(userId, cashValue.toFixed(4), 'lootbox')

  return {
    wonId: reward.id,
    rarity: reward.rarity,
    cashValue,
    paid,
    freeOpensRemaining: paid ? freeRemaining : freeRemaining - 1
  }
})
