import { and, asc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { chatMentions } from '#server/database/schema'
import { auth } from '#server/utils/auth'

// Unseen @mentions for the current user, oldest first.
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  return db
    .select({ messageId: chatMentions.messageId, createdAt: chatMentions.createdAt })
    .from(chatMentions)
    .where(and(eq(chatMentions.userId, session.user.id), eq(chatMentions.seen, false)))
    .orderBy(asc(chatMentions.createdAt))
})
