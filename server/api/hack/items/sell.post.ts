import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackItems } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { itemSellPrice, type HackRarity } from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const { itemId } = await readBody(event) as { itemId: string }

  const item = await db.query.hackItems.findFirst({ where: and(eq(hackItems.id, itemId), eq(hackItems.userId, userId)) })
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found' })

  // Unequip from agent first
  if (item.equippedBy) {
    const slotField = `equipped${item.slot.charAt(0).toUpperCase() + item.slot.slice(1)}` as 'equippedTool' | 'equippedSoftware' | 'equippedHardware'
    await db.update(hackAgents).set({ [slotField]: null }).where(eq(hackAgents.id, item.equippedBy))
  }

  const price = itemSellPrice(item.rarity as HackRarity)
  await db.delete(hackItems).where(eq(hackItems.id, itemId))
  await credit(userId, price.toFixed(4), 'HackOps')

  return { sold: true, price }
})
