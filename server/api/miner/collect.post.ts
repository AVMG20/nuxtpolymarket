import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { minerState } from '../../database/schema'
import { auth } from '../../utils/auth'
import { rigIncome, vaultCap, computePending } from './_config'
import { credit } from '../../utils/balance'

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
