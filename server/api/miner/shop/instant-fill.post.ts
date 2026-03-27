import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { vaultCap, rigIncome, instantFillCost } from '#shared/utils/miner-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [currentUser, s] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
    db.query.minerState.findFirst({ where: eq(minerState.userId, userId) }),
  ])

  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

  // Calculate gem cost
  const cost = instantFillCost(s.vaultLevel)

  if ((currentUser?.gems ?? 0) < cost) {
    throw createError({ statusCode: 400, statusMessage: `Need ${cost} gems` })
  }

  const cap = vaultCap(s.vaultLevel)
  const income = rigIncome(s.rigLevel)
  // Set lastCollectedAt far enough in the past that computePending returns cap
  const lastCollectedAt = new Date(Date.now() - (cap / income) * 86_400_000)

  await db.update(user).set({ gems: sql`${user.gems} - ${cost}` }).where(eq(user.id, userId))
  await db.update(minerState).set({ lastCollectedAt }).where(eq(minerState.userId, userId))

  return { gemsSpent: cost }
})
