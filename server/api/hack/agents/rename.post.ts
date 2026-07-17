import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { agentId, name } = await readBody(event) as { agentId: string; name: string }

  const trimmed = (name ?? '').trim().slice(0, 24)
  if (!trimmed) throw createError({ statusCode: 400, statusMessage: 'Name cannot be empty' })

  const agent = await db.query.hackAgents.findFirst({ where: and(eq(hackAgents.id, agentId), eq(hackAgents.userId, userId)) })
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'Agent not found' })

  await db.update(hackAgents).set({ name: trimmed }).where(eq(hackAgents.id, agentId))
  return { name: trimmed }
})
