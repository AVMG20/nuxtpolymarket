import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getUserGems } from '#server/utils/colony'
import { credit } from '#server/utils/balance'
import { canReleaseBug, getBug, releaseRefund, type ColonyBugStack } from '#shared/utils/colony'

const MAX_STACKS = 200

/**
 * Release spare bugs straight from the inventory, any number of stacks at
 * once, for the same half-spawn-cost refund as releasing a placed bug. Spare
 * bugs aren't foraging, so there's no partial cycle to pay out.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ stacks?: ColonyBugStack[] }>(event)
  const userId = await requireUserId(event)

  const stacks = Array.isArray(body?.stacks) ? body.stacks : []
  if (!stacks.length || stacks.length > MAX_STACKS) throw createError({ statusCode: 400, statusMessage: 'Pick the bugs to release' })
  for (const s of stacks) {
    const counts = [s?.speed, s?.yield, s?.eat, s?.quantity]
    if (typeof s?.typeId !== 'string' || !counts.every(Number.isInteger) || s.quantity < 1) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid bug stack' })
    }
    const type = getBug(s.typeId)
    if (!type) throw createError({ statusCode: 400, statusMessage: `Unknown bug: ${s.typeId}` })
    if (!canReleaseBug(s.typeId)) throw createError({ statusCode: 400, statusMessage: `A ${type.name} cannot be released` })
  }

  return db.transaction(async (tx) => {
    let released = 0
    let refund = 0
    for (const s of stacks) {
      // Deleting is the claim: a parallel release, or a place that moved one
      // of these bugs into the terrarium, leaves fewer rows for this DELETE to
      // take, and only the rows it actually removed are refunded.
      const spare = and(
        eq(colonyBugs.userId, userId),
        eq(colonyBugs.typeId, s.typeId),
        eq(colonyBugs.speed, s.speed),
        eq(colonyBugs.yield, s.yield),
        eq(colonyBugs.eat, s.eat),
        eq(colonyBugs.inTerrarium, false)
      )
      const picked = tx.select({ id: colonyBugs.id }).from(colonyBugs).where(spare).limit(s.quantity)
      const deleted = await tx.delete(colonyBugs)
        .where(and(spare, inArray(colonyBugs.id, picked)))
        .returning({ id: colonyBugs.id })
      released += deleted.length
      refund += releaseRefund(s.typeId, deleted.length)
    }
    if (!released) throw createError({ statusCode: 400, statusMessage: 'Those bugs are already gone' })

    const balance = refund > 0 ? await credit(userId, refund.toFixed(4), 'colony', tx) : undefined
    return { ok: true, released, refund, balance, gems: await getUserGems(userId, tx) }
  })
})
