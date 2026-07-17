import { getQuery } from 'h3'
import { requireUserId } from '#server/utils/auth'
import { getBankHistory } from '#server/utils/bank'

const PAGE_SIZE = 8

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const rawOffset = Number(getQuery(event).offset ?? 0)
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? Math.min(rawOffset, 1_000) : 0
  const rows = await getBankHistory(userId, PAGE_SIZE + 1, offset)

  return {
    items: rows.slice(0, PAGE_SIZE),
    hasMore: rows.length > PAGE_SIZE
  }
})
