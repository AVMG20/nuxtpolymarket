import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony, getUpgradeLevels } from '#server/utils/colony'
import { debit } from '#server/utils/balance'
import { UPGRADE_TRACKS, habitatTrackRequirement, HABITAT_LEVEL_UP_COST, MAX_TIER } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const state = await settleColony(userId)
  if (state.habitatLevel >= MAX_TIER) throw createError({ statusCode: 400, statusMessage: 'Habitat is already at max level' })

  const levels = await getUpgradeLevels(userId)
  const short = UPGRADE_TRACKS.filter(t => (levels[t.id] ?? 0) < habitatTrackRequirement(t.id, state.habitatLevel))
  if (short.length > 0) {
    const detail = short.map(t => `${t.name} (needs Lv ${habitatTrackRequirement(t.id, state.habitatLevel)})`).join(', ')
    throw createError({ statusCode: 400, statusMessage: `Every upgrade track needs to reach its required level first: ${detail}` })
  }

  await debit(userId, HABITAT_LEVEL_UP_COST.toFixed(4), 'colony:habitat-level')
  await db.update(colonyState).set({ habitatLevel: state.habitatLevel + 1 }).where(eq(colonyState.userId, userId))

  return { ok: true }
})
