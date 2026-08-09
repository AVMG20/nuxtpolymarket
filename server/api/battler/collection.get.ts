import { requireUserId } from '#server/utils/auth'
import { eligibleHoldings } from '#server/utils/battler/run'
import { unitCostFor } from '#shared/utils/battler/shop'

/** Deck-builder data: every battle-ready card the caller owns. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const holdings = await eligibleHoldings(userId)
    return holdings.map(holding => ({
        cardId: holding.cardId,
        name: holding.name,
        copies: holding.copies,
        cost: unitCostFor(holding.rarity),
        hp: holding.spec.hp,
        type: holding.spec.type,
        bounty: holding.spec.bounty,
        render: holding.render
    }))
})
