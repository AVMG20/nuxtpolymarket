import { eq } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { debit, credit, getBalance, accumulateRake } from '#server/utils/balance'
import { signGameState } from '#server/utils/game-token'
import { startGame, toClientState } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { bet: rawBet } = await readBody<{ bet: number }>(event)
  const bet = Number(rawBet)

  if (!bet || bet < 1 || !Number.isFinite(bet) || bet > 1_000_000) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid bet amount' })
  }

  // Check if user already has an active session (prevent starting new game while one is active)
  const existing = await db.select().from(blackjackSessions).where(eq(blackjackSessions.userId, session.user.id)).limit(1)
  if (existing.length > 0) {
    throw createError({ statusCode: 400, statusMessage: 'You already have an active blackjack game. Finish it first.' })
  }

  const balance = await getBalance(session.user.id)
  if (parseFloat(balance) < bet) {
    throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })
  }

  // Debit the bet upfront
  await debit(session.user.id, bet.toFixed(4), 'blackjack')
  await accumulateRake(session.user.id, bet)

  const result = startGame(bet)

  // If game finished immediately (e.g. blackjack), credit winnings
  if (result.finished && result.netPayout > 0) {
    await credit(session.user.id, (bet + result.netPayout).toFixed(4), 'blackjack')
  } else if (result.finished && result.netPayout === 0) {
    // Push on immediate blackjack vs dealer blackjack - return bet
    await credit(session.user.id, bet.toFixed(4), 'blackjack')
  }

  const newBalance = parseFloat(await getBalance(session.user.id))
  const token = result.finished ? null : signGameState({ state: result.state, bet, userId: session.user.id })

  // Persist active game to DB
  if (!result.finished && token) {
    await db.insert(blackjackSessions).values({
      userId: session.user.id,
      state: result.state,
      bet: bet.toFixed(4),
      token,
    })
  }

  return {
    clientState: toClientState(result.state),
    token,
    balance: newBalance,
    finished: result.finished,
  }
})
