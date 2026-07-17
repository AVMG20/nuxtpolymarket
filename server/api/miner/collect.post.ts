import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { effectiveRigIncome, vaultCap, computePending } from '#shared/utils/miner-config'
import { credit } from '#server/utils/balance'
import { getLockedMinerState } from '#server/utils/miner'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction(async (tx) => {
    // The row lock serializes collectors: the loser reads lastCollectedAt only after
    // the winner has moved it forward, so its pending recomputes to ~0.
    const s = await getLockedMinerState(tx, userId)

    const pending = computePending(effectiveRigIncome(s.rigLevel, s.overclockLevel), s.lastCollectedAt, vaultCap(s.vaultLevel))
    const amount = Math.floor(pending * 100) / 100

    if (amount < 0.01) throw createError({ statusCode: 400, statusMessage: 'Nothing to collect yet' })

    await tx.update(minerState).set({ lastCollectedAt: new Date() }).where(eq(minerState.userId, userId))
    await credit(userId, amount.toFixed(4), 'miner', tx)

    return { collected: amount }
  })
})
