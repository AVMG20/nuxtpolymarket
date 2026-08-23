import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debitGems } from '#server/utils/balance'
import { MASTER_REROLL_GEM_COST, rerollCost } from '#shared/utils/caravan/config'
import { rollAffixValue } from '#shared/utils/caravan/items'
import { withStateRng } from '#shared/utils/caravan/state'

/**
 * Reroll every affix value on an item, keeping its base, tier, rarity and which
 * stats it carries. This is the sink for a good item with one dead roll.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ itemId?: string, keepBest?: boolean }>(event)
    const itemId = String(body?.itemId ?? '')
    const keepBest = body?.keepBest === true

    const { ctx, result } = await withCaravan(userId, async ({ state }, tx) => {
        const index = state.items.findIndex(i => i.id === itemId)
        if (index === -1) throw createError({ statusCode: 404, statusMessage: 'No such item' })
        const item = state.items[index]!

        const cost = rerollCost(item.tier, item.rarity)
        if (state.shards < cost) throw createError({ statusCode: 400, statusMessage: 'Not enough shards' })
        state.shards -= cost
        if (keepBest) await debitGems(userId, MASTER_REROLL_GEM_COST, tx)

        // A master's reroll protects the single highest roll on the item, which
        // is the difference between gambling an item away and improving it.
        const protectedIndex = keepBest
            ? item.affixes.reduce((best, affix, i) => (affix.quality > item.affixes[best]!.quality ? i : best), 0)
            : -1
        const rerolled = withStateRng(state, rng => ({
            ...item,
            affixes: item.affixes.map((affix, i) =>
                i === protectedIndex ? affix : rollAffixValue(rng, affix.stat, item.tier, item.rarity)
            )
        }))
        state.items[index] = rerolled
        return rerolled
    })

    return { ...caravanResponse(ctx), item: result }
})
