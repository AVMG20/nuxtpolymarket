import type { PocketColor } from '#shared/utils/roulette/wheel'

/**
 * A player's current-round bet slip: bet key -> amount staked on it.
 * Never reaches a client directly — a seatless table's `seats` array is
 * always empty, so this only exists server-side. The client's view of who
 * has bet what comes entirely from `RouletteSharedState.bets` below.
 */
export interface RouletteSeatState {
    bets: Record<string, number>
}

/** One player's chip on the felt, for rendering — never the player's name. */
export interface RouletteFeltBet {
    userId: string
    name: string
    color: string
    key: string
    amount: number
}

export interface RouletteSharedState {
    /** Most recent winning number first. */
    lastNumbers: number[]
    /** Set the moment the wheel is spun, cleared when the next betting phase opens. */
    result: number | null
    bets: RouletteFeltBet[]
    /**
     * Players who have voted to start this round early. A seatless table never
     * populates `LtTableState.seats`, so this is the only place `votedStart`
     * reaches the client.
     */
    votes: { userId: string, name: string }[]
    /** How many players would have to vote for the round to start now. */
    votesTotal: number
}

export type RouletteAction =
    | { type: 'bet', key: string, amount: number }
    | { type: 'undo' }
    | { type: 'repeat' }
    | { type: 'scale', factor: 0.5 | 2 }
    | { type: 'clear' }

/** One-shot events for the sidebar feed — the only place a roulette player's name appears. */
export type RouletteGameEvent =
    | { type: 'bet', name: string, color: string, key: string, amount: number }
    | { type: 'spin', number: number, color: PocketColor }
    | { type: 'result', winningNumber: number, results: { userId: string, name: string, net: number }[] }
