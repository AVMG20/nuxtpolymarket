import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { vaultUpgradeCost, VAULT_MAX_LEVEL } from '#shared/utils/miner-config'
import { getLockedMinerState, collectAndUpgradeCash } from '#server/utils/miner'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction(async (tx) => {
    const s = await getLockedMinerState(tx, userId)
    if (s.vaultLevel >= VAULT_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Vault is at max level' })

    // Collect pending before expanding so the new cap isn't applied retroactively
    return collectAndUpgradeCash(tx, userId, s, 'vaultLevel', vaultUpgradeCost(s.vaultLevel))
  })
})
