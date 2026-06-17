import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoBreederSlots, xenoArtifacts } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getArtifactOrThrow, hasEffect } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string; artifactId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [slot, artifact] = await Promise.all([
    db.query.xenoBreederSlots.findFirst({
      where: and(eq(xenoBreederSlots.id, body.slotId), eq(xenoBreederSlots.userId, userId)),
    }),
    db.query.xenoArtifacts.findFirst({
      where: and(eq(xenoArtifacts.id, body.artifactId), eq(xenoArtifacts.userId, userId)),
    }),
  ])

  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Breeder slot not found' })
  if (!artifact) throw createError({ statusCode: 404, statusMessage: 'Artifact not found' })
  if (slot.artifactId) throw createError({ statusCode: 400, statusMessage: 'Slot already has an artifact' })
  if (slot.startedAt && !slot.collected) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot change artifact while breeding' })
  }

  const artType = getArtifactOrThrow(artifact.typeId)
  if (!artType.effects.some(e => e.type.startsWith('breeder_'))) {
    throw createError({ statusCode: 400, statusMessage: 'This artifact can only be used in a grid slot' })
  }

  await db.update(xenoBreederSlots).set({ artifactId: artifact.id }).where(eq(xenoBreederSlots.id, slot.id))

  return { ok: true }
})
