import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { factoryRate, factoryCap, computePending } from './_config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const s = await db.query.minerState.findFirst({ where: eq(minerState.userId, userId) })
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

  const pending = computePending(factoryRate(s.factoryLevel), s.factoryLastCollectedAt, factoryCap(s.factoryLevel))
  const collected = Math.floor(pending) // whole gems only

  if (collected < 1) throw createError({ statusCode: 400, statusMessage: 'Not enough gems to collect yet' })

  await db.transaction(async (tx) => {
    // Reset factory timer; fractional remainder is lost (floor)
    await tx.update(minerState).set({ factoryLastCollectedAt: new Date() }).where(eq(minerState.userId, userId))
    await tx.update(user).set({ gems: sql`${user.gems} + ${collected}` }).where(eq(user.id, userId))
  })

  return { collected }
})
