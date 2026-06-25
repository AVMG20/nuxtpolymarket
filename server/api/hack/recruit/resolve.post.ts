import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackItems, hackOps, hackState } from '#server/database/schema'
import { auth } from '#server/utils/auth'

// Resolve a pending overflow recruit: `discard` the newcomer, `replace` an existing
// roster agent with it (firing the replaced agent), or `keep` it if a roster slot
// has since freed up.
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const { agentId, action, replaceId } = await readBody(event) as {
    agentId: string
    action: 'discard' | 'replace' | 'keep'
    replaceId?: string
  }

  const pending = await db.query.hackAgents.findFirst({
    where: and(eq(hackAgents.id, agentId), eq(hackAgents.userId, userId)),
  })
  if (!pending) throw createError({ statusCode: 404, statusMessage: 'Recruit not found' })
  if (!pending.pending) throw createError({ statusCode: 400, statusMessage: 'This recruit is already on your roster' })

  if (action === 'keep') {
    // Only valid if a roster slot freed up after the recruit became pending.
    const [state, agents] = await Promise.all([
      db.query.hackState.findFirst({ where: eq(hackState.userId, userId) }),
      db.query.hackAgents.findMany({ where: eq(hackAgents.userId, userId) }),
    ])
    const rosterCount = agents.filter(a => !a.pending).length
    if (!state || rosterCount >= state.rosterSlots)
      throw createError({ statusCode: 400, statusMessage: 'Roster is full — replace an agent or discard.' })
    await db.update(hackAgents).set({ pending: false }).where(eq(hackAgents.id, agentId))
    return { resolved: 'kept' }
  }

  if (action === 'discard') {
    // A pending agent has no gear, but unequip defensively before deleting.
    await db.update(hackItems).set({ equippedBy: null })
      .where(and(eq(hackItems.userId, userId), eq(hackItems.equippedBy, agentId)))
    await db.delete(hackAgents).where(eq(hackAgents.id, agentId))
    return { resolved: 'discarded' }
  }

  if (action === 'replace') {
    if (!replaceId) throw createError({ statusCode: 400, statusMessage: 'No agent selected to replace' })
    if (replaceId === agentId) throw createError({ statusCode: 400, statusMessage: 'Cannot replace an agent with itself' })

    const [target, activeOps] = await Promise.all([
      db.query.hackAgents.findFirst({ where: and(eq(hackAgents.id, replaceId), eq(hackAgents.userId, userId)) }),
      db.query.hackOps.findMany({ where: and(eq(hackOps.userId, userId), eq(hackOps.collected, false)) }),
    ])
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Agent to replace not found' })
    if (target.pending) throw createError({ statusCode: 400, statusMessage: 'Cannot replace a pending agent' })

    const onOp = activeOps.some(op => (op.agentIds as string[]).includes(replaceId))
    if (onOp) throw createError({ statusCode: 400, statusMessage: 'Cannot replace an agent currently on an op' })

    // Fire the replaced agent (free their gear back to inventory), then promote
    // the newcomer onto the roster.
    await db.update(hackItems).set({ equippedBy: null })
      .where(and(eq(hackItems.userId, userId), eq(hackItems.equippedBy, replaceId)))
    await db.delete(hackAgents).where(eq(hackAgents.id, replaceId))
    await db.update(hackAgents).set({ pending: false }).where(eq(hackAgents.id, agentId))

    return { resolved: 'replaced', replacedId: replaceId }
  }

  throw createError({ statusCode: 400, statusMessage: 'Unknown action' })
})
