import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string }>(event)
  const userId = await requireUserId(event)

  const slot = await db.query.xenoGridSlots.findFirst({
    where: and(eq(xenoGridSlots.id, body.slotId), eq(xenoGridSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  if (!slot.artifactId) throw createError({ statusCode: 400, statusMessage: 'No artifact attached' })

  // completesAt is computed dynamically in state.get — no storage needed
  await db.update(xenoGridSlots).set({ artifactId: null }).where(eq(xenoGridSlots.id, slot.id))

  return { ok: true }
})
