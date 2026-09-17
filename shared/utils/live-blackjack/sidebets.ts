import type { LbBetSpot, LbCard, LbRank, LbSideBetKey, LbSideBetResult, LbSuit } from './types'

/**
 * Side bets settle off the opening deal alone — the player's two cards and the
 * dealer's upcard — so they are resolved and paid before anyone acts. Nothing
 * here depends on how the hand is played, which is what keeps them independent
 * of the base game's RTP.
 */

export const LB_SIDE_BETS: LbSideBetKey[] = ['perfectPairs', 'twentyOnePlusThree']

export const LB_SIDE_BET_LABELS: Record<LbSideBetKey, string> = {
    perfectPairs: 'Perfect Pairs',
    twentyOnePlusThree: '21+3'
}

/**
 * The spot a chip is going on arrives off a socket, where its type guarantees
 * nothing. Anything else would be written straight onto the seat's side bets as
 * a key nobody ever reads back.
 */
export function isBetSpot(value: unknown): value is LbBetSpot {
    return value === 'main' || (LB_SIDE_BETS as string[]).includes(value as string)
}

export type LbPerfectPairsTier = 'perfect' | 'coloured' | 'mixed'

export type LbTwentyOnePlusThreeTier =
    | 'suitedTrips'
    | 'straightFlush'
    | 'trips'
    | 'straight'
    | 'flush'

/** Multiples of the side bet, paid on top of the returned stake. */
export const LB_PERFECT_PAIRS_PAYS: Record<LbPerfectPairsTier, number> = {
    perfect: 25,
    coloured: 12,
    mixed: 6
}

export const LB_21P3_PAYS: Record<LbTwentyOnePlusThreeTier, number> = {
    suitedTrips: 100,
    straightFlush: 40,
    trips: 30,
    straight: 10,
    flush: 5
}

export const LB_PERFECT_PAIRS_LABELS: Record<LbPerfectPairsTier, string> = {
    perfect: 'Perfect pair',
    coloured: 'Coloured pair',
    mixed: 'Mixed pair'
}

export const LB_21P3_LABELS: Record<LbTwentyOnePlusThreeTier, string> = {
    suitedTrips: 'Suited three of a kind',
    straightFlush: 'Straight flush',
    trips: 'Three of a kind',
    straight: 'Straight',
    flush: 'Flush'
}

const RED_SUITS: LbSuit[] = ['hearts', 'diamonds']

const isRed = (suit: LbSuit) => RED_SUITS.includes(suit)

export function perfectPairsTier(a: LbCard, b: LbCard): LbPerfectPairsTier | null {
    if (!a.rank || !b.rank || !a.suit || !b.suit) return null
    if (a.rank !== b.rank) return null
    if (a.suit === b.suit) return 'perfect'
    return isRed(a.suit) === isRed(b.suit) ? 'coloured' : 'mixed'
}

// Ace is deliberately allowed at both ends, so A-2-3 and Q-K-A both play.
const STRAIGHT_ORDER: LbRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

function isRun(values: number[]): boolean {
    const [a, b, c] = [...values].sort((x, y) => x - y)
    return b === a! + 1 && c === b! + 1
}

function isStraight(ranks: LbRank[]): boolean {
    const low = ranks.map(r => STRAIGHT_ORDER.indexOf(r) + 1)
    if (isRun(low)) return true
    const high = ranks.map(r => (r === 'A' ? 14 : STRAIGHT_ORDER.indexOf(r) + 1))
    return isRun(high)
}

export function twentyOnePlusThreeTier(
    a: LbCard,
    b: LbCard,
    upcard: LbCard
): LbTwentyOnePlusThreeTier | null {
    const cards = [a, b, upcard]
    if (cards.some(c => !c.rank || !c.suit)) return null

    const ranks = cards.map(c => c.rank!)
    const suits = cards.map(c => c.suit!)
    const flush = suits[0] === suits[1] && suits[1] === suits[2]
    const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2]

    if (trips && flush) return 'suitedTrips'
    const straight = isStraight(ranks)
    if (straight && flush) return 'straightFlush'
    if (trips) return 'trips'
    if (straight) return 'straight'
    if (flush) return 'flush'
    return null
}

/**
 * Resolve one seat's side bets. A stake of zero still returns a row so the
 * client can render an empty spot without special-casing it.
 */
export function settleSideBets(
    stakes: Record<LbSideBetKey, number>,
    playerCards: LbCard[],
    upcard: LbCard
): LbSideBetResult[] {
    const [first, second] = playerCards
    const results: LbSideBetResult[] = []

    const pp = first && second ? perfectPairsTier(first, second) : null
    results.push({
        key: 'perfectPairs',
        stake: stakes.perfectPairs,
        tier: pp,
        label: pp ? LB_PERFECT_PAIRS_LABELS[pp] : null,
        multiplier: pp ? LB_PERFECT_PAIRS_PAYS[pp] : 0,
        payout: pp ? stakes.perfectPairs * (1 + LB_PERFECT_PAIRS_PAYS[pp]) : 0
    })

    const tp = first && second ? twentyOnePlusThreeTier(first, second, upcard) : null
    results.push({
        key: 'twentyOnePlusThree',
        stake: stakes.twentyOnePlusThree,
        tier: tp,
        label: tp ? LB_21P3_LABELS[tp] : null,
        multiplier: tp ? LB_21P3_PAYS[tp] : 0,
        payout: tp ? stakes.twentyOnePlusThree * (1 + LB_21P3_PAYS[tp]) : 0
    })

    return results
}
