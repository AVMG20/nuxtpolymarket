import { getQuery } from 'h3'
import { auth } from '#server/utils/auth'
import { getBankHistory } from '#server/utils/bank'

const PAGE_SIZE = 8

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const rawOffset = Number(getQuery(event).offset ?? 0)
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? Math.min(rawOffset, 1_000) : 0
  const rows = await getBankHistory(session.user.id, PAGE_SIZE + 1, offset)

  return {
    items: rows.slice(0, PAGE_SIZE),
    hasMore: rows.length > PAGE_SIZE
  }
})
