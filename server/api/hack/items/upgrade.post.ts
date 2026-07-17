import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackItems } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { ITEM_MAX_LEVEL, itemUpgradeCostForLevels } from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { itemId, levels: requestedLevels } = await readBody(event) as { itemId: string; levels?: number }

  const item = await db.query.hackItems.findFirst({ where: and(eq(hackItems.id, itemId), eq(hackItems.userId, userId)) })
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  if (item.itemLevel >= ITEM_MAX_LEVEL)
    throw createError({ statusCode: 400, statusMessage: 'Item is already max level' })

  // Client only picks how many levels to buy (1, or the bulk button's count) — cost is
  // always derived server-side, and clamped so a spoofed `levels` can never overshoot
  // ITEM_MAX_LEVEL or pay less than the real ladder cost.
  const levels = Math.min(
    Math.max(1, Number.isFinite(requestedLevels) ? Math.floor(requestedLevels!) : 1),
    ITEM_MAX_LEVEL - item.itemLevel
  )
  const cost = itemUpgradeCostForLevels(item.itemLevel, levels)

  await debitGems(userId, cost)
  const [updated] = await db.update(hackItems)
    .set({ itemLevel: item.itemLevel + levels })
    .where(eq(hackItems.id, itemId))
    .returning()

  return { item: updated, cost, newLevel: updated!.itemLevel }
})
