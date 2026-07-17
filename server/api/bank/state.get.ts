import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { bankSummary, getBankHistory, getLockedBankState, settleBankState } from '#server/utils/bank'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const state = await db.transaction(async (tx) => {
    const locked = await getLockedBankState(tx, userId)
    return settleBankState(tx, locked)
  })
  const history = await getBankHistory(userId, 1)
  return { ...bankSummary(state), serverNow: Date.now(), history: history.reverse() }
})
