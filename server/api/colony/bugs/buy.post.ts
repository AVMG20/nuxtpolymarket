import { auth } from '#server/utils/auth'
import { settleColony, addBug } from '#server/utils/colony'
import { debit } from '#server/utils/balance'
import { getBug, rollStartLevel } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string }>(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const type = getBug(body.typeId)
  if (!type) throw createError({ statusCode: 400, statusMessage: `Unknown bug type: ${body.typeId}` })

  const state = await settleColony(userId)

  if (!type.isStarter && type.tier > state.habitatLevel) {
    throw createError({ statusCode: 403, statusMessage: `${type.name} requires Habitat Level ${type.tier} — upgrade your habitat first.` })
  }

  // bought bugs land in inventory, unplaced — no capacity check here, that
  // only applies when placing a bug into the terrarium
  await debit(userId, type.spawnCost.toFixed(4), 'colony:buy-bug')
  await addBug(userId, type.id, rollStartLevel(), rollStartLevel(), rollStartLevel())

  return { ok: true }
})
