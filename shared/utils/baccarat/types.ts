/** Wire protocol for the live baccarat table -- the TSeat/TShared/TAction slots of LiveTable. */
import type { LtCard } from '#shared/utils/live-table/types'
import type { BacBetKey, BacBets } from './payouts'
import type { BacWinner } from './rules'

export type { BacBetKey }

export interface BacSeatState {
    bets: BacBets
    /** Snapshot of the most recent round this seat actually staked -- REPEAT and a scale with nothing on the felt both fall back to it. */
    lastBets: BacBets
}

/** Mirrors LtShoeInfo without importing the server module into the shared layer. */
export interface BacShoeInfo {
    dealt: number
    total: number
    decks: number
    untilShuffle: number
}

/** One row of roadmap history -- the pair flags feed the bead plate's corner dots. */
export interface BacHistoryEntry {
    winner: BacWinner
    playerPair: boolean
    bankerPair: boolean
}

export interface BacRoundResult {
    playerCards: LtCard[]
    bankerCards: LtCard[]
    playerTotal: number
    bankerTotal: number
    winner: BacWinner
    playerNatural: boolean
    bankerNatural: boolean
    playerPair: boolean
    bankerPair: boolean
}

export interface BacSharedState {
    /** Null only before the first hand of a session has been dealt. */
    round: BacRoundResult | null
    history: BacHistoryEntry[]
    shoe: BacShoeInfo
}

export type BacAction =
    | { kind: 'bet', spot: BacBetKey, amount: number }
    | { kind: 'clear' }
    | { kind: 'repeat' }
    | { kind: 'scale', factor: number }
