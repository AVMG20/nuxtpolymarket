import { eq } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { debit, credit, getBalance } from '#server/utils/balance'
import { signGameState, verifyGameState } from '#server/utils/game-token'
import { performAction, toClientState } from '#shared/utils/gamelogic/blackjack'
import type { BlackjackState, BlackjackAction } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions } from '#server/database/schema'

interface TokenPayload {
  state: BlackjackState
  bet: number
  userId: string
}

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { token, action } = await readBody<{ token: string; action: BlackjackAction }>(event)

  if (!token || !action) {
    throw createError({ statusCode: 400, statusMessage: 'Missing token or action' })
  }

  const payload = verifyGameState<TokenPayload>(token)

  if (payload.userId !== session.user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Token does not belong to this user' })
  }

  // Handle extra costs for double and split (need to debit additional bet)
  const hand = payload.state.playerHands[payload.state.currentHandIndex]
  if (action === 'double' && hand) {
    const balance = await getBalance(session.user.id)
    if (parseFloat(balance) < hand.bet) {
      throw createError({ statusCode: 400, statusMessage: 'Insufficient balance to double down' })
    }
    await debit(session.user.id, hand.bet.toFixed(4), 'blackjack')
  }

  if (action === 'split' && hand) {
    const balance = await getBalance(session.user.id)
    if (parseFloat(balance) < hand.bet) {
      throw createError({ statusCode: 400, statusMessage: 'Insufficient balance to split' })
    }
    await debit(session.user.id, hand.bet.toFixed(4), 'blackjack')
  }

  if (action === 'insurance' && hand) {
    const cost = payload.state.playerHands[0]!.bet / 2
    const balance = await getBalance(session.user.id)
    if (parseFloat(balance) < cost) {
      throw createError({ statusCode: 400, statusMessage: 'Insufficient balance for insurance' })
    }
    await debit(session.user.id, cost.toFixed(4), 'blackjack')
  }

  const result = performAction(payload.state, action, payload.bet)

  // If game finished, settle balance and remove DB session
  if (result.finished) {
    const totalBets = result.state.playerHands.reduce((sum, h) => sum + h.bet, 0) + result.state.insuranceBet
    const totalPayout = totalBets + result.netPayout
    if (totalPayout > 0) {
      await credit(session.user.id, totalPayout.toFixed(4), 'blackjack')
    }
    // Remove active session from DB
    await db.delete(blackjackSessions).where(eq(blackjackSessions.userId, session.user.id))
  } else {
    // Update DB session with new state and token
    const newToken = signGameState({ state: result.state, bet: payload.bet, userId: session.user.id })
    await db.update(blackjackSessions)
      .set({ state: result.state, token: newToken })
      .where(eq(blackjackSessions.userId, session.user.id))

    const newBalance = parseFloat(await getBalance(session.user.id))
    return {
      clientState: toClientState(result.state),
      token: newToken,
      balance: newBalance,
      finished: false,
    }
  }

  const newBalance = parseFloat(await getBalance(session.user.id))

  return {
    clientState: toClientState(result.state),
    token: null,
    balance: newBalance,
    finished: result.finished,
  }
})
