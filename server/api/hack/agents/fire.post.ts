import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackItems, hackOps } from '#server/database/schema'
import { auth } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const { agentId } = await readBody(event) as { agentId: string }

  const [agent, activeOps] = await Promise.all([
    db.query.hackAgents.findFirst({ where: and(eq(hackAgents.id, agentId), eq(hackAgents.userId, userId)) }),
    db.query.hackOps.findMany({ where: and(eq(hackOps.userId, userId), eq(hackOps.collected, false)) }),
  ])

  if (!agent) throw createError({ statusCode: 404, statusMessage: 'Agent not found' })

  const onOp = activeOps.some(op => (op.agentIds as string[]).includes(agentId))
  if (onOp) throw createError({ statusCode: 400, statusMessage: 'Cannot fire an agent currently on an op' })

  // Unequip all their items first
  await db.update(hackItems)
    .set({ equippedBy: null })
    .where(and(eq(hackItems.userId, userId), eq(hackItems.equippedBy, agentId)))

  await db.delete(hackAgents).where(eq(hackAgents.id, agentId))

  return { fired: true }
})
