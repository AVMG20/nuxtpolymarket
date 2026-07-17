import { eq } from 'drizzle-orm'
import { requireUserId } from '#server/utils/auth'
import { debit, accumulateRake } from '#server/utils/balance'
import { startGame, toClientState } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions } from '#server/database/schema'
import { lockUserBalance, readUserBalance, settleFinishedHand } from '#server/utils/blackjack'
import { CASINO_MAX_BET } from '#shared/utils/limits'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { bet: rawBet } = await readBody<{ bet: number }>(event)
  const bet = Number(rawBet)

  if (!bet || bet < 1 || !Number.isFinite(bet) || bet > CASINO_MAX_BET) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid bet amount' })
  }

  return db.transaction(async (tx) => {
    // Locking the user row makes the active-session check, the debit and the
    // insert atomic, so two concurrent starts cannot both stake a bet.
    await lockUserBalance(tx, userId)

    // Check if user already has an active session (prevent starting new game while one is active)
    const existing = await tx.select().from(blackjackSessions).where(eq(blackjackSessions.userId, userId)).limit(1)
    if (existing.length > 0) {
      throw createError({ statusCode: 400, statusMessage: 'You already have an active blackjack game. Finish it first.' })
    }

    // Debit the bet upfront
    await debit(userId, bet.toFixed(4), 'blackjack', tx)
    await accumulateRake(userId, bet, tx)

    const result = startGame(bet)

    // If game finished immediately (e.g. blackjack), settle winnings/push now
    if (result.finished) {
      await settleFinishedHand(tx, userId, result)
    } else {
      // Persist active game to DB
      await tx.insert(blackjackSessions).values({
        userId,
        state: result.state,
        bet: bet.toFixed(4),
      })
    }

    return {
      clientState: toClientState(result.state),
      balance: await readUserBalance(tx, userId),
      finished: result.finished,
    }
  })
})
