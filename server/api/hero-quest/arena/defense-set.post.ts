import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { setDefense } from '#server/utils/hero-quest-arena'
import type { HqArenaDefenseResponse } from '#server/utils/hero-quest-api'

/**
 * "Set current loadout as defence" (`arena.md` §1): the player's own loadout as it is equipped now,
 * free and unlimited, and never touching the live loadout. The only way a defence is set.
 */
export default defineEventHandler(async (event): Promise<HqArenaDefenseResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'arena')
    const { defense, defenseGpn } = await db.transaction(tx => setDefense(tx, userId))
    // null only for an account with no defence, and one was just set
    return { defense, defenseGpn: defenseGpn! }
})
