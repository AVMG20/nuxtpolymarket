import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony } from '#server/utils/colony'

/** Move one placed bug back into inventory (stops it foraging, frees a terrarium slot). */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ bugId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  await settleColony(userId)

  const bug = await db.query.colonyBugs.findFirst({
    where: and(eq(colonyBugs.id, body.bugId), eq(colonyBugs.userId, userId), eq(colonyBugs.inTerrarium, true))
  })
  if (!bug) throw createError({ statusCode: 404, statusMessage: 'Bug not found in terrarium' })

  await db.update(colonyBugs).set({ inTerrarium: false }).where(eq(colonyBugs.id, bug.id))

  return { ok: true }
})
