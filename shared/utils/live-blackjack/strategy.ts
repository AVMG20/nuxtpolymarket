import { canDouble, canSplit, handScore, rankValue } from './rules'
import type { LbAction, LbHand, LbRank } from './types'

/**
 * Basic strategy for this table's rules (6 decks, dealer stands on all 17,
 * double after split allowed). Shared so the hint button and the headless bot
 * cannot drift apart in what they call correct play.
 */

function pairAdvice(rank: LbRank, up: number): LbAction | null {
    const pair = rankValue(rank)
    if (rank === 'A' || pair === 8) return 'split'
    if (pair === 10) return 'stand'
    if (pair === 9) return up === 7 || up >= 10 ? 'stand' : 'split'
    if (pair === 7) return up <= 7 ? 'split' : null
    if (pair === 6) return up <= 6 ? 'split' : null
    if (pair === 4) return up === 5 || up === 6 ? 'split' : null
    if (pair === 2 || pair === 3) return up <= 7 ? 'split' : null
    return null
}

function softAdvice(total: number, up: number): LbAction {
    if (total >= 19) return 'stand'
    if (total === 18) {
        if (up >= 3 && up <= 6) return 'double'
        return up <= 8 ? 'stand' : 'hit'
    }
    if (total === 17) return up >= 3 && up <= 6 ? 'double' : 'hit'
    if (total >= 15) return up >= 4 && up <= 6 ? 'double' : 'hit'
    return up >= 5 && up <= 6 ? 'double' : 'hit'
}

function hardAdvice(total: number, up: number): LbAction {
    if (total >= 17) return 'stand'
    if (total >= 13) return up <= 6 ? 'stand' : 'hit'
    if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit'
    if (total === 11) return 'double'
    if (total === 10) return up <= 9 ? 'double' : 'hit'
    if (total === 9) return up >= 3 && up <= 6 ? 'double' : 'hit'
    return 'hit'
}

/**
 * The play basic strategy calls for, already narrowed to what this player can
 * actually afford and the rules allow — so a hint never points at a disabled
 * button.
 */
export function basicStrategy(
    hand: LbHand,
    dealerUpcard: LbRank,
    seatHands: LbHand[],
    balance: number
): LbAction {
    const up = rankValue(dealerUpcard)
    const { total, soft } = handScore(hand.cards)

    const [first, second] = hand.cards
    if (hand.cards.length === 2 && first?.rank && second?.rank
        && rankValue(first.rank) === rankValue(second.rank)) {
        const advice = pairAdvice(first.rank, up)
        if (advice === 'split' && canSplit(hand, seatHands) && balance >= hand.bet) return 'split'
        if (advice === 'stand') return 'stand'
    }

    const want = soft ? softAdvice(total, up) : hardAdvice(total, up)
    // The strategy card's own fallback for when doubling is off the table.
    if (want === 'double' && !(canDouble(hand) && balance >= hand.bet)) {
        if (soft && total === 18) return up <= 8 ? 'stand' : 'hit'
        if (!soft && total >= 12) return up <= 6 ? 'stand' : 'hit'
        return 'hit'
    }
    return want
}
