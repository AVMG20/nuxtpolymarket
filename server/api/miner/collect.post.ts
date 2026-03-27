import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { rigIncome, vaultCap, computePending } from '#shared/utils/miner-config'
import { credit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const s = await db.query.minerState.findFirst({ where: eq(minerState.userId, userId) })
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

  const pending = computePending(rigIncome(s.rigLevel), s.lastCollectedAt, vaultCap(s.vaultLevel))
  const amount = Math.floor(pending * 100) / 100

  if (amount < 0.01) throw createError({ statusCode: 400, statusMessage: 'Nothing to collect yet' })

  await db.update(minerState).set({ lastCollectedAt: new Date() }).where(eq(minerState.userId, userId))
  await credit(userId, amount.toFixed(4), 'miner')

  return { collected: amount }
})
