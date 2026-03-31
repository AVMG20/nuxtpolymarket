import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { factoryRate, factoryCap, factoryUpgradeCost, computePending, FACTORY_MAX_LEVEL } from '#shared/utils/miner-config'
import { debit, getBalance } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [balance, s] = await Promise.all([
    getBalance(userId),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
  ])

  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
  if (s.factoryLevel >= FACTORY_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Factory is at max level' })

  const cost = factoryUpgradeCost(s.factoryLevel)
  if (parseFloat(balance) < cost) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })

  // Collect whole gems pending before upgrading, reset timer
  const pending = computePending(factoryRate(s.factoryLevel), s.factoryLastCollectedAt, factoryCap(s.factoryLevel))
  const collectedGems = Math.floor(pending)

  await db.update(minerState).set({ factoryLevel: s.factoryLevel + 1, factoryLastCollectedAt: new Date() }).where(eq(minerState.userId, userId))
  await debit(userId, cost.toFixed(4), 'gems')
  if (collectedGems >= 1) {
    await db.update(user).set({ gems: sql`${user.gems} + ${collectedGems}` }).where(eq(user.id, userId))
  }

  return { newLevel: s.factoryLevel + 1, collectedGems }
})
