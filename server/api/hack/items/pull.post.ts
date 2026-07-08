import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackItems } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import {
  ITEM_PULL_TIERS, rollItemFromTier,
  MAX_INVENTORY_SLOTS, RARITY_LABEL,
} from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const { tierId } = await readBody(event) as { tierId: string }
  const tier = ITEM_PULL_TIERS.find(t => t.id === tierId)
  if (!tier) throw createError({ statusCode: 400, statusMessage: 'Unknown item tier' })

  const items = await db.query.hackItems.findMany({ where: eq(hackItems.userId, userId) })

  const unequippedCount = items.filter(i => !i.equippedBy).length
  if (unequippedCount >= MAX_INVENTORY_SLOTS)
    throw createError({ statusCode: 400, statusMessage: 'Inventory full — sell some unequipped items first' })

  await debit(userId, tier.cost.toFixed(4), 'HackOps')

  const itemDef = rollItemFromTier(tier)
  const [newItem] = await db.insert(hackItems).values({
    userId, name: itemDef.name, slot: itemDef.slot,
    itemLevel: itemDef.itemLevel, rarity: itemDef.rarity, mods: itemDef.mods,
  }).returning()

  return { item: newItem, rarityLabel: RARITY_LABEL[itemDef.rarity], rarity: itemDef.rarity }
})
