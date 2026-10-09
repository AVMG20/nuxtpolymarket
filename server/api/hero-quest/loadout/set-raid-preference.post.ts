import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { setLoadoutPreference } from '#server/utils/hero-quest-loadout'
import { isLoadoutTarget } from '#shared/utils/hero-quest/loadout-session'

/**
 * Point a raid (or the Arena's attack) at a saved Loadout slot, or with `slotIndex: null` at none
 * (`loadouts.md` §4). Free and unlimited; set from the picker on the raid's own screen. Moves only
 * the pointer: the live loadout changes on the raid's next engage, never here.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ target?: unknown, slotIndex?: unknown }>(event)
    const target = body?.target
    if (!isLoadoutTarget(target)) throw createError({ statusCode: 400, statusMessage: 'Unknown raid' })

    let slotIndex: number | null = null
    if (body?.slotIndex !== null && body?.slotIndex !== undefined) {
        slotIndex = Math.floor(Number(body.slotIndex))
        if (!Number.isFinite(slotIndex) || slotIndex < 0) throw createError({ statusCode: 400, statusMessage: 'Pick a loadout slot' })
    }

    return db.transaction(tx => setLoadoutPreference(tx, userId, target, slotIndex))
})
