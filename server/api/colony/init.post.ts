import { auth } from '#server/utils/auth'
import { ensureColonyState } from '#server/utils/colony'

/**
 * Found the colony — creates the state row only. There are no free starter
 * bugs: COLONY is late-game content and the player buys their first bugs
 * in the market with coins earned elsewhere.
 */
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  await ensureColonyState(session.user.id)

  return { ok: true }
})
