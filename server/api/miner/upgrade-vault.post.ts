import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { vaultUpgradeCost } from '#shared/utils/miner-config'
import { getLockedMinerState, collectAndUpgradeCash } from '#server/utils/miner'
import { getPrestigePurchaseCount } from '#server/utils/prestige-shop'
import { minerVaultMaxLevel } from '#shared/utils/prestige-shop'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction(async (tx) => {
    const s = await getLockedMinerState(tx, userId)
    const maxLevel = minerVaultMaxLevel(await getPrestigePurchaseCount(userId, 'miner-core', tx))
    if (s.vaultLevel >= maxLevel) throw createError({ statusCode: 400, statusMessage: 'Vault is at max level' })

    // Collect pending before expanding so the new cap isn't applied retroactively
    return collectAndUpgradeCash(tx, userId, s, 'vaultLevel', vaultUpgradeCost(s.vaultLevel))
  })
})
