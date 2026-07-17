import { and, asc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { chatMentions } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

// Unseen @mentions for the current user, oldest first.
export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db
    .select({ messageId: chatMentions.messageId, createdAt: chatMentions.createdAt })
    .from(chatMentions)
    .where(and(eq(chatMentions.userId, userId), eq(chatMentions.seen, false)))
    .orderBy(asc(chatMentions.createdAt))
})
