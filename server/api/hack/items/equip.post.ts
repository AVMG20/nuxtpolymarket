import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackItems } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import type { ItemSlot } from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  // Pass agentId=null to unequip
  const { itemId, agentId } = await readBody(event) as { itemId: string; agentId: string | null }

  const item = await db.query.hackItems.findFirst({ where: and(eq(hackItems.id, itemId), eq(hackItems.userId, userId)) })
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found' })

  // Unequip from current agent if equipped
  if (item.equippedBy) {
    const prevAgent = await db.query.hackAgents.findFirst({ where: and(eq(hackAgents.id, item.equippedBy), eq(hackAgents.userId, userId)) })
    if (prevAgent) {
      const slotField = `equipped${item.slot.charAt(0).toUpperCase() + item.slot.slice(1)}` as 'equippedTool' | 'equippedSoftware' | 'equippedHardware'
      await db.update(hackAgents).set({ [slotField]: null }).where(eq(hackAgents.id, prevAgent.id))
    }
  }

  if (agentId === null) {
    // Just unequip
    await db.update(hackItems).set({ equippedBy: null }).where(eq(hackItems.id, itemId))
    return { unequipped: true }
  }

  const agent = await db.query.hackAgents.findFirst({ where: and(eq(hackAgents.id, agentId), eq(hackAgents.userId, userId)) })
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'Agent not found' })

  const slotField = `equipped${item.slot.charAt(0).toUpperCase() + item.slot.slice(1)}` as 'equippedTool' | 'equippedSoftware' | 'equippedHardware'
  const currentInSlot = agent[slotField]

  // Unequip whatever is currently in that slot
  if (currentInSlot && currentInSlot !== itemId) {
    await db.update(hackItems).set({ equippedBy: null }).where(eq(hackItems.id, currentInSlot))
  }

  await Promise.all([
    db.update(hackAgents).set({ [slotField]: itemId }).where(eq(hackAgents.id, agentId)),
    db.update(hackItems).set({ equippedBy: agentId }).where(eq(hackItems.id, itemId)),
  ])

  return { equipped: true, slot: item.slot }
})
