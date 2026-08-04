import type { PocketColor } from '#shared/utils/roulette/wheel'

/** A player's current-round bet slip: bet key -> amount staked on it. */
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
}

export type RouletteAction = { type: 'bet', key: string, amount: number }

/** One-shot events for the sidebar feed — the only place a roulette player's name appears. */
export type RouletteGameEvent =
    | { type: 'bet', name: string, color: string, key: string, amount: number }
    | { type: 'spin', number: number, color: PocketColor }
    | { type: 'result', winningNumber: number, results: { name: string, net: number }[] }
