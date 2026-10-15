import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { loadTraitBoard } from '#server/utils/hero-quest-traits'
import { TRAIT_SAVE_SLOT_BODY, readHqBody, type HqTraitLoadResponse } from '#server/utils/hero-quest-api'

/**
 * Load a stored Trait board onto the live slots (`traits.md` §6), for `TRAIT_SAVE_LOAD_COST` Trait
 * Gems. Lock-then-read on `hq_state`; the spend is a guarded decrement. A Loadout never touches
 * the board (§7), so this is the only way one comes back.
 */
export default defineEventHandler(async (event): Promise<HqTraitLoadResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'traits')
    // settle first, so the window before this pays at the rate it ran at, not the new one
    await settleHq(userId)
    const { saveSlotIndex } = await readHqBody(event, TRAIT_SAVE_SLOT_BODY)
    return db.transaction(tx => loadTraitBoard(tx, userId, saveSlotIndex))
})
