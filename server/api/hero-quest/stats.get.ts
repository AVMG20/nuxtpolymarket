import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import {
    getCollections,
    getHqState,
    getShopLevels,
    getTraitBoard,
    heroSnapshotOf,
    serializeStatExplanation,
    settleHq
} from '#server/utils/hero-quest'
import { explainStats } from '#shared/utils/hero-quest/explain'

/**
 * Where every stat on every fielded unit comes from.
 *
 * **Its own route rather than a field on `state.get`, deliberately.** The breakdown is several
 * kilobytes of nested attribution and the state payload is fetched every
 * `HQ_REFRESH_INTERVAL_MS` by every open client; this is opened by hand, occasionally, when
 * somebody wants to know why a number is what it is. Paying for it on the hot path to save a
 * round trip on the cold one is the wrong trade.
 *
 * Settles first like every other read, so the levels it explains are the levels the battle
 * screen is showing rather than the ones from before the window that just accrued.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const existing = await getHqState(userId)
    if (!existing) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run yet' })

    const settleOutcome = await settleHq(userId)
    const { state } = settleOutcome

    const [shopLevels, collections, traits, balance] = await Promise.all([
        settleOutcome.shopLevels ?? getShopLevels(userId),
        settleOutcome.collections ?? getCollections(userId),
        settleOutcome.traits ?? getTraitBoard(userId),
        getBalance(userId)
    ])

    const hero = heroSnapshotOf(state, shopLevels, collections, parseFloat(balance) || 0, traits)
    return serializeStatExplanation(explainStats(hero))
})
