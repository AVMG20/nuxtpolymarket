import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { ROSTER_EXPAND_COSTS, MAX_ROSTER_SLOTS } from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const state = await db.query.hackState.findFirst({ where: eq(hackState.userId, userId) })
  if (!state) throw createError({ statusCode: 400, statusMessage: 'Hack ops not initialized' })
  if (state.rosterSlots >= MAX_ROSTER_SLOTS)
    throw createError({ statusCode: 400, statusMessage: 'Roster already at maximum' })

  const cost = ROSTER_EXPAND_COSTS[state.rosterSlots - 2]
  if (cost === undefined) throw createError({ statusCode: 400, statusMessage: 'Cannot expand further' })

  await debit(userId, cost.toFixed(4), 'hack:roster')
  const [updated] = await db.update(hackState).set({ rosterSlots: state.rosterSlots + 1 }).where(eq(hackState.userId, userId)).returning()

  return { rosterSlots: updated!.rosterSlots }
})
