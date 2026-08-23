import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debit } from '#server/utils/balance'
import { GUARANTEE_COST, ITEM_BASES, craftCost, craftResourceCost, salvageValue } from '#shared/utils/caravan/config'
import { rollItem } from '#shared/utils/caravan/items'
import { hasResources, spendResources, withStateRng } from '#shared/utils/caravan/state'
import type { Item, Rarity } from '#shared/utils/caravan/types'

/**
 * Commission a piece of gear. You pick the tier and optionally the base, but the
 * rarity and every affix value are rolled -- paying shards only raises the floor
 * on rarity, never the rolls themselves. That is the whole chase: a legendary
 * with three bad rolls is worse than a lucky rare.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ tier?: number, baseId?: string, guarantee?: Rarity, count?: number }>(event)
    const tier = Math.floor(Number(body?.tier ?? 1))
    const baseId = body?.baseId ? String(body.baseId) : undefined
    const guarantee = body?.guarantee
    // Batch commissions: rolling for a good item one click at a time is the
    // definition of tedious once you can afford twenty rolls a session.
    const count = Math.max(1, Math.min(25, Math.floor(Number(body?.count ?? 1))))

    const { ctx, result } = await withCaravan(userId, async ({ state }, tx) => {
        if (tier < 1 || tier > state.tier) throw createError({ statusCode: 400, statusMessage: 'Tier not unlocked' })
        if (baseId && !ITEM_BASES.some(b => b.id === baseId)) {
            throw createError({ statusCode: 400, statusMessage: 'No such base' })
        }

        const shardCost = (guarantee ? (GUARANTEE_COST[guarantee] ?? 0) : 0) * count
        if (shardCost > state.shards) throw createError({ statusCode: 400, statusMessage: 'Not enough shards' })

        const unitCost = craftResourceCost(tier)
        const resourceCost = Object.fromEntries(
            Object.entries(unitCost).map(([id, amount]) => [id, amount * count])
        )
        if (!hasResources(state, resourceCost)) throw createError({ statusCode: 400, statusMessage: 'Not enough materials' })

        // One debit for the whole batch: it either all clears or none of it does.
        await debit(userId, (craftCost(tier) * count).toFixed(4), 'game:caravan', tx)
        spendResources(state, resourceCost)
        state.shards -= shardCost

        const floor = state.policies?.autoSalvageBelow ?? null
        const rolled: Item[] = []
        let salvagedCount = 0
        let salvagedShards = 0

        for (let i = 0; i < count; i++) {
            const item = withStateRng(state, rng => rollItem(rng, tier, { rarity: undefined, baseId, now: Date.now() }))
            // A guarantee sets the floor, so reroll rarity upward if the draw fell short.
            const crafted: Item = guarantee
                ? withStateRng(state, rng => rollItem(rng, tier, { rarity: pickFloor(item.rarity, guarantee), baseId: item.base, now: Date.now() }))
                : item

            // Auto-salvage keeps a bulk-rolling session from burying the vault in
            // commons. The item is still returned so the reveal and the sound cue
            // play -- you see what you got, it just does not stay.
            if (floor !== null && ORDER.indexOf(crafted.rarity) < ORDER.indexOf(floor)) {
                const shards = salvageValue(crafted.tier, crafted.rarity)
                state.shards += shards
                salvagedShards += shards
                salvagedCount++
            } else {
                state.items.push(crafted)
            }
            rolled.push(crafted)
        }

        return { items: rolled, salvagedCount, salvagedShards }
    })

    return {
        ...caravanResponse(ctx),
        items: result.items,
        // The single best roll of the batch, for the reveal panel and sound cue.
        item: result.items.reduce((best, item) =>
            ORDER.indexOf(item.rarity) > ORDER.indexOf(best.rarity) ? item : best
        ),
        salvagedCount: result.salvagedCount,
        salvagedShards: result.salvagedShards
    }
})

const ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

function pickFloor(rolled: Rarity, floor: Rarity): Rarity {
    return ORDER.indexOf(rolled) >= ORDER.indexOf(floor) ? rolled : floor
}
