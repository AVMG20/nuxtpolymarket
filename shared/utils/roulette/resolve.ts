/**
 * Pure settlement: no table state, no randomness. The winning number is
 * already decided by the caller — this only prices what was staked against it.
 */
import { getBet, ROULETTE_PAYOUTS } from '#shared/utils/roulette/layout'

export interface PlacedBet {
    key: string
    amount: number
}

export interface ResolvedBet extends PlacedBet {
    won: boolean
    /** Total returned, stake included on a win. Zero on a loss. */
    payout: number
}

export interface ResolveResult {
    totalStaked: number
    totalPayout: number
    bets: ResolvedBet[]
}

export function resolveBets(placed: PlacedBet[], winningNumber: number): ResolveResult {
    let totalStaked = 0
    let totalPayout = 0
    const bets: ResolvedBet[] = []

    for (const { key, amount } of placed) {
        const bet = getBet(key)
        if (!bet) continue
        totalStaked += amount
        const won = bet.numbers.includes(winningNumber)
        const payout = won ? amount * (ROULETTE_PAYOUTS[bet.type] + 1) : 0
        totalPayout += payout
        bets.push({ key, amount, won, payout })
    }

    return { totalStaked, totalPayout, bets }
}
