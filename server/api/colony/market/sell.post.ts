import { eq, and, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyItems } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getItem } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ itemTypeId: string, quantity?: number }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const type = getItem(body.itemTypeId)
  if (!type) throw createError({ statusCode: 400, statusMessage: `Unknown item: ${body.itemTypeId}` })

  const owned = await db.query.colonyItems.findFirst({
    where: and(eq(colonyItems.userId, userId), eq(colonyItems.itemTypeId, body.itemTypeId))
  })
  const have = owned?.quantity ?? 0
  const quantity = body.quantity && body.quantity > 0 ? Math.min(body.quantity, have) : have
  if (quantity <= 0) throw createError({ statusCode: 400, statusMessage: `No ${type.name} to sell` })

  await db.update(colonyItems)
    .set({ quantity: sql`${colonyItems.quantity} - ${quantity}` })
    .where(and(eq(colonyItems.userId, userId), eq(colonyItems.itemTypeId, body.itemTypeId)))

  const coins = quantity * type.sellValue
  await credit(userId, coins.toFixed(4), 'colony')

  return { ok: true, coins, quantity, itemTypeId: type.id }
})
