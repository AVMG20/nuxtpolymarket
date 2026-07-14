import { auth } from '#server/utils/auth'
import { upgradeResearch } from '#server/utils/colony'
import { getBug } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const type = getBug(body.typeId)
  if (!type) throw createError({ statusCode: 400, statusMessage: `Unknown bug type: ${body.typeId}` })

  const result = await upgradeResearch(userId, body.typeId)

  return { ok: true, typeId: body.typeId, level: result.level }
})
