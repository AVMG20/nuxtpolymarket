import { eq, and, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoArtifacts, xenoGridSlots, xenoBreederSlots } from '#server/database/schema'
import { auth } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ artifactIds: string[] }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id
  const artifactIds = [...new Set(body.artifactIds ?? [])]
  if (!artifactIds.length) throw createError({ statusCode: 400, statusMessage: 'No artifacts specified' })

  const artifacts = await db.query.xenoArtifacts.findMany({
    where: and(inArray(xenoArtifacts.id, artifactIds), eq(xenoArtifacts.userId, userId))
  })
  if (artifacts.length !== artifactIds.length) throw createError({ statusCode: 404, statusMessage: 'Artifact not found' })

  const [gridSlots, breederSlots] = await Promise.all([
    db.query.xenoGridSlots.findMany({ where: eq(xenoGridSlots.userId, userId) }),
    db.query.xenoBreederSlots.findMany({ where: eq(xenoBreederSlots.userId, userId) })
  ])
  const attachedIds = new Set([
    ...gridSlots.map(s => s.artifactId).filter(Boolean),
    ...breederSlots.map(s => s.artifactId).filter(Boolean)
  ])
  if (artifactIds.some(id => attachedIds.has(id))) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot delete an artifact that is attached to a slot' })
  }

  await db.delete(xenoArtifacts).where(and(inArray(xenoArtifacts.id, artifactIds), eq(xenoArtifacts.userId, userId)))

  return { ok: true, deleted: artifactIds.length }
})
