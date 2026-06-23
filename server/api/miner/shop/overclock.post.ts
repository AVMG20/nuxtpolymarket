import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { overclockUpgradeCost, OVERCLOCK_MAX_LEVEL } from '#shared/utils/miner-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [currentUser, s] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId), columns: { overclockLevel: true } }),
  ])

  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
  if (s.overclockLevel >= OVERCLOCK_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Overclock is maxed' })

  const cost = overclockUpgradeCost(s.overclockLevel)!
  if ((currentUser?.gems ?? 0) < cost) throw createError({ statusCode: 400, statusMessage: `Need ${cost} gems` })

  await db.transaction(async (tx) => {
    await tx.update(user).set({ gems: sql`${user.gems} - ${cost}` }).where(eq(user.id, userId))
    await tx.update(minerState).set({ overclockLevel: s.overclockLevel + 1 }).where(eq(minerState.userId, userId))
  })

  return { newLevel: s.overclockLevel + 1, gemsSpent: cost }
})
