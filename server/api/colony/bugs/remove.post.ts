import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony } from '#server/utils/colony'
import { credit } from '#server/utils/balance'
import { getBug, REMOVE_REFUND_RATE } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ bugId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  await settleColony(userId)

  const bug = await db.query.colonyBugs.findFirst({
    where: and(eq(colonyBugs.id, body.bugId), eq(colonyBugs.userId, userId))
  })
  if (!bug) throw createError({ statusCode: 404, statusMessage: 'Bug not found' })

  const type = getBug(bug.typeId)
  const refund = (type?.spawnCost ?? 0) * REMOVE_REFUND_RATE

  await db.delete(colonyBugs).where(eq(colonyBugs.id, bug.id))
  if (refund > 0) await credit(userId, refund.toFixed(4), 'colony:remove-bug')

  return { ok: true }
})
