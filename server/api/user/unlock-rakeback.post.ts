import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { RAKEBACK_UNLOCK_COST } from '#shared/utils/profile'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const current = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { gems: true, rakebackUnlocked: true },
  })

  if (current?.rakebackUnlocked) throw createError({ statusCode: 400, statusMessage: 'Already unlocked' })
  if ((current?.gems ?? 0) < RAKEBACK_UNLOCK_COST) {
    throw createError({ statusCode: 400, statusMessage: `Need ${RAKEBACK_UNLOCK_COST} gems` })
  }

  await db.update(user)
    .set({ gems: sql`${user.gems} - ${RAKEBACK_UNLOCK_COST}`, rakebackUnlocked: true })
    .where(eq(user.id, userId))

  return { unlocked: true, gemsSpent: RAKEBACK_UNLOCK_COST }
})
