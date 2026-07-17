import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { effectiveFactoryRate, factoryCap, factoryUpgradeCost, computePending, FACTORY_MAX_LEVEL } from '#shared/utils/miner-config'
import { creditGems, debit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(minerState).where(eq(minerState.userId, userId)).for('update')
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
    if (s.factoryLevel >= FACTORY_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Factory is at max level' })

    const cost = factoryUpgradeCost(s.factoryLevel)

    // Collect whole gems pending before upgrading, reset timer
    const pending = computePending(effectiveFactoryRate(s.factoryLevel, s.catalystLevel), s.factoryLastCollectedAt, factoryCap(s.factoryLevel))
    const collectedGems = Math.floor(pending)

    await tx.update(minerState)
      .set({ factoryLevel: s.factoryLevel + 1, factoryLastCollectedAt: new Date() })
      .where(eq(minerState.userId, userId))
    await debit(userId, cost.toFixed(4), 'gems', tx)
    if (collectedGems >= 1) await creditGems(userId, collectedGems, tx)

    return { newLevel: s.factoryLevel + 1, collectedGems }
  })
})
