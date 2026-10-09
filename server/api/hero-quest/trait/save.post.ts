import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { storeTraitBoard } from '#server/utils/hero-quest-traits'
import { MAX_TRAIT_SAVE_SLOTS } from '#shared/utils/hero-quest/constants'

/**
 * Store the live Trait board in a save slot (`traits.md` §6), for `TRAIT_SAVE_LOAD_COST` Trait
 * Gems. Lock-then-read on `hq_state`; the spend is a guarded decrement.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ saveSlotIndex?: unknown }>(event)
    const saveSlotIndex = Number(body?.saveSlotIndex)
    if (!Number.isInteger(saveSlotIndex) || saveSlotIndex < 0 || saveSlotIndex >= MAX_TRAIT_SAVE_SLOTS) {
        throw createError({ statusCode: 400, statusMessage: 'Pick a Trait save slot' })
    }
    return db.transaction(tx => storeTraitBoard(tx, userId, saveSlotIndex))
})
