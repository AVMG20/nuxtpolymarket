import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { getBalance } from '#server/utils/balance'
import { settleHq } from '#server/utils/hero-quest'
import { attackArena, ensureSeasonsClosed } from '#server/utils/hero-quest-arena'

/**
 * Attack a candidate from the list (`arena.md` §1–§5), resolved server-side and seeded: the response
 * is the fight's log, which the stage replays. Battle Speed has no part in it (§1).
 *
 * Settles first, so the attack is fought with every level the party has earned; closes any season
 * that has ended before a row is locked, so the Ratings this moves belong to the season they count
 * for. Attempts, Medals and both Ratings move under the two rows' locks (`attackArena`).
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'arena')
    const body = await readBody<{ slot?: unknown, opponent?: unknown }>(event)
    const slot = Number(body?.slot)
    if (!Number.isInteger(slot) || slot < 0) throw createError({ statusCode: 400, statusMessage: 'Pick an opponent from the list' })
    if (typeof body?.opponent !== 'string') throw createError({ statusCode: 400, statusMessage: 'Pick an opponent from the list' })
    const opponent = body.opponent

    await settleHq(userId)
    const now = Date.now()
    await ensureSeasonsClosed(now)
    // read before the transaction, as a raid entry does: only the Gambler's Strike family reads it
    const bankedGold = parseFloat(await getBalance(userId)) || 0
    return db.transaction(tx => attackArena(tx, userId, slot, opponent, bankedGold, now))
})
