import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { leaveLoadoutSession } from '#server/utils/hero-quest-loadout'

/**
 * Leave the raid (`loadouts.md` §4): the live loadout goes back to what it was before the raid's
 * first engage, if a preferred Loadout was applied. The client calls it as it leaves the raid's
 * screen, never between attempts. Idempotent: with no session open it changes nothing.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const restored = await db.transaction(tx => leaveLoadoutSession(tx, userId))
    return { restored }
})
