import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { chatMentions } from '#server/database/schema'
import { auth } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody<{ messageId?: unknown }>(event)
  const messageId = typeof body?.messageId === 'string' ? body.messageId : ''
  if (!messageId) throw createError({ statusCode: 400, statusMessage: 'messageId required' })

  await db
    .update(chatMentions)
    .set({ seen: true })
    .where(and(eq(chatMentions.userId, session.user.id), eq(chatMentions.messageId, messageId)))

  return { ok: true }
})
