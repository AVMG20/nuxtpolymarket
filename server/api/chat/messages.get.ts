import { desc, eq, lt } from 'drizzle-orm'
import { db } from '#server/database'
import { chatMessages, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { CHAT_HISTORY_LIMIT } from '#shared/utils/chat'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // optional cursor: only messages older than this timestamp (a timestamp
  // cursor keeps working even if the cursor message itself gets deleted)
  const beforeParam = getQuery(event).before
  let before: Date | null = null
  if (typeof beforeParam === 'string' && beforeParam) {
    before = new Date(beforeParam)
    if (isNaN(before.getTime())) throw createError({ statusCode: 400, statusMessage: 'Invalid cursor' })
  }

  const rows = await db
    .select({
      id: chatMessages.id,
      userId: chatMessages.userId,
      name: user.name,
      emblem: user.emblem,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt
    })
    .from(chatMessages)
    .innerJoin(user, eq(chatMessages.userId, user.id))
    .where(before ? lt(chatMessages.createdAt, before) : undefined)
    .orderBy(desc(chatMessages.createdAt))
    .limit(CHAT_HISTORY_LIMIT)

  // oldest first for display
  return rows.reverse()
})
