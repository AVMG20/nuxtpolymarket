import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyState, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { settleColony, getUpgradeLevels } from '#server/utils/colony'
import { debit } from '#server/utils/balance'
import { deriveNutritionMax, FEED_COST_PER_POINT, gemFeedCost } from '#shared/utils/colony'

/**
 * Refill the nutrition tank to its (upgrade-derived) max. Two payment
 * methods share the same tank: gems buy premium nutrition that always
 * drains first and grants a colony-wide +1 yield / +20% speed buff while
 * any remains (see settleColony), coins buy the regular kind. Either way
 * this tops up whatever headroom is left after both pools.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ method?: 'coins' | 'gems' }>(event)
  const method = body?.method === 'gems' ? 'gems' : 'coins'

  const userId = await requireUserId(event)

  const state = await settleColony(userId)
  const levels = await getUpgradeLevels(userId)
  const max = deriveNutritionMax(levels)

  const missing = max - state.nutrition - state.gemNutrition
  if (missing <= 0) throw createError({ statusCode: 400, statusMessage: 'Nutrition is already full' })

  if (method === 'gems') {
    const cost = gemFeedCost(missing, max)
    await db.transaction(async (tx) => {
      const [currentUser] = await tx.select({ gems: user.gems }).from(user).where(eq(user.id, userId)).for('update')
      if (!currentUser || currentUser.gems < cost) {
        throw createError({ statusCode: 400, statusMessage: `Not enough gems (need ${cost})` })
      }
      await tx.update(user).set({ gems: sql`${user.gems} - ${cost}` }).where(eq(user.id, userId))
      await tx.update(colonyState).set({ gemNutrition: state.gemNutrition + missing }).where(eq(colonyState.userId, userId))
    })
    return { ok: true, method, cost, nutrition: state.nutrition, gemNutrition: state.gemNutrition + missing }
  }

  const cost = missing * FEED_COST_PER_POINT
  await debit(userId, cost.toFixed(4), 'colony')
  await db.update(colonyState).set({ nutrition: state.nutrition + missing }).where(eq(colonyState.userId, userId))

  return { ok: true, method, cost, nutrition: state.nutrition + missing, gemNutrition: state.gemNutrition }
})
