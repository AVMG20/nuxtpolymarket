import { eq } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { toClientState } from '#shared/utils/gamelogic/blackjack'
import type { BlackjackState } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const rows = await db.select().from(blackjackSessions).where(eq(blackjackSessions.userId, session.user.id)).limit(1)

  if (rows.length === 0) {
    return { active: false, clientState: null, token: null, balance: parseFloat(await getBalance(session.user.id)) }
  }

  const row = rows[0]!
  const state = row.state as BlackjackState

  return {
    active: true,
    clientState: toClientState(state),
    token: row.token,
    balance: parseFloat(await getBalance(session.user.id)),
  }
})
