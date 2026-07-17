import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { effectiveRigIncome, vaultCap, rigUpgradeCost, computePending, RIG_MAX_LEVEL } from '#shared/utils/miner-config'
import { credit, debit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  return db.transaction(async (tx) => {
    // The row lock serialises upgrades against each other and against /miner/collect,
    // so the pending cash reset by this upgrade can only ever be banked once.
    const [s] = await tx.select().from(minerState).where(eq(minerState.userId, userId)).for('update')
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
    if (s.rigLevel >= RIG_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Rig is at max level' })

    const cost = rigUpgradeCost(s.rigLevel)

    // Collect pending cash at current rate, then reset timer and upgrade
    const pending = computePending(effectiveRigIncome(s.rigLevel, s.overclockLevel), s.lastCollectedAt, vaultCap(s.vaultLevel))
    const collected = Math.floor(pending * 100) / 100

    await tx.update(minerState)
      .set({ rigLevel: s.rigLevel + 1, lastCollectedAt: new Date() })
      .where(eq(minerState.userId, userId))
    await debit(userId, cost.toFixed(4), 'miner', tx)
    if (collected >= 0.01) await credit(userId, collected.toFixed(4), 'miner', tx)

    return { newLevel: s.rigLevel + 1, collected }
  })
})
