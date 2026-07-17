import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { chatMentions } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const body = await readBody<{ messageId?: unknown }>(event)
  const messageId = typeof body?.messageId === 'string' ? body.messageId : ''
  if (!messageId) throw createError({ statusCode: 400, statusMessage: 'messageId required' })

  await db
    .update(chatMentions)
    .set({ seen: true })
    .where(and(eq(chatMentions.userId, userId), eq(chatMentions.messageId, messageId)))

  return { ok: true }
})
