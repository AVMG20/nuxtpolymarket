/** Wire protocol for the Casino Hold'em table. */
import type { LtCard } from '#shared/utils/live-table/types'

export type ChDecision = 'call' | 'fold'

export type ChOutcome = 'win' | 'lose' | 'push' | 'folded'

export type ChBetSpot = 'ante' | 'aa'

export interface ChSeatState {
    /** Chips on the layout that have not been staked yet. */
    pendingAnte: number
    pendingAa: number
    /** Staked for the round in play. */
    ante: number
    aa: number
    call: number
    lastAnte: number
    lastAa: number
    cards: LtCard[]
    decision: ChDecision | null
    /** Best five-card hand, filled in at the showdown. */
    handLabel: string | null
    outcome: ChOutcome | null
    /** Copied onto the seat so a settled round can still explain its own payout. */
    dealerQualified: boolean | null
    net: number | null
    aaLabel: string | null
    aaMultiplier: number | null
}

export interface ChSharedState {
    /** Flop, then turn and river as they are dealt. */
    board: LtCard[]
    dealer: {
        cards: LtCard[]
        label: string | null
        qualified: boolean | null
    }
}

export type ChAction =
    | { t: 'bet', spot: ChBetSpot, amount: number }
    | { t: 'undo' }
    | { t: 'clear' }
    | { t: 'repeat' }
    | { t: 'scale', factor: number }
    | { t: 'decide', decision: ChDecision }
