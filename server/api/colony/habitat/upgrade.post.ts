import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { debit, debitGems } from '#server/utils/balance'
import { settleColony, getUpgradeLevels, claimBuilder } from '#server/utils/colony'
import { UPGRADE_TRACKS, habitatTrackRequirement, habitatLevelUpCost, habitatLevelUpGemCost, HABITAT_BUILDER_JOB_ID, MAX_TIER } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const state = await settleColony(userId)
  if (state.habitatLevel >= MAX_TIER) throw createError({ statusCode: 400, statusMessage: 'Habitat is already at max level' })

  const levels = await getUpgradeLevels(userId)
  const short = UPGRADE_TRACKS.filter(t => (levels[t.id] ?? 0) < habitatTrackRequirement(t.id, state.habitatLevel))
  if (short.length > 0) {
    const detail = short.map(t => `${t.name} (needs Lv ${habitatTrackRequirement(t.id, state.habitatLevel)})`).join(', ')
    throw createError({ statusCode: 400, statusMessage: `Every upgrade track needs to reach its required level first: ${detail}` })
  }

  // Habitat level-ups spend both coins and gems — debited together in one
  // transaction so a shortfall in either currency fails the whole thing
  // instead of silently spending one and then erroring on the other.
  const coinCost = habitatLevelUpCost(state.habitatLevel)
  const gemCost = habitatLevelUpGemCost(state.habitatLevel)

  await db.transaction(async (tx) => {
    // Claim the builder before touching the wallet: the claim is the mutex
    // (see claimBuilder), and a rejected claim must not have already spent
    // coins and gems.
    await claimBuilder(userId, HABITAT_BUILDER_JOB_ID, tx)

    await debit(userId, coinCost.toFixed(4), 'colony:habitat', tx)
    await debitGems(userId, gemCost, 'colony:habitat', tx)
  })

  return { ok: true, level: state.habitatLevel + 1 }
})
