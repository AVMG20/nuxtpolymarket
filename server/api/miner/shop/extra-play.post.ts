import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { SHOP_EXTRA_PLAY_COST } from '../_config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [currentUser, s] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
  ])

  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
  if ((currentUser?.gems ?? 0) < SHOP_EXTRA_PLAY_COST) {
    throw createError({ statusCode: 400, statusMessage: `Need ${SHOP_EXTRA_PLAY_COST} gem` })
  }

  await db.update(user).set({ gems: sql`${user.gems} - ${SHOP_EXTRA_PLAY_COST}` }).where(eq(user.id, userId))

  const today = new Date().toISOString().slice(0, 10)
  const playsToday = s.minesPlaysDate === today ? s.minesTodayPlays : 0
  const didRefund = playsToday >= 1

  if (didRefund) {
    await db.update(minerState).set({ minesTodayPlays: playsToday - 1 }).where(eq(minerState.userId, userId))
  }

  return { gemsSpent: SHOP_EXTRA_PLAY_COST, didRefund }
})
