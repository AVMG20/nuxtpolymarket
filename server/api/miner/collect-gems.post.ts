import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { creditGems } from '#server/utils/balance'
import { effectiveFactoryRate, factoryCap, computePending } from '#shared/utils/miner-config'
import { getLockedMinerState } from '#server/utils/miner'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction(async (tx) => {
    // The row lock serialises collectors: the loser recomputes pending from the
    // timer the winner already moved forward, so it sees ~0 and takes the 400.
    const s = await getLockedMinerState(tx, userId)

    const pending = computePending(effectiveFactoryRate(s.factoryLevel, s.catalystLevel), s.factoryLastCollectedAt, factoryCap(s.factoryLevel))
    const collected = Math.floor(pending) // whole gems only

    if (collected < 1) throw createError({ statusCode: 400, statusMessage: 'Not enough gems to collect yet' })

    // Reset factory timer; fractional remainder is lost (floor)
    await tx.update(minerState).set({ factoryLastCollectedAt: new Date() }).where(eq(minerState.userId, userId))
    await creditGems(userId, collected, tx)

    return { collected }
  })
})
