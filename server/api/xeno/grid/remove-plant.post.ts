import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots } from '#server/database/schema'
import { auth } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const slot = await db.query.xenoGridSlots.findFirst({
    where: and(eq(xenoGridSlots.id, body.slotId), eq(xenoGridSlots.userId, userId)),
  })
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  if (!slot.plantId) throw createError({ statusCode: 400, statusMessage: 'No plant in this slot' })

  await db.update(xenoGridSlots)
    .set({ plantId: null, startedAt: null })
    .where(eq(xenoGridSlots.id, slot.id))

  return { ok: true }
})
