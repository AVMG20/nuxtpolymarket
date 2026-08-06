/** Wire protocol for the three card poker table, riding in LiveTable's generics. */

import type { LtCard } from '#shared/utils/live-table/types'
import type { TcpCategory } from './hand'
import type { TcpAnteBonusTier, TcpAnteResult, TcpPairPlusTier, TcpPlayResult } from './payouts'

export type TcpSpot = 'ante' | 'pairPlus'
export type TcpDecision = 'play' | 'fold'

/** What the client needs off an evaluated hand — the felt shows the label. */
export interface TcpHandView {
    category: TcpCategory
    label: string
}

export interface TcpSeatResult {
    net: number
    dealerQualified: boolean
    ante: TcpAnteResult
    play: TcpPlayResult
    anteBonusTier: TcpAnteBonusTier | null
    anteBonusPayout: number
    pairPlusTier: TcpPairPlusTier | null
    pairPlusPayout: number
}

export interface TcpSeatState {
    /** Chips on the layout during betting. Not money until the deal stakes them. */
    pendingAnte: number
    pendingPairPlus: number
    /** Placement order, so undo can take back one chip rather than the lot. */
    placed: { spot: TcpSpot, amount: number }[]
    ante: number
    pairPlus: number
    play: number
    lastAnte: number
    lastPairPlus: number
    cards: LtCard[]
    hand: TcpHandView | null
    decision: TcpDecision | null
    result: TcpSeatResult | null
}

export interface TcpSharedState {
    dealer: {
        cards: LtCard[]
        /** Null until the showdown — the hole cards are redacted before then. */
        hand: TcpHandView | null
        qualified: boolean | null
    }
}

export type TcpAction =
    | { t: 'bet', spot: TcpSpot, amount: number }
    | { t: 'undo' }
    | { t: 'clear' }
    | { t: 'repeat' }
    | { t: 'scale', factor: number }
    | { t: 'decide', play: boolean }
