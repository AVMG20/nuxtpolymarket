import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoBreederSlots } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string }>(event)
  const userId = await requireUserId(event)

  const slot = await db.query.xenoBreederSlots.findFirst({
    where: and(eq(xenoBreederSlots.id, body.slotId), eq(xenoBreederSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  if (!slot.artifactId) throw createError({ statusCode: 400, statusMessage: 'No artifact attached' })
  if (slot.startedAt && !slot.collected) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot remove artifact while breeding' })
  }

  await db.update(xenoBreederSlots).set({ artifactId: null }).where(eq(xenoBreederSlots.id, slot.id))

  return { ok: true }
})
