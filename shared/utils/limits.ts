/** Shared upper bounds on money-moving inputs, enforced at the API boundary. */

/** Max bet for player-facing casino games (blackjack, play-game). */
export const CASINO_MAX_BET = 100_000_000_000

/** Max bet for the AI-tool blackjack endpoint — deliberately capped lower. */
export const AI_CASINO_MAX_BET = 1_000_000

/** Max amount for a single bank deposit or withdrawal. */
export const BANK_MAX_AMOUNT = 100_000_000_000_000
