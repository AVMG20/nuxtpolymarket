import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { gemMarketState, gemPriceHistory, user, transactions } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { GEM_MAX_GEMS_PER_TRADE, gemBuyGems, gemComputeLivePrice } from '#shared/utils/gamelogic/gem-market'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody(event)
    const gems = parseInt(body?.gems)
    if (!gems || gems < 1 || gems > GEM_MAX_GEMS_PER_TRADE) {
        throw createError({ statusCode: 400, statusMessage: `Buy between 1 and ${GEM_MAX_GEMS_PER_TRADE} gems` })
    }

    const userId = session.user.id
    let tradeResult: { cost: number, newPrice: number } | null = null

    await db.transaction(async (tx) => {
        // Acquire an exclusive row lock on the market state before reading the price.
        // Without this, concurrent requests all see the same stale price and every buy is
        // charged at the pre-burst rate — the slippage curve is bypassed entirely.
        const [state] = await tx.select().from(gemMarketState).for('update').limit(1)
        if (!state) throw createError({ statusCode: 500, statusMessage: 'Market not initialized' })

        const livePrice = gemComputeLivePrice(parseFloat(state.price), state.lastUpdatedAt)
        const { cost, newPrice } = gemBuyGems(livePrice, gems)
        tradeResult = { cost, newPrice }

        // Lock the user row so the balance check and debit are atomic with the gem grant.
        const [currentUser] = await tx.select({ balance: user.balance })
            .from(user)
            .where(eq(user.id, userId))
            .for('update')
        if (!currentUser || parseFloat(currentUser.balance) < cost) {
            throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })
        }

        await tx.insert(transactions).values({ userId, amount: cost.toFixed(4), type: 'debit', category: 'gem market' })
        await tx.update(user)
            .set({
                balance: sql`${user.balance} - ${cost.toFixed(4)}::numeric`,
                gems: sql`${user.gems} + ${gems}`
            })
            .where(eq(user.id, userId))

        await tx.update(gemMarketState)
            .set({ price: newPrice.toFixed(8), lastUpdatedAt: new Date() })

        await tx.insert(gemPriceHistory)
            .values({
                price: newPrice.toFixed(8),
                action: 'buy',
                userId,
                gems,
                totalAmount: cost.toFixed(4)
            })
    })

    return { ok: true, action: 'buy' as const, gems, ...tradeResult! }
})
