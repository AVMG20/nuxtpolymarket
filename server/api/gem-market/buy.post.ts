import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { gemMarketState, gemPriceHistory, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { GEM_MAX_GEMS_PER_TRADE, gemBuyGems, gemComputeLivePrice } from '#shared/utils/gamelogic/gem-market'
import { debit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody(event)
    const gems = parseInt(body?.gems)
    if (!gems || gems < 1 || gems > GEM_MAX_GEMS_PER_TRADE) {
        throw createError({ statusCode: 400, statusMessage: `Buy between 1 and ${GEM_MAX_GEMS_PER_TRADE} gems` })
    }

    const userId = session.user.id

    const state = await db.query.gemMarketState.findFirst()
    if (!state) throw createError({ statusCode: 500, statusMessage: 'Market not initialized' })

    const livePrice = gemComputeLivePrice(parseFloat(state.price), state.lastUpdatedAt)
    const { cost, newPrice } = gemBuyGems(livePrice, gems)

    // Debit balance (handles insufficient balance check + transaction record)
    await debit(userId, cost.toFixed(4), 'gem market')

    // Credit gems + update market in a transaction
    await db.transaction(async (tx) => {
        await tx.update(user)
            .set({ gems: sql`${user.gems} + ${gems}` })
            .where(eq(user.id, userId))

        await tx.update(gemMarketState)
            .set({ price: newPrice.toFixed(8), lastUpdatedAt: new Date() })

        await tx.insert(gemPriceHistory)
            .values({
                price: newPrice.toFixed(8),
                action: 'buy',
                userId,
                gems,
                totalAmount: cost.toFixed(4),
            })
    })

    return { ok: true }
})
