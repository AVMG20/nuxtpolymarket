import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { effectiveRigIncome, vaultCap, computePending } from '#shared/utils/miner-config'
import { credit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  return db.transaction(async (tx) => {
    // The row lock serializes collectors: the loser reads lastCollectedAt only after
    // the winner has moved it forward, so its pending recomputes to ~0.
    const [s] = await tx.select().from(minerState).where(eq(minerState.userId, userId)).for('update')
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

    const pending = computePending(effectiveRigIncome(s.rigLevel, s.overclockLevel), s.lastCollectedAt, vaultCap(s.vaultLevel))
    const amount = Math.floor(pending * 100) / 100

    if (amount < 0.01) throw createError({ statusCode: 400, statusMessage: 'Nothing to collect yet' })

    await tx.update(minerState).set({ lastCollectedAt: new Date() }).where(eq(minerState.userId, userId))
    await credit(userId, amount.toFixed(4), 'miner', tx)

    return { collected: amount }
  })
})
