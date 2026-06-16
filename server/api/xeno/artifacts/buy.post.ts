import { db } from '#server/database'
import { xenoArtifacts } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { consumePlantsByType } from '#server/utils/xeno'
import { getArtifactOrThrow } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ artifactTypeId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id
  const artType = getArtifactOrThrow(body.artifactTypeId)

  // Artifact costs consume any plant of the given typeId (speed/yield don't matter for crafting)
  for (const { plantTypeId, quantity } of artType.cost) {
    await consumePlantsByType(userId, plantTypeId, quantity)
  }

  const [artifact] = await db.insert(xenoArtifacts)
    .values({ userId, typeId: artType.id, chargesRemaining: artType.maxCharges })
    .returning()

  return { artifactId: artifact!.id, chargesRemaining: artifact!.chargesRemaining }
})
