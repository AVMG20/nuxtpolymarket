import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { settleColony, getUpgradeLevels, payPrice } from '#server/utils/colony'
import { getUpgradeTrack, trackLevelCost } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ trackId: string }>(event)
  const userId = await requireUserId(event)

  const track = getUpgradeTrack(body.trackId)
  if (!track) throw createError({ statusCode: 400, statusMessage: `Unknown upgrade track: ${body.trackId}` })

  const state = await settleColony(userId)
  if (state.builderTrackId) throw createError({ statusCode: 400, statusMessage: 'The builder is already busy' })

  const levels = await getUpgradeLevels(userId)
  const currentLevel = levels[track.id] ?? 0
  if (currentLevel >= track.maxLevel) throw createError({ statusCode: 400, statusMessage: `${track.name} is already at max level` })

  const nextLevel = currentLevel + 1
  const price = trackLevelCost(nextLevel)
  await payPrice(userId, price)

  await db.update(colonyState)
    .set({ builderTrackId: track.id, builderStartedAt: new Date() })
    .where(eq(colonyState.userId, userId))

  return { ok: true }
})
