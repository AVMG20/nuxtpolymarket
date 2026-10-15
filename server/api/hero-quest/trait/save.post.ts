import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { storeTraitBoard } from '#server/utils/hero-quest-traits'
import { TRAIT_SAVE_SLOT_BODY, readHqBody, type HqTraitSaveResponse } from '#server/utils/hero-quest-api'

/**
 * Store the live Trait board in a save slot (`traits.md` §6), for `TRAIT_SAVE_LOAD_COST` Trait
 * Gems. Lock-then-read on `hq_state`; the spend is a guarded decrement.
 */
export default defineEventHandler(async (event): Promise<HqTraitSaveResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'traits')
    const { saveSlotIndex } = await readHqBody(event, TRAIT_SAVE_SLOT_BODY)
    return db.transaction(tx => storeTraitBoard(tx, userId, saveSlotIndex))
})
