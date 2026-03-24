import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { gemMarketState, gemPriceHistory, user, transactions } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { GEM_MAX_GEMS_PER_TRADE, gemComputeLivePrice, gemApplySellImpact } from '#shared/utils/gem-market'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const gems = parseInt(body?.gems)
  if (!gems || gems < 1 || gems > GEM_MAX_GEMS_PER_TRADE) {
    throw createError({ statusCode: 400, statusMessage: `Sell between 1 and ${GEM_MAX_GEMS_PER_TRADE} gems` })
  }

  const userId = session.user.id

  await db.transaction(async (tx) => {
    // Check user has enough gems
    const currentUser = await tx.query.user.findFirst({
      where: eq(user.id, userId),
      columns: { gems: true },
    })
    if (!currentUser || currentUser.gems < gems) {
      throw createError({ statusCode: 400, statusMessage: 'Not enough gems' })
    }

    const state = await tx.query.gemMarketState.findFirst()
    if (!state) throw createError({ statusCode: 500, statusMessage: 'Market not initialized' })

    const livePrice = gemComputeLivePrice(parseFloat(state.price), state.lastUpdatedAt)
    const revenue = livePrice * gems
    const newPrice = gemApplySellImpact(livePrice, gems)

    // Deduct gems
    await tx.update(user).set({ gems: sql`${user.gems} - ${gems}` }).where(eq(user.id, userId))

    // Credit balance inline (avoids nested transaction deadlock)
    await tx.update(user)
      .set({ balance: sql`${user.balance} + ${revenue.toFixed(4)}::numeric` })
      .where(eq(user.id, userId))
    await tx.insert(transactions).values({ userId, amount: revenue.toFixed(4), type: 'credit', category: 'gem market' })

    // Update market price
    await tx.update(gemMarketState)
      .set({ price: newPrice.toFixed(8), lastUpdatedAt: new Date() })

    // Record history
    await tx.insert(gemPriceHistory).values({
      price: newPrice.toFixed(8),
      action: 'sell',
      userId,
      gems,
      totalAmount: revenue.toFixed(4),
    })
  })

  return { ok: true }
})
