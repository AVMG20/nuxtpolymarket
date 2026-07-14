import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony, getUpgradeLevels, countPlacedBugs } from '#server/utils/colony'
import { deriveCapacity } from '#shared/utils/colony'

/** Move one bug matching {typeId, speed, yield, eat} from inventory into the terrarium. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string, speed: number, yield: number, eat: number }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  await settleColony(userId)

  const [levels, placedCount] = await Promise.all([
    getUpgradeLevels(userId),
    countPlacedBugs(userId)
  ])
  if (placedCount >= deriveCapacity(levels)) throw createError({ statusCode: 400, statusMessage: 'Terrarium is at capacity' })

  const bug = await db.query.colonyBugs.findFirst({
    where: and(
      eq(colonyBugs.userId, userId),
      eq(colonyBugs.typeId, body.typeId),
      eq(colonyBugs.speed, body.speed),
      eq(colonyBugs.yield, body.yield),
      eq(colonyBugs.eat, body.eat),
      eq(colonyBugs.inTerrarium, false)
    )
  })
  if (!bug) throw createError({ statusCode: 404, statusMessage: 'No matching bug in your inventory' })

  await db.update(colonyBugs).set({ inTerrarium: true, tickProgressMs: 0 }).where(eq(colonyBugs.id, bug.id))

  return { ok: true }
})
