import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackState, hackOps } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

// Activate (move to roster) or deactivate (move to storage) an agent. Only active
// agents count toward power and can be deployed on ops.
export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { agentId, active } = await readBody(event) as { agentId: string; active: boolean }

  const agent = await db.query.hackAgents.findFirst({
    where: and(eq(hackAgents.id, agentId), eq(hackAgents.userId, userId)),
  })
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
  if (agent.active === active) return { agent }

  if (active) {
    // Activating — must be a free slot in the active roster.
    const state = await db.query.hackState.findFirst({ where: eq(hackState.userId, userId) })
    if (!state) throw createError({ statusCode: 400, statusMessage: 'Hack ops not initialized' })
    const activeCount = (await db.query.hackAgents.findMany({
      where: and(eq(hackAgents.userId, userId), eq(hackAgents.active, true)),
    })).length
    if (activeCount >= state.rosterSlots)
      throw createError({ statusCode: 400, statusMessage: `Active roster full (${state.rosterSlots} slots). Deactivate or expand first.` })
  } else {
    // Deactivating — can't bench an agent that's currently on an op.
    const activeOps = await db.query.hackOps.findMany({
      where: and(eq(hackOps.userId, userId), eq(hackOps.collected, false)),
    })
    if (activeOps.some(op => (op.agentIds as string[]).includes(agentId)))
      throw createError({ statusCode: 400, statusMessage: 'Cannot bench an agent currently on an op' })
  }

  const [updated] = await db.update(hackAgents)
    .set({ active })
    .where(eq(hackAgents.id, agentId))
    .returning()
  return { agent: updated }
})
