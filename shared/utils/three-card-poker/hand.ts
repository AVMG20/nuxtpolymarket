import type { LtRank, LtSuit } from '#shared/utils/live-table/types'

/** A dealt, face-up card. The shoe always fills both fields. */
export interface TcpCard {
    rank: LtRank
    suit: LtSuit
}

export type TcpCategory = 'highCard' | 'pair' | 'flush' | 'straight' | 'trips' | 'straightFlush'

/**
 * Weakest to strongest. Three-card ranking is not five-card ranking: a straight
 * beats a flush here, because three cards make only 720 straights against 1096
 * flushes. Getting this backwards is the classic way to misbuild this game.
 */
export const TCP_CATEGORIES: readonly TcpCategory[] = [
    'highCard',
    'pair',
    'flush',
    'straight',
    'trips',
    'straightFlush'
]

export interface TcpHand {
    category: TcpCategory
    /** Index into TCP_CATEGORIES. Higher wins. */
    strength: number
    /** Tie-break values, most significant first. */
    values: number[]
    label: string
}

const RANK_VALUES: Record<LtRank, number> = {
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    10: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14
}

const RANK_NAMES: Record<number, string> = {
    2: 'Two',
    3: 'Three',
    4: 'Four',
    5: 'Five',
    6: 'Six',
    7: 'Seven',
    8: 'Eight',
    9: 'Nine',
    10: 'Ten',
    11: 'Jack',
    12: 'Queen',
    13: 'King',
    14: 'Ace'
}

const RANK_PLURALS: Record<number, string> = {
    2: 'Twos',
    3: 'Threes',
    4: 'Fours',
    5: 'Fives',
    6: 'Sixes',
    7: 'Sevens',
    8: 'Eights',
    9: 'Nines',
    10: 'Tens',
    11: 'Jacks',
    12: 'Queens',
    13: 'Kings',
    14: 'Aces'
}

/** The lowest hand the dealer can hold and still qualify. */
export const TCP_QUALIFY_VALUE = RANK_VALUES.Q

function straightHigh(high: number, mid: number, low: number): number | null {
    if (high - mid === 1 && mid - low === 1) return high
    // The ace plays low only in A-2-3, which is the lowest straight of all.
    if (high === 14 && mid === 3 && low === 2) return 3
    return null
}

function build(category: TcpCategory, values: number[], label: string): TcpHand {
    return { category, strength: TCP_CATEGORIES.indexOf(category), values, label }
}

export function evaluateHand(cards: readonly TcpCard[]): TcpHand {
    const values = cards.map(card => RANK_VALUES[card.rank]).sort((a, b) => b - a)
    const high = values[0]!
    const mid = values[1]!
    const low = values[2]!
    const flush = cards.every(card => card.suit === cards[0]!.suit)
    const run = straightHigh(high, mid, low)

    if (run !== null && flush) return build('straightFlush', [run], `Straight flush, ${RANK_NAMES[run]} high`)
    if (high === low) return build('trips', [high], `Three of a kind, ${RANK_PLURALS[high]}`)
    if (run !== null) return build('straight', [run], `Straight, ${RANK_NAMES[run]} high`)
    if (flush) return build('flush', [high, mid, low], `Flush, ${RANK_NAMES[high]} high`)
    if (high === mid) return build('pair', [high, low], `Pair of ${RANK_PLURALS[high]}`)
    if (mid === low) return build('pair', [mid, high], `Pair of ${RANK_PLURALS[mid]}`)
    return build('highCard', [high, mid, low], `${RANK_NAMES[high]}-${RANK_NAMES[mid]} high`)
}

/** Positive when `a` wins, negative when `b` does, zero on an exact tie. */
export function compareHands(a: TcpHand, b: TcpHand): number {
    if (a.strength !== b.strength) return a.strength - b.strength
    for (let i = 0; i < a.values.length; i++) {
        const diff = a.values[i]! - b.values[i]!
        if (diff !== 0) return diff
    }
    return 0
}

/** Queen high or better. Any pair or above qualifies outright. */
export function dealerQualifies(hand: TcpHand): boolean {
    return hand.category !== 'highCard' || hand.values[0]! >= TCP_QUALIFY_VALUE
}
