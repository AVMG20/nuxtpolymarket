import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackItems } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { rerollCost, rerollItemMods, type ItemMod, type ModType } from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { itemId, lockedTypes } = await readBody(event) as { itemId: string; lockedTypes?: ModType[] }

  const item = await db.query.hackItems.findFirst({ where: and(eq(hackItems.id, itemId), eq(hackItems.userId, userId)) })
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found' })

  const mods = item.mods as ItemMod[]
  const modTypes = new Set(mods.map(m => m.type))
  // De-dupe and validate the requested locks against what the item actually has.
  const locked = [...new Set(lockedTypes ?? [])].filter(t => modTypes.has(t))
  if (locked.length >= mods.length)
    throw createError({ statusCode: 400, statusMessage: 'Leave at least one mod unlocked to re-roll' })

  const cost = rerollCost(mods.length, locked.length)

  await debitGems(userId, cost)

  const newMods = rerollItemMods(mods, locked)
  const [updated] = await db.update(hackItems).set({ mods: newMods }).where(eq(hackItems.id, itemId)).returning()

  return { item: updated, cost }
})
