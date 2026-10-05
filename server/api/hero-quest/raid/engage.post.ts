import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { getCollections, getShopLevels, heroSnapshotOf, positionOf, settleHq } from '#server/utils/hero-quest'
import { engageRaid } from '#server/utils/hero-quest-raids'
import { isRaidId } from '#shared/utils/hero-quest/content/raids'

/**
 * Enter a raid and play its round, server-side and seeded (`raid-system.md` §5): the response is the
 * fight's log, which the stage replays. Live only, like a boss: nothing here runs offline.
 *
 * Settles first, so the round is fought with every level the party has earned. The Key and the
 * reward move under the raid row's lock (`engageRaid`).
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ raidId?: string }>(event)
    const raidId = body?.raidId
    if (!isRaidId(raidId)) throw createError({ statusCode: 400, statusMessage: 'Unknown raid' })

    await settleHq(userId)
    // read before the transaction, as the boss engage does: only the Gambler's Strike family reads it
    const bankedGold = parseFloat(await getBalance(userId)) || 0

    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId))
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
        const hero = heroSnapshotOf(state, await getShopLevels(userId, tx), await getCollections(userId, tx), bankedGold)
        return engageRaid(tx, userId, raidId, hero, positionOf(state))
    })
})
