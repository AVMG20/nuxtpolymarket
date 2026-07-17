import { eq } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { debit, credit, accumulateRake } from '#server/utils/balance'
import { startGame, toClientState } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions, user } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { bet: rawBet } = await readBody<{ bet: number }>(event)
  const bet = Number(rawBet)

  if (!bet || bet < 1 || !Number.isFinite(bet) || bet > 100_000_000_000) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid bet amount' })
  }

  const userId = session.user.id

  return db.transaction(async (tx) => {
    // Locking the user row makes the active-session check, the debit and the
    // insert atomic, so two concurrent starts cannot both stake a bet.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update')

    // Check if user already has an active session (prevent starting new game while one is active)
    const existing = await tx.select().from(blackjackSessions).where(eq(blackjackSessions.userId, userId)).limit(1)
    if (existing.length > 0) {
      throw createError({ statusCode: 400, statusMessage: 'You already have an active blackjack game. Finish it first.' })
    }

    // Debit the bet upfront
    await debit(userId, bet.toFixed(4), 'blackjack', tx)
    await accumulateRake(userId, bet, tx)

    const result = startGame(bet)

    // If game finished immediately (e.g. blackjack), credit winnings
    if (result.finished && result.netPayout > 0) {
      await credit(userId, (bet + result.netPayout).toFixed(4), 'blackjack', tx)
    } else if (result.finished && result.netPayout === 0) {
      // Push on immediate blackjack vs dealer blackjack - return bet
      await credit(userId, bet.toFixed(4), 'blackjack', tx)
    }

    // Persist active game to DB
    if (!result.finished) {
      await tx.insert(blackjackSessions).values({
        userId,
        state: result.state,
        bet: bet.toFixed(4),
      })
    }

    const [settled] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId))

    return {
      clientState: toClientState(result.state),
      balance: parseFloat(settled!.balance),
      finished: result.finished,
    }
  })
})
