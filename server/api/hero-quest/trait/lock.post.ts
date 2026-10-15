import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { setTraitLock } from '#server/utils/hero-quest-traits'
import { TRAIT_LOCK_BODY, readHqBody, type HqTraitLockResponse } from '#server/utils/hero-quest-api'

/**
 * Lock or unlock a Trait slot (`traits.md` §3): free and unlimited, and a locked slot sits out the
 * next Roll. `locked` is the state to set rather than a toggle, so a double-tap cannot undo itself.
 */
export default defineEventHandler(async (event): Promise<HqTraitLockResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'traits')
    const { slotIndex, locked } = await readHqBody(event, TRAIT_LOCK_BODY)
    return db.transaction(tx => setTraitLock(tx, userId, slotIndex, locked))
})
