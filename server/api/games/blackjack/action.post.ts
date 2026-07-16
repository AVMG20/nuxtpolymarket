import { eq } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { debit, credit, getBalance, accumulateRake } from '#server/utils/balance'
import { performAction, toClientState } from '#shared/utils/gamelogic/blackjack'
import type { BlackjackState, BlackjackAction } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { action } = await readBody<{ action: BlackjackAction }>(event)

  if (!action) {
    throw createError({ statusCode: 400, statusMessage: 'Missing action' })
  }

  // Load game state from DB
  const rows = await db.select().from(blackjackSessions).where(eq(blackjackSessions.userId, session.user.id)).limit(1)
  if (rows.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No active blackjack game' })
  }

  const gameSession = rows[0]!
  const state = gameSession.state as BlackjackState
  const bet = parseFloat(gameSession.bet)

  // Handle extra costs for double and split (need to debit additional bet)
  const hand = state.playerHands[state.currentHandIndex]
  if (action === 'double' && hand) {
    const balance = await getBalance(session.user.id)
    if (parseFloat(balance) < hand.bet) {
      throw createError({ statusCode: 400, statusMessage: 'Insufficient balance to double down' })
    }
    await debit(session.user.id, hand.bet.toFixed(4), 'blackjack')
    await accumulateRake(session.user.id, hand.bet)
  }

  if (action === 'split' && hand) {
    const balance = await getBalance(session.user.id)
    if (parseFloat(balance) < hand.bet) {
      throw createError({ statusCode: 400, statusMessage: 'Insufficient balance to split' })
    }
    await debit(session.user.id, hand.bet.toFixed(4), 'blackjack')
    await accumulateRake(session.user.id, hand.bet)
  }

  if (action === 'insurance' && hand) {
    const cost = state.playerHands[0]!.bet / 2
    const balance = await getBalance(session.user.id)
    if (parseFloat(balance) < cost) {
      throw createError({ statusCode: 400, statusMessage: 'Insufficient balance for insurance' })
    }
    await debit(session.user.id, cost.toFixed(4), 'blackjack')
    await accumulateRake(session.user.id, cost)
  }

  const result = performAction(state, action, bet)

  // If game finished, settle balance and remove DB session
  if (result.finished) {
    const totalBets = result.state.playerHands.reduce((sum, h) => sum + h.bet, 0) + result.state.insuranceBet
    const totalPayout = totalBets + result.netPayout
    if (totalPayout > 0) {
      await credit(session.user.id, totalPayout.toFixed(4), 'blackjack', false)
    }
    await db.delete(blackjackSessions).where(eq(blackjackSessions.userId, session.user.id))
  } else {
    await db.update(blackjackSessions)
      .set({ state: result.state })
      .where(eq(blackjackSessions.userId, session.user.id))
  }

  const newBalance = parseFloat(await getBalance(session.user.id))

  return {
    clientState: toClientState(result.state),
    balance: newBalance,
    finished: result.finished,
  }
})
