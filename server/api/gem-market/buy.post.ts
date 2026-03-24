import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { gemMarketState, gemPriceHistory, user, transactions } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { GEM_MAX_GEMS_PER_TRADE, gemComputeLivePrice, gemApplyBuyImpact } from '#shared/utils/gem-market'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const gems = parseInt(body?.gems)
  if (!gems || gems < 1 || gems > GEM_MAX_GEMS_PER_TRADE) {
    throw createError({ statusCode: 400, statusMessage: `Buy between 1 and ${GEM_MAX_GEMS_PER_TRADE} gems` })
  }

  const userId = session.user.id

  await db.transaction(async (tx) => {
    const state = await tx.query.gemMarketState.findFirst()
    if (!state) throw createError({ statusCode: 500, statusMessage: 'Market not initialized' })

    const livePrice = gemComputeLivePrice(parseFloat(state.price), state.lastUpdatedAt)
    const cost = livePrice * gems
    const newPrice = gemApplyBuyImpact(livePrice, gems)

    // Check and debit balance inline (avoids nested transaction deadlock)
    const currentUser = await tx.query.user.findFirst({ where: eq(user.id, userId), columns: { balance: true } })
    if (!currentUser || parseFloat(currentUser.balance) < cost) {
      throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })
    }
    await tx.update(user)
      .set({ balance: sql`${user.balance} - ${cost.toFixed(4)}::numeric` })
      .where(eq(user.id, userId))
    await tx.insert(transactions).values({ userId, amount: cost.toFixed(4), type: 'debit', category: 'gem market' })

    // Credit gems
    await tx.update(user).set({ gems: sql`${user.gems} + ${gems}` }).where(eq(user.id, userId))

    // Update market price
    await tx.update(gemMarketState)
      .set({ price: newPrice.toFixed(8), lastUpdatedAt: new Date() })

    // Record history
    await tx.insert(gemPriceHistory).values({
      price: newPrice.toFixed(8),
      action: 'buy',
      userId,
      gems,
      totalAmount: cost.toFixed(4),
    })
  })

  return { ok: true }
})
