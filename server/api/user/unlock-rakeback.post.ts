import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { RAKEBACK_UNLOCK_COST } from '#shared/utils/profile'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const current = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { gems: true, rakebackUnlocked: true },
  })

  if (current?.rakebackUnlocked) throw createError({ statusCode: 400, statusMessage: 'Already unlocked' })
  if ((current?.gems ?? 0) < RAKEBACK_UNLOCK_COST) {
    throw createError({ statusCode: 400, statusMessage: `Need ${RAKEBACK_UNLOCK_COST} gems` })
  }

  await db.transaction(async (tx) => {
    // Winning the unlock flip is what licenses the spend — otherwise two
    // concurrent calls both charge for the one unlock.
    const [unlocked] = await tx.update(user)
      .set({ rakebackUnlocked: true })
      .where(and(eq(user.id, userId), eq(user.rakebackUnlocked, false)))
      .returning({ id: user.id })
    if (!unlocked) throw createError({ statusCode: 400, statusMessage: 'Already unlocked' })

    await debitGems(userId, RAKEBACK_UNLOCK_COST, tx)
  })

  return { unlocked: true, gemsSpent: RAKEBACK_UNLOCK_COST }
})
