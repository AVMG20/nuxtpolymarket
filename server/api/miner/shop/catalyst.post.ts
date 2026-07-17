import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { catalystUpgradeCost, CATALYST_MAX_LEVEL } from '#shared/utils/miner-config'
import { upgradeGemShopTier } from '#server/utils/miner'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction((tx) => upgradeGemShopTier(tx, userId, 'catalystLevel', {
    maxLevel: CATALYST_MAX_LEVEL,
    maxLevelMessage: 'Catalyst is maxed',
    costFn: catalystUpgradeCost
  }))
})
