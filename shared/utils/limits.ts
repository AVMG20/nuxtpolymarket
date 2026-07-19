/** Shared upper bounds on money-moving inputs, enforced at the API boundary. */

/** Max bet for player-facing casino games (blackjack, play-game). */
export const CASINO_MAX_BET = 100_000_000_000

/**
 * Hard ceiling on any single AI-placed wager (blackjack, casino rounds). Matches
 * manual play. The per-account guard max-bet only gates auto-run below this; a
 * player can still manually approve wagers up to this cap.
 */
export const AI_CASINO_MAX_BET = CASINO_MAX_BET

/** Max amount for a single bank deposit or withdrawal. */
export const BANK_MAX_AMOUNT = 100_000_000_000_000
