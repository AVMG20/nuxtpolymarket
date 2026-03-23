import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { SHOP_QUICK_CASH_COST, SHOP_QUICK_CASH_AMOUNT } from '../_config'
import { credit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const currentUser = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } })

  if ((currentUser?.gems ?? 0) < SHOP_QUICK_CASH_COST) {
    throw createError({ statusCode: 400, statusMessage: `Need ${SHOP_QUICK_CASH_COST} gem` })
  }

  await db.update(user).set({ gems: sql`${user.gems} - ${SHOP_QUICK_CASH_COST}` }).where(eq(user.id, userId))
  await credit(userId, SHOP_QUICK_CASH_AMOUNT.toFixed(4), 'gems')

  return { credited: SHOP_QUICK_CASH_AMOUNT, gemsSpent: SHOP_QUICK_CASH_COST }
})
