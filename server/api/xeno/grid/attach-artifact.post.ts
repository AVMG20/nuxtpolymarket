import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoArtifacts } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getArtifactOrThrow } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slotId: string; artifactId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const [slot, artifact] = await Promise.all([
    db.query.xenoGridSlots.findFirst({
      where: and(eq(xenoGridSlots.id, body.slotId), eq(xenoGridSlots.userId, userId)),
    }),
    db.query.xenoArtifacts.findFirst({
      where: and(eq(xenoArtifacts.id, body.artifactId), eq(xenoArtifacts.userId, userId)),
    }),
  ])

  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  if (!artifact) throw createError({ statusCode: 404, statusMessage: 'Artifact not found' })
  if (slot.artifactId) throw createError({ statusCode: 400, statusMessage: 'Slot already has an artifact' })

  const artType = getArtifactOrThrow(artifact.typeId)
  if (!artType.effects.some(e => e.type.startsWith('grid_'))) {
    throw createError({ statusCode: 400, statusMessage: 'This artifact can only be used in a breeder slot' })
  }

  const inGrid = await db.query.xenoGridSlots.findFirst({
    where: and(eq(xenoGridSlots.artifactId, artifact.id), eq(xenoGridSlots.userId, userId)),
  })
  if (inGrid) throw createError({ statusCode: 400, statusMessage: 'Artifact is already attached to a grid slot' })

  // completesAt is computed dynamically in state.get — no storage needed
  await db.update(xenoGridSlots).set({ artifactId: artifact.id }).where(eq(xenoGridSlots.id, slot.id))

  return { ok: true }
})
