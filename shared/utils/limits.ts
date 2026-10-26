/** Shared upper bounds on money-moving inputs, enforced at the API boundary. */

/** Max bet for player-facing casino games (live blackjack, play-game). */
export const CASINO_MAX_BET = 100_000_000_000

/** Max amount for a single bank deposit or withdrawal. */
export const BANK_MAX_AMOUNT = 100_000_000_000_000

/** Max coins and gems in a single player-to-player gift. */
export const GIFT_MAX_COINS = 100_000_000_000_000
export const GIFT_MAX_GEMS = 1_000_000_000
