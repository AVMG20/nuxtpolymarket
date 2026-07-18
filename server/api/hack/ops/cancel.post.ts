import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackOps } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { opId } = await readBody(event) as { opId: string }

  // The delete is its own guard: it only removes an uncollected op, so a concurrent
  // collect (which flips `collected`) and a double-cancel both fall through to the
  // 400 rather than racing. Dispatch is free, so there's nothing to refund — the op
  // just vanishes and its agents free up.
  const [cancelled] = await db.delete(hackOps)
    .where(and(eq(hackOps.id, opId), eq(hackOps.userId, userId), eq(hackOps.collected, false)))
    .returning({ id: hackOps.id })
  if (!cancelled) throw createError({ statusCode: 400, statusMessage: 'Op not found or already resolved' })

  return { cancelled: true }
})
