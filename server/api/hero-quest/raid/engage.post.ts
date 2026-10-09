import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { getBalance } from '#server/utils/balance'
import { getCollections, getShopLevels, getTraitBoard, heroSnapshotOf, settleHq } from '#server/utils/hero-quest'
import { engageRaid } from '#server/utils/hero-quest-raids'
import { isRaidId } from '#shared/utils/hero-quest/content/raids'

/**
 * Enter a raid and play its round, server-side and seeded (`raid-system.md` §5): the response is the
 * fight's log, which the stage replays. Live only, like a boss: nothing here runs offline.
 *
 * Settles first, so the round is fought with every level the party has earned. The Key and the
 * reward move under the raid row's lock (`engageRaid`), after the raid's preferred Loadout has
 * gone on (`loadouts.md` §4); the party is read off the state that swap leaves.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'raids')
    const body = await readBody<{ raidId?: string }>(event)
    const raidId = body?.raidId
    if (!isRaidId(raidId)) throw createError({ statusCode: 400, statusMessage: 'Unknown raid' })

    await settleHq(userId)
    // read before the transaction, as the boss engage does: only the Gambler's Strike family reads it
    const bankedGold = parseFloat(await getBalance(userId)) || 0

    return db.transaction(tx => engageRaid(tx, userId, raidId, async state =>
        heroSnapshotOf(state, await getShopLevels(userId, tx), await getCollections(userId, tx), bankedGold, await getTraitBoard(userId, tx))))
})
