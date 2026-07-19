/** Shared upper bounds on money-moving inputs, enforced at the API boundary. */

/** Max bet for player-facing casino games (blackjack, play-game). */
export const CASINO_MAX_BET = 100_000_000_000

/**
 * Hard ceiling on any single AI-placed wager (blackjack, casino rounds). Matches
 * manual play. The per-account guard max-bet only gates auto-run below this; a
 * player can still manually approve wagers up to this cap.
 */
export const AI_CASINO_MAX_BET = CASINO_MAX_BET

/**
 * Max rounds/hands per AI auto-play batch call (blackjack and every casino round
 * tool). Each round is a sequential request settled in its own transaction, so
 * this bounds how long one tool call can keep the server busy.
 */
export const AI_MAX_ROUNDS = 200

/** Max amount for a single bank deposit or withdrawal. */
export const BANK_MAX_AMOUNT = 100_000_000_000_000
