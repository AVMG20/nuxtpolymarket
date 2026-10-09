import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { buyShopTrack } from '#server/utils/hero-quest'
import { isShopTrackId } from '#shared/utils/hero-quest/content/shop'

/**
 * Buy one level of a prestige-shop track. Claim-then-reward on the level, with the currency spent
 * under its own guard — see `buyShopTrack`. Loadout and Trait save slots take Gems, the rest Void
 * Shards.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'prestige')
    const body = await readBody<{ upgradeId?: string }>(event)
    const upgradeId = body?.upgradeId

    if (typeof upgradeId !== 'string' || !isShopTrackId(upgradeId)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown upgrade' })
    }

    return db.transaction(tx => buyShopTrack(tx, userId, upgradeId))
})
