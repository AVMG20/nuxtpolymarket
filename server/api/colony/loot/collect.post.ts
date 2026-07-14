import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyLoot } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony, creditItems } from '#server/utils/colony'
import { getItem } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  await settleColony(userId)

  const loot = await db.query.colonyLoot.findMany({ where: eq(colonyLoot.userId, userId) })
  const collected = loot.filter(l => l.quantity > 0)

  for (const row of collected) {
    await creditItems(userId, row.itemTypeId, row.quantity)
  }
  await db.delete(colonyLoot).where(eq(colonyLoot.userId, userId))

  return {
    ok: true,
    collected: collected.map((row) => {
      const type = getItem(row.itemTypeId)
      return { itemTypeId: row.itemTypeId, name: type?.name ?? row.itemTypeId, emoji: type?.emoji ?? '❓', quantity: row.quantity }
    })
  }
})
