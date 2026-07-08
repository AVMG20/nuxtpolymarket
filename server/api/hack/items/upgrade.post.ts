import { eq, and, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hackItems, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { ITEM_MAX_LEVEL, itemUpgradeCost } from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const { itemId } = await readBody(event) as { itemId: string }

  const item = await db.query.hackItems.findFirst({ where: and(eq(hackItems.id, itemId), eq(hackItems.userId, userId)) })
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  if (item.itemLevel >= ITEM_MAX_LEVEL)
    throw createError({ statusCode: 400, statusMessage: 'Item is already max level' })

  const cost = itemUpgradeCost(item.itemLevel)

  const currentUser = await db.query.user.findFirst({ where: eq(user.id, userId) })
  if ((currentUser?.gems ?? 0) < cost)
    throw createError({ statusCode: 400, statusMessage: 'Not enough gems' })

  await db.update(user).set({ gems: sql`${user.gems} - ${cost}` }).where(eq(user.id, userId))
  const [updated] = await db.update(hackItems)
    .set({ itemLevel: item.itemLevel + 1 })
    .where(eq(hackItems.id, itemId))
    .returning()

  return { item: updated, cost, newLevel: updated!.itemLevel }
})
