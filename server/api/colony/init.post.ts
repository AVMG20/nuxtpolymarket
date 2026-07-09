import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { ensureColonyState, addBug } from '#server/utils/colony'
import { rollStartLevel } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  await ensureColonyState(userId)

  const existing = await db.query.colonyBugs.findMany({ where: eq(colonyBugs.userId, userId) })
  if (existing.length === 0) {
    // starters are placed directly so the terrarium isn't empty on day one
    await addBug(userId, 'larva', rollStartLevel(), rollStartLevel(), rollStartLevel(), true)
    await addBug(userId, 'larva', rollStartLevel(), rollStartLevel(), rollStartLevel(), true)
    await addBug(userId, 'grub', rollStartLevel(), rollStartLevel(), rollStartLevel(), true)
  }

  return { ok: true }
})
