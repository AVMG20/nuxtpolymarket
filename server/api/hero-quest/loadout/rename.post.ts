import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { renameLoadout } from '#server/utils/hero-quest-loadout'

/**
 * Rename a saved loadout (`loadouts.md` §2). Only the name moves: the slot keeps what it holds,
 * which is why this is not `save` with a name.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ slotIndex?: number; name?: string }>(event)

    const slotIndex = Math.floor(Number(body?.slotIndex))
    if (!Number.isFinite(slotIndex) || slotIndex < 0) {
        throw createError({ statusCode: 400, statusMessage: 'Pick a loadout slot' })
    }
    if (typeof body?.name !== 'string' || !body.name.trim()) {
        throw createError({ statusCode: 400, statusMessage: 'Name the loadout' })
    }

    const name = await renameLoadout(db, userId, slotIndex, body.name)
    if (name === null) throw createError({ statusCode: 400, statusMessage: 'Nothing is saved in that slot' })
    return { slotIndex, name }
})
