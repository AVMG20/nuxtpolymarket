import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { minesUpgradeCost, MINES_UPGRADE_MAX_LEVEL } from '#shared/utils/miner-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const s = await db.query.minerState.findFirst({ where: eq(minerState.userId, userId) })
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

  if (s.minesLevel >= MINES_UPGRADE_MAX_LEVEL)
    throw createError({ statusCode: 400, statusMessage: 'Maximum upgrade level reached' })

  const cost = minesUpgradeCost(s.minesLevel)
  await debit(userId, cost.toFixed(4), 'mines')

  const [updated] = await db
    .update(minerState)
    .set({ minesLevel: s.minesLevel + 1 })
    .where(eq(minerState.userId, userId))
    .returning({ minesLevel: minerState.minesLevel })

  return { newLevel: updated!.minesLevel }
})
