import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { effectiveRigIncome, vaultCap, vaultUpgradeCost, computePending, VAULT_MAX_LEVEL } from '#shared/utils/miner-config'
import { credit, debit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(minerState).where(eq(minerState.userId, userId)).for('update')
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
    if (s.vaultLevel >= VAULT_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Vault is at max level' })

    const cost = vaultUpgradeCost(s.vaultLevel)

    // Collect pending before expanding so the new cap isn't applied retroactively
    const pending = computePending(effectiveRigIncome(s.rigLevel, s.overclockLevel), s.lastCollectedAt, vaultCap(s.vaultLevel))
    const collected = Math.floor(pending * 100) / 100

    await tx.update(minerState)
      .set({ vaultLevel: s.vaultLevel + 1, lastCollectedAt: new Date() })
      .where(eq(minerState.userId, userId))
    await debit(userId, cost.toFixed(4), 'miner', tx)
    if (collected >= 0.01) await credit(userId, collected.toFixed(4), 'miner', tx)

    return { newLevel: s.vaultLevel + 1, collected }
  })
})
