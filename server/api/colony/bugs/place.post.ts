import { eq, and, count } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs, colonyState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { settleColony, getUpgradeLevels, getUserGems } from '#server/utils/colony'
import { deriveCapacity } from '#shared/utils/colony'

/** Move one bug matching {typeId, speed, yield, eat} from inventory into the terrarium. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string, speed: number, yield: number, eat: number }>(event)
  const userId = await requireUserId(event)

  await settleColony(userId)
  const capacity = deriveCapacity(await getUpgradeLevels(userId))

  return db.transaction(async (tx) => {
    // Lock-then-read: the client places optimistically, so several places can
    // be in flight at once. Without the colony row lock they would all count
    // the same placed total and push the terrarium past its capacity.
    await tx.select({ userId: colonyState.userId }).from(colonyState).where(eq(colonyState.userId, userId)).for('update')

    const [placed] = await tx.select({ n: count() }).from(colonyBugs)
      .where(and(eq(colonyBugs.userId, userId), eq(colonyBugs.inTerrarium, true)))
    if ((placed?.n ?? 0) >= capacity) throw createError({ statusCode: 400, statusMessage: 'Terrarium is at capacity' })

    const [bug] = await tx.select({ id: colonyBugs.id }).from(colonyBugs)
      .where(and(
        eq(colonyBugs.userId, userId),
        eq(colonyBugs.typeId, body.typeId),
        eq(colonyBugs.speed, body.speed),
        eq(colonyBugs.yield, body.yield),
        eq(colonyBugs.eat, body.eat),
        eq(colonyBugs.inTerrarium, false)
      ))
      .limit(1)
    if (!bug) throw createError({ statusCode: 404, statusMessage: 'No matching bug in your inventory' })

    await tx.update(colonyBugs).set({ inTerrarium: true, tickProgressMs: 0 }).where(eq(colonyBugs.id, bug.id))

    return { ok: true, bugId: bug.id, gems: await getUserGems(userId, tx) }
  })
})
