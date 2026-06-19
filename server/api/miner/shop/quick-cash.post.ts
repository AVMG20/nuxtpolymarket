import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { SHOP_QUICK_CASH_COST, quickCashAmount } from '#shared/utils/miner-config'
import { credit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [currentUser, s] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId), columns: { factoryLevel: true } }),
  ])

  if ((currentUser?.gems ?? 0) < SHOP_QUICK_CASH_COST) {
    throw createError({ statusCode: 400, statusMessage: `Need ${SHOP_QUICK_CASH_COST} gem` })
  }

  const amount = quickCashAmount(s?.factoryLevel ?? 1)

  await db.update(user).set({ gems: sql`${user.gems} - ${SHOP_QUICK_CASH_COST}` }).where(eq(user.id, userId))
  await credit(userId, amount.toFixed(4), 'gems')

  return { credited: amount, gemsSpent: SHOP_QUICK_CASH_COST }
})
