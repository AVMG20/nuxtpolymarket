import { eq } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { debit, credit, accumulateRake } from '#server/utils/balance'
import { performAction, toClientState } from '#shared/utils/gamelogic/blackjack'
import type { BlackjackState, BlackjackAction } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions, user } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { action } = await readBody<{ action: BlackjackAction }>(event)

  if (!action) {
    throw createError({ statusCode: 400, statusMessage: 'Missing action' })
  }

  const userId = session.user.id

  return db.transaction(async (tx) => {
    // Locking the user row serialises every blackjack write for this player, so a
    // finished hand is settled and deleted exactly once.
    const [currentUser] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId)).for('update')
    const balance = parseFloat(currentUser!.balance)

    // Load game state from DB
    const rows = await tx.select().from(blackjackSessions).where(eq(blackjackSessions.userId, userId)).limit(1)
    if (rows.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'No active blackjack game' })
    }

    const gameSession = rows[0]!
    const state = gameSession.state as BlackjackState
    const bet = parseFloat(gameSession.bet)

    // Handle extra costs for double and split (need to debit additional bet)
    const hand = state.playerHands[state.currentHandIndex]
    if (action === 'double' && hand) {
      if (balance < hand.bet) {
        throw createError({ statusCode: 400, statusMessage: 'Insufficient balance to double down' })
      }
      await debit(userId, hand.bet.toFixed(4), 'blackjack', tx)
      await accumulateRake(userId, hand.bet, tx)
    }

    if (action === 'split' && hand) {
      if (balance < hand.bet) {
        throw createError({ statusCode: 400, statusMessage: 'Insufficient balance to split' })
      }
      await debit(userId, hand.bet.toFixed(4), 'blackjack', tx)
      await accumulateRake(userId, hand.bet, tx)
    }

    if (action === 'insurance' && hand) {
      const cost = state.playerHands[0]!.bet / 2
      if (balance < cost) {
        throw createError({ statusCode: 400, statusMessage: 'Insufficient balance for insurance' })
      }
      await debit(userId, cost.toFixed(4), 'blackjack', tx)
      await accumulateRake(userId, cost, tx)
    }

    const result = performAction(state, action, bet)

    // If game finished, settle balance and remove DB session
    if (result.finished) {
      const totalBets = result.state.playerHands.reduce((sum, h) => sum + h.bet, 0) + result.state.insuranceBet
      const totalPayout = totalBets + result.netPayout
      if (totalPayout > 0) {
        await credit(userId, totalPayout.toFixed(4), 'blackjack', tx)
      }
      await tx.delete(blackjackSessions).where(eq(blackjackSessions.userId, userId))
    } else {
      await tx.update(blackjackSessions)
        .set({ state: result.state })
        .where(eq(blackjackSessions.userId, userId))
    }

    const [settled] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId))

    return {
      clientState: toClientState(result.state),
      balance: parseFloat(settled!.balance),
      finished: result.finished,
    }
  })
})
