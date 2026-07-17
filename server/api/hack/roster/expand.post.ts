import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { ROSTER_EXPAND_COSTS, MAX_ROSTER_SLOTS } from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  return db.transaction(async (tx) => {
    const state = await tx.query.hackState.findFirst({ where: eq(hackState.userId, userId) })
    if (!state) throw createError({ statusCode: 400, statusMessage: 'Hack ops not initialized' })
    if (state.rosterSlots >= MAX_ROSTER_SLOTS)
      throw createError({ statusCode: 400, statusMessage: 'Roster already at maximum' })

    const cost = ROSTER_EXPAND_COSTS[state.rosterSlots - 2]
    if (cost === undefined) throw createError({ statusCode: 400, statusMessage: 'Cannot expand further' })

    // CAS on the slot count is the mutex: only the request that finds it still at
    // the value it read wins the increment, so two concurrent expands can't both
    // pay for one slot.
    const [updated] = await tx.update(hackState)
      .set({ rosterSlots: state.rosterSlots + 1 })
      .where(and(eq(hackState.userId, userId), eq(hackState.rosterSlots, state.rosterSlots)))
      .returning()
    if (!updated) throw createError({ statusCode: 409, statusMessage: 'Roster changed, try again' })

    await debit(userId, cost.toFixed(4), 'HackOps', tx)

    return { rosterSlots: updated.rosterSlots }
  })
})
