import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackOps } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

// Flip auto-redeploy on a running op. Only an uncollected op can be changed —
// collect reads the flag inside its own claim, so a toggle that lands after the
// claim simply matches nothing and returns 400.
export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { opId, enabled } = await readBody(event) as { opId: string; enabled: unknown }
  if (typeof opId !== 'string' || typeof enabled !== 'boolean')
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })

  const [updated] = await db.update(hackOps)
    .set({ autoRedeploy: enabled })
    .where(and(eq(hackOps.id, opId), eq(hackOps.userId, userId), eq(hackOps.collected, false)))
    .returning({ id: hackOps.id, autoRedeploy: hackOps.autoRedeploy })
  if (!updated) throw createError({ statusCode: 400, statusMessage: 'Op not found or already resolved' })

  return { autoRedeploy: updated.autoRedeploy }
})
