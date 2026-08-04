import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { factoryUpgradeCost } from '#shared/utils/miner-config'
import { getLockedMinerState, collectAndUpgradeGems } from '#server/utils/miner'
import { getPrestigePurchaseCount } from '#server/utils/prestige-shop'
import { minerFactoryMaxLevel } from '#shared/utils/prestige-shop'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction(async (tx) => {
    const s = await getLockedMinerState(tx, userId)
    const maxLevel = minerFactoryMaxLevel(await getPrestigePurchaseCount(userId, 'miner-core', tx))
    if (s.factoryLevel >= maxLevel) throw createError({ statusCode: 400, statusMessage: 'Factory is at max level' })

    return collectAndUpgradeGems(tx, userId, s, factoryUpgradeCost(s.factoryLevel))
  })
})
