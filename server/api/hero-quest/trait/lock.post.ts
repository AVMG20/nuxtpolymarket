import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { setTraitLock } from '#server/utils/hero-quest-traits'
import { TRAIT_SLOT_COUNT } from '#shared/utils/hero-quest/constants'

/**
 * Lock or unlock a Trait slot (`traits.md` §3): free and unlimited, and a locked slot sits out the
 * next Roll. `locked` is the state to set rather than a toggle, so a double-tap cannot undo itself.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'traits')
    const body = await readBody<{ slotIndex?: unknown, locked?: unknown }>(event)
    const slotIndex = Number(body?.slotIndex)
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= TRAIT_SLOT_COUNT) {
        throw createError({ statusCode: 400, statusMessage: 'Pick a Trait slot' })
    }
    if (typeof body?.locked !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Say whether to lock it' })
    const locked = body.locked
    return db.transaction(tx => setTraitLock(tx, userId, slotIndex, locked))
})
