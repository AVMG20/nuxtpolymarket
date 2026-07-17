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

  // Deleting the loot rows is the claim: two concurrent collects both try to
  // delete, but only one gets the rows back from RETURNING and credits them —
  // the other sees an empty result and grants nothing.
  const collected = await db.transaction(async (tx) => {
    const claimed = await tx.delete(colonyLoot)
      .where(eq(colonyLoot.userId, userId))
      .returning({ itemTypeId: colonyLoot.itemTypeId, quantity: colonyLoot.quantity })
    const withLoot = claimed.filter(l => l.quantity > 0)
    for (const row of withLoot) {
      await creditItems(userId, row.itemTypeId, row.quantity, tx)
    }
    return withLoot
  })

  return {
    ok: true,
    collected: collected.map((row) => {
      const type = getItem(row.itemTypeId)
      return { itemTypeId: row.itemTypeId, name: type?.name ?? row.itemTypeId, emoji: type?.emoji ?? '❓', quantity: row.quantity }
    })
  }
})
