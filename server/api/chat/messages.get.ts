import { desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { chatMessages, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { CHAT_HISTORY_LIMIT } from '#shared/utils/chat'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const rows = await db
    .select({
      id: chatMessages.id,
      userId: chatMessages.userId,
      name: user.name,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt
    })
    .from(chatMessages)
    .innerJoin(user, eq(chatMessages.userId, user.id))
    .orderBy(desc(chatMessages.createdAt))
    .limit(CHAT_HISTORY_LIMIT)

  // oldest first for display
  return rows.reverse()
})
