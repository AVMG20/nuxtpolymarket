import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { buyShopTrack, settleHq } from '#server/utils/hero-quest'
import { isShopTrackId } from '#shared/utils/hero-quest/content/shop'

/**
 * Buy one level of a Shop track. Claim-then-reward on the level, with the currency spent under its
 * own guard — see `buyShopTrack`. Loadout and Trait save slots take Gems, the offline tracks Gold,
 * the rest Void Shards.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ upgradeId?: string }>(event)
    const upgradeId = body?.upgradeId

    if (typeof upgradeId !== 'string' || !isShopTrackId(upgradeId)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown upgrade' })
    }
    // Trait save slots are sold in the Traits scene too, so they take the Traits gate
    await requireFeature(userId, upgradeId === 'traitSaveSlots' ? 'traits' : 'shop')
    // settle first, so the window before this pays at the rate it ran at, not the new one
    await settleHq(userId)

    return db.transaction(tx => buyShopTrack(tx, userId, upgradeId))
})
