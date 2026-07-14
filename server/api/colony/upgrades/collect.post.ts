import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyState, colonyUpgrades } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony, getUpgradeLevels } from '#server/utils/colony'
import { getUpgradeTrack, trackLevelDurationMs, habitatLevelUpDurationMs, HABITAT_BUILDER_JOB_ID, MAX_TIER } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const state = await settleColony(userId)
  if (!state.builderTrackId || !state.builderStartedAt) {
    throw createError({ statusCode: 400, statusMessage: 'The builder has nothing to collect' })
  }

  if (state.builderTrackId === HABITAT_BUILDER_JOB_ID) {
    if (state.habitatLevel >= MAX_TIER) throw createError({ statusCode: 400, statusMessage: 'Habitat is already at max level' })
    const completesAt = state.builderStartedAt.getTime() + habitatLevelUpDurationMs(state.habitatLevel)
    if (Date.now() < completesAt) throw createError({ statusCode: 400, statusMessage: 'Habitat construction is not finished yet' })

    await db.update(colonyState)
      .set({ habitatLevel: state.habitatLevel + 1, builderTrackId: null, builderStartedAt: null })
      .where(eq(colonyState.userId, userId))

    return { ok: true, habitatLevel: state.habitatLevel + 1 }
  }

  const track = getUpgradeTrack(state.builderTrackId)
  if (!track) throw createError({ statusCode: 500, statusMessage: 'Unknown track under construction' })

  const levels = await getUpgradeLevels(userId)
  const nextLevel = (levels[track.id] ?? 0) + 1
  const completesAt = state.builderStartedAt.getTime() + trackLevelDurationMs(nextLevel)
  if (Date.now() < completesAt) throw createError({ statusCode: 400, statusMessage: 'Upgrade is not finished yet' })

  const existing = await db.query.colonyUpgrades.findFirst({
    where: and(eq(colonyUpgrades.userId, userId), eq(colonyUpgrades.trackId, track.id))
  })
  if (existing) {
    await db.update(colonyUpgrades).set({ level: nextLevel }).where(eq(colonyUpgrades.id, existing.id))
  } else {
    await db.insert(colonyUpgrades).values({ userId, trackId: track.id, level: nextLevel })
  }

  await db.update(colonyState)
    .set({ builderTrackId: null, builderStartedAt: null })
    .where(eq(colonyState.userId, userId))

  return { ok: true, trackId: track.id, level: nextLevel }
})
