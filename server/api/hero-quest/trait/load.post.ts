import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { loadTraitBoard } from '#server/utils/hero-quest-traits'
import { MAX_TRAIT_SAVE_SLOTS } from '#shared/utils/hero-quest/constants'

/**
 * Load a stored Trait board onto the live slots (`traits.md` §6), for `TRAIT_SAVE_LOAD_COST` Trait
 * Gems. Lock-then-read on `hq_state`; the spend is a guarded decrement. A Loadout never touches
 * the board (§7), so this is the only way one comes back.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'traits')
    // settle first, so the window before this pays at the rate it ran at, not the new one
    await settleHq(userId)
    const body = await readBody<{ saveSlotIndex?: unknown }>(event)
    const saveSlotIndex = Number(body?.saveSlotIndex)
    if (!Number.isInteger(saveSlotIndex) || saveSlotIndex < 0 || saveSlotIndex >= MAX_TRAIT_SAVE_SLOTS) {
        throw createError({ statusCode: 400, statusMessage: 'Pick a Trait save slot' })
    }
    return db.transaction(tx => loadTraitBoard(tx, userId, saveSlotIndex))
})
