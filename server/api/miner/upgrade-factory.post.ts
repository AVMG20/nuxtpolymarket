import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { factoryUpgradeCost, FACTORY_MAX_LEVEL } from '#shared/utils/miner-config'
import { getLockedMinerState, collectAndUpgradeGems } from '#server/utils/miner'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction(async (tx) => {
    const s = await getLockedMinerState(tx, userId)
    if (s.factoryLevel >= FACTORY_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Factory is at max level' })

    return collectAndUpgradeGems(tx, userId, s, factoryUpgradeCost(s.factoryLevel))
  })
})
