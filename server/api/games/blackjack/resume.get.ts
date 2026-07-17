import { eq } from 'drizzle-orm'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { toClientState } from '#shared/utils/gamelogic/blackjack'
import type { BlackjackState } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const rows = await db.select().from(blackjackSessions).where(eq(blackjackSessions.userId, userId)).limit(1)

  if (rows.length === 0) {
    return { active: false, clientState: null, balance: parseFloat(await getBalance(userId)) }
  }

  const row = rows[0]!
  const state = row.state as BlackjackState

  return {
    active: true,
    clientState: toClientState(state),
    balance: parseFloat(await getBalance(userId)),
  }
})
