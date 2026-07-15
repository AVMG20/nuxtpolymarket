import { db } from '#server/database'
import { auth } from '#server/utils/auth'
import { bankSummary, getBankHistory, getLockedBankState, settleBankState } from '#server/utils/bank'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const state = await db.transaction(async (tx) => {
    const locked = await getLockedBankState(tx, session.user.id)
    return settleBankState(tx, locked)
  })
  const history = await getBankHistory(session.user.id, 1)
  return { ...bankSummary(state), serverNow: Date.now(), history: history.reverse() }
})
