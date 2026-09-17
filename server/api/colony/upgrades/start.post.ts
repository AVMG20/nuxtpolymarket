import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { settleColony, getUpgradeLevels, payPrice, claimBuilder } from '#server/utils/colony'
import { getUpgradeTrack, trackLevelCost } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ trackId: string }>(event)
  const userId = await requireUserId(event)

  const track = getUpgradeTrack(body.trackId)
  if (!track) throw createError({ statusCode: 400, statusMessage: `Unknown upgrade track: ${body.trackId}` })

  await settleColony(userId)

  const levels = await getUpgradeLevels(userId)
  const currentLevel = levels[track.id] ?? 0
  if (currentLevel >= track.maxLevel) throw createError({ statusCode: 400, statusMessage: `${track.name} is already at max level` })

  const nextLevel = currentLevel + 1
  const price = trackLevelCost(nextLevel)

  // Claiming the builder and paying for the level are one transaction: the
  // claim is what stops a second builder starting the same track (see
  // claimBuilder), so a payment that fails afterwards must take the claim
  // down with it rather than leaving a builder on an unpaid job.
  await db.transaction(async (tx) => {
    await claimBuilder(userId, track.id, tx)
    await payPrice(userId, price, tx)
  })

  return { ok: true }
})
