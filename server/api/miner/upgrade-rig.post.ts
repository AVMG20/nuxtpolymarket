import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { rigUpgradeCost, RIG_MAX_LEVEL } from '#shared/utils/miner-config'
import { getLockedMinerState, collectAndUpgradeCash } from '#server/utils/miner'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db.transaction(async (tx) => {
    // The row lock serialises upgrades against each other and against /miner/collect,
    // so the pending cash reset by this upgrade can only ever be banked once.
    const s = await getLockedMinerState(tx, userId)
    if (s.rigLevel >= RIG_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Rig is at max level' })

    return collectAndUpgradeCash(tx, userId, s, 'rigLevel', rigUpgradeCost(s.rigLevel))
  })
})
