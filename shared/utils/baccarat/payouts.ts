/** Pure payout resolution for the five baccarat bets. No table state involved. */
import type { BacWinner } from './rules'

/**
 * Banker pays less than even money -- the 5% commission is the only knob that
 * keeps its edge below Player's despite winning more often.
 */
export const BAC_PAYOUTS = {
    player: 1,
    banker: 0.95,
    tie: 8,
    playerPair: 11,
    bankerPair: 11
} as const

export interface BacBets {
    player: number
    banker: number
    tie: number
    playerPair: number
    bankerPair: number
}

export type BacBetKey = keyof BacBets

export const BAC_BET_KEYS: BacBetKey[] = ['player', 'banker', 'tie', 'playerPair', 'bankerPair']

export function emptyBets(): BacBets {
    return { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 }
}

export function totalStaked(bets: BacBets): number {
    return BAC_BET_KEYS.reduce((sum, key) => sum + bets[key], 0)
}

export interface BacOutcome {
    winner: BacWinner
    playerPair: boolean
    bankerPair: boolean
}

/** Money is a numeric(19,4) column; keep every derived amount on that grid. */
function round4(value: number): number {
    return Math.round(value * 10_000) / 10_000
}

/**
 * Resolve one seat's bets against the round outcome. Player and Banker bets
 * push on a tie -- the stake comes back, nothing won or lost -- while Tie and
 * the pair side bets are independent of what the main line did.
 */
export function resolveBets(bets: BacBets, outcome: BacOutcome): { staked: number, payout: number } {
    let staked = 0
    let payout = 0

    if (bets.player > 0) {
        staked += bets.player
        if (outcome.winner === 'player') payout += bets.player * (1 + BAC_PAYOUTS.player)
        else if (outcome.winner === 'tie') payout += bets.player
    }
    if (bets.banker > 0) {
        staked += bets.banker
        if (outcome.winner === 'banker') payout += bets.banker * (1 + BAC_PAYOUTS.banker)
        else if (outcome.winner === 'tie') payout += bets.banker
    }
    if (bets.tie > 0) {
        staked += bets.tie
        if (outcome.winner === 'tie') payout += bets.tie * (1 + BAC_PAYOUTS.tie)
    }
    if (bets.playerPair > 0) {
        staked += bets.playerPair
        if (outcome.playerPair) payout += bets.playerPair * (1 + BAC_PAYOUTS.playerPair)
    }
    if (bets.bankerPair > 0) {
        staked += bets.bankerPair
        if (outcome.bankerPair) payout += bets.bankerPair * (1 + BAC_PAYOUTS.bankerPair)
    }

    return { staked: round4(staked), payout: round4(payout) }
}
