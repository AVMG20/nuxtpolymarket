import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { vaultCap, SHOP_INSTANT_FILL_COST } from '../_config'
import { credit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [currentUser, s] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
  ])

  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
  if ((currentUser?.gems ?? 0) < SHOP_INSTANT_FILL_COST) {
    throw createError({ statusCode: 400, statusMessage: `Need ${SHOP_INSTANT_FILL_COST} gems` })
  }

  const cap = vaultCap(s.vaultLevel)
  const amount = Math.floor(cap * 100) / 100

  await db.update(user).set({ gems: sql`${user.gems} - ${SHOP_INSTANT_FILL_COST}` }).where(eq(user.id, userId))
  await db.update(minerState).set({ lastCollectedAt: new Date() }).where(eq(minerState.userId, userId))
  await credit(userId, amount.toFixed(4), 'miner:shop:instant-fill')

  return { credited: amount, gemsSpent: SHOP_INSTANT_FILL_COST }
})
