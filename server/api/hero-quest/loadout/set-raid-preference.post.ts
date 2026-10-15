import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { setLoadoutPreference } from '#server/utils/hero-quest-loadout'
import { LOADOUT_PREFERENCE_BODY, readHqBody, type HqLoadoutPreferenceResponse } from '#server/utils/hero-quest-api'

/**
 * Point a raid (or the Arena's attack) at a saved Loadout slot, or with `slotIndex: null` at none
 * (`loadouts.md` §4). Free and unlimited; set from the picker on the raid's own screen. Moves only
 * the pointer: the live loadout changes on the raid's next engage, never here.
 */
export default defineEventHandler(async (event): Promise<HqLoadoutPreferenceResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'loadouts')
    const { target, slotIndex = null } = await readHqBody(event, LOADOUT_PREFERENCE_BODY)
    return db.transaction(tx => setLoadoutPreference(tx, userId, target, slotIndex))
})
