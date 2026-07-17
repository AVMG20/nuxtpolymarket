import { eq } from 'drizzle-orm'
import { requireUserId } from '#server/utils/auth'
import { debit, accumulateRake } from '#server/utils/balance'
import { performAction, toClientState } from '#shared/utils/gamelogic/blackjack'
import type { BlackjackState, BlackjackAction } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions } from '#server/database/schema'
import { lockUserBalance, readUserBalance, settleFinishedHand } from '#server/utils/blackjack'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { action } = await readBody<{ action: BlackjackAction }>(event)

  if (!action) {
    throw createError({ statusCode: 400, statusMessage: 'Missing action' })
  }

  return db.transaction(async (tx) => {
    // Locking the user row serialises every blackjack write for this player, so a
    // finished hand is settled and deleted exactly once.
    const balance = await lockUserBalance(tx, userId)

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
      await settleFinishedHand(tx, userId, result)
    } else {
      await tx.update(blackjackSessions)
        .set({ state: result.state })
        .where(eq(blackjackSessions.userId, userId))
    }

    return {
      clientState: toClientState(result.state),
      balance: await readUserBalance(tx, userId),
      finished: result.finished,
    }
  })
})
