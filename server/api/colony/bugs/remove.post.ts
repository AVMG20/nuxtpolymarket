import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBugs } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { settleColony, creditPartialTick, getUserGems } from '#server/utils/colony'
import { credit } from '#server/utils/balance'
import { getBug, REMOVE_REFUND_RATE } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ bugId: string }>(event)
  const userId = await requireUserId(event)

  // Brings tickProgressMs up to date so the partial-tick credit below is accurate.
  await settleColony(userId)

  const bug = await db.query.colonyBugs.findFirst({
    where: and(eq(colonyBugs.id, body.bugId), eq(colonyBugs.userId, userId))
  })
  if (!bug) throw createError({ statusCode: 404, statusMessage: 'Bug not found' })

  const type = getBug(bug.typeId)
  // Prestige-only species are granted, never bought, so their spawnCost is a
  // notional figure nobody ever paid — refunding half of it turns the grant
  // into a coin printer (five Hive Snails off one token liquidate for 10M
  // without ever running the gem loop). They stay in the colony for the run.
  if (type?.prestigeOnly) throw createError({ statusCode: 400, statusMessage: `A ${type.name} cannot be released` })

  const refund = (type?.spawnCost ?? 0) * REMOVE_REFUND_RATE

  // Deleting the bug is the claim: two releases racing on the same bug both
  // read it above, but only one DELETE returns the row, so only one of them
  // pays the partial cycle and the refund.
  const [claimed] = await db.delete(colonyBugs)
    .where(and(eq(colonyBugs.id, bug.id), eq(colonyBugs.userId, userId)))
    .returning()
  if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Bug already released' })

  // Releasing a bug stops it immediately — credit whatever fraction of its
  // current cycle it already made instead of just discarding that progress.
  await creditPartialTick(userId, claimed, true)

  const balance = refund > 0 ? await credit(userId, refund.toFixed(4), 'colony') : undefined

  return { ok: true, balance, gems: await getUserGems(userId) }
})
