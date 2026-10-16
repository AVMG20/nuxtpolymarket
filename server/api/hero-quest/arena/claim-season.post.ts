import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { claimSeasonRewards, ensureSeasonsClosed } from '#server/utils/hero-quest-arena'
import type { HqArenaClaimResponse } from '#server/utils/hero-quest-api'

/**
 * Claim every finished season's rank reward waiting (`arena.md` §7), in Medals. Closes any season
 * that has ended first, so a reward is claimable from the first request after its season ends.
 */
export default defineEventHandler(async (event): Promise<HqArenaClaimResponse> => {
    const userId = await requireUserId(event)
    await ensureSeasonsClosed(Date.now())
    return db.transaction(tx => claimSeasonRewards(tx, userId))
})
