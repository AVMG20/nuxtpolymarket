import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { catalystUpgradeCost, CATALYST_MAX_LEVEL } from '#shared/utils/miner-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [currentUser, s] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId), columns: { catalystLevel: true } }),
  ])

  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
  if (s.catalystLevel >= CATALYST_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Catalyst is maxed' })

  const cost = catalystUpgradeCost(s.catalystLevel)!
  if ((currentUser?.gems ?? 0) < cost) throw createError({ statusCode: 400, statusMessage: `Need ${cost} gems` })

  await db.transaction(async (tx) => {
    const [upgraded] = await tx.update(minerState)
      .set({ catalystLevel: s.catalystLevel + 1 })
      .where(and(eq(minerState.userId, userId), eq(minerState.catalystLevel, s.catalystLevel)))
      .returning({ id: minerState.id })
    if (!upgraded) throw createError({ statusCode: 409, statusMessage: 'Miner state changed, try again' })

    await debitGems(userId, cost, tx)
  })

  return { newLevel: s.catalystLevel + 1, gemsSpent: cost }
})
