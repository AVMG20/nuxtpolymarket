import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { MAX_AFFIXES, REFORGE_ODDS, reforgeShardCost } from '#shared/utils/caravan/config'
import { itemBase, rollAffixValue } from '#shared/utils/caravan/items'
import { withStateRng } from '#shared/utils/caravan/state'
import type { AffixStat } from '#shared/utils/caravan/types'

export type ReforgeOutcome = 'nothing' | 'reroll' | 'gain' | 'lose'

/**
 * The reforge gamble. Mostly nothing happens; sometimes every value rerolls;
 * occasionally the item gains a slot beyond what its rarity allows; rarely it
 * loses one for good. The odds are fixed rather than tier-scaled so the decision
 * reads identically at tier 1 and tier 8.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ itemId?: string }>(event)
    const itemId = String(body?.itemId ?? '')

    const { ctx, result } = await withCaravan(userId, ({ state }) => {
        const index = state.items.findIndex(i => i.id === itemId)
        if (index === -1) throw createError({ statusCode: 404, statusMessage: 'No such item' })
        const item = state.items[index]!

        const cost = reforgeShardCost(item.tier, item.rarity)
        if (state.shards < cost) throw createError({ statusCode: 400, statusMessage: 'Not enough shards' })
        state.shards -= cost

        return withStateRng(state, (rng) => {
            const roll = rng.next()
            let outcome: ReforgeOutcome = 'nothing'
            if (roll < REFORGE_ODDS.lose) outcome = 'lose'
            else if (roll < REFORGE_ODDS.lose + REFORGE_ODDS.gain) outcome = 'gain'
            else if (roll < REFORGE_ODDS.lose + REFORGE_ODDS.gain + REFORGE_ODDS.reroll) outcome = 'reroll'

            const affixes = [...item.affixes]

            if (outcome === 'reroll') {
                for (let i = 0; i < affixes.length; i++) {
                    affixes[i] = rollAffixValue(rng, affixes[i]!.stat, item.tier, item.rarity)
                }
            } else if (outcome === 'gain') {
                // Only stats this base could have carried in the first place, and
                // never a duplicate -- a sixth affix is a windfall, not a wildcard.
                const taken = new Set(affixes.map(a => a.stat))
                const options = itemBase(item).pool.filter((stat: AffixStat) => !taken.has(stat))
                if (affixes.length >= MAX_AFFIXES || !options.length) {
                    outcome = 'nothing'
                } else {
                    affixes.push(rollAffixValue(rng, rng.pick(options), item.tier, item.rarity))
                }
            } else if (outcome === 'lose') {
                if (affixes.length <= 1) {
                    // Never brick an item down to nothing.
                    outcome = 'nothing'
                } else {
                    affixes.splice(rng.int(0, affixes.length - 1), 1)
                }
            }

            const reforged = { ...item, affixes, reforges: (item.reforges ?? 0) + 1 }
            state.items[index] = reforged
            return { item: reforged, outcome }
        })
    })

    return { ...caravanResponse(ctx), item: result.item, outcome: result.outcome }
})
