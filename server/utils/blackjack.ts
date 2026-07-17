import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { blackjackSessions, user } from '#server/database/schema'
import { credit } from '#server/utils/balance'
import type { BlackjackResult } from '#shared/utils/gamelogic/blackjack'

/** Locks the user row for the duration of the transaction; returns the balance at lock time. */
export async function lockUserBalance(tx: DbExecutor, userId: string) {
  const [row] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId)).for('update')
  return parseFloat(row!.balance)
}

export async function readUserBalance(tx: DbExecutor, userId: string) {
  const [row] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
  return parseFloat(row!.balance)
}

/** Pays out a finished hand and clears its session row. Safe to call even if no row exists (deletes 0). */
export async function settleFinishedHand(tx: DbExecutor, userId: string, result: Pick<BlackjackResult, 'state' | 'netPayout'>) {
  const totalBets = result.state.playerHands.reduce((sum, hand) => sum + hand.bet, 0) + result.state.insuranceBet
  const payout = totalBets + result.netPayout
  if (payout > 0) await credit(userId, payout.toFixed(4), 'blackjack', tx)
  await tx.delete(blackjackSessions).where(eq(blackjackSessions.userId, userId))
  return { totalBets, payout }
}
