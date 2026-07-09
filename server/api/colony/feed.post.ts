import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony } from '#server/utils/colony'
import { debit } from '#server/utils/balance'
import { FEED_COST } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  await settleColony(userId)
  await debit(userId, FEED_COST.toFixed(4), 'colony:feed')
  await db.update(colonyState).set({ nutrition: 100 }).where(eq(colonyState.userId, userId))

  return { ok: true }
})
