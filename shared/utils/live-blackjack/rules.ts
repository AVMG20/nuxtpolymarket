import type { LbCard, LbHand, LbRank } from './types'

/** House rules for the live table. Shared so the client can grey out actions the server would reject. */
export const LB_RULES = {
    decks: 6,
    /** Fraction of the shoe dealt before the cut card forces a reshuffle. */
    penetration: 0.75,
    seats: 5,
    blackjackPays: 1.5,
    /** Dealer stands on all 17s, soft included. */
    dealerStandsSoft17: true,
    /**
     * Deliberately generous house rules, carried over from the solo table
     * because they make the game more fun to play: split aces are live hands you
     * can draw to and resplit, and surrender stays available on any fresh
     * two-card hand including after a split.
     *
     * The cap exists only so one player cannot stall a five-seat table forever;
     * splitting past four hands is already rare enough that it costs nothing.
     */
    maxHands: 8,
    doubleAfterSplit: true,
    /** Split aces play on like any other hand rather than getting one card. */
    splitAcesDrawCards: true,
    resplitAces: true,
    lateSurrender: true,
    surrenderAfterSplit: true,
    insurancePays: 2
} as const

export const LB_TIMERS = {
    betting: 16_000,
    /** Pause after the deal so the client can finish sliding cards in. */
    dealing: 2_200,
    insurance: 12_000,
    turn: 22_000,
    /** Delay between each dealer draw so the reveal is readable. */
    dealerDraw: 900,
    /**
     * Beat held after a hand finishes, before the turn passes on. Without it the
     * table jumps to the next player faster than anyone can register what the
     * last one did.
     */
    actionBeat: 1_100,
    /**
     * The gap between rounds scales with how many people have to watch it: a
     * lone player wants to be dealt again immediately, a full table needs a beat
     * to read everyone's result.
     */
    payoutBase: 3_000,
    payoutPerExtraPlayer: 1_000,
    payoutMax: 7_000,
    /**
     * How long a seat is held after its player's socket drops, with money still
     * on the table — long enough to survive a refresh and still be paid out.
     */
    disconnectGrace: 45_000,
    /**
     * With nothing staked there is nothing to come back for, so a closed tab
     * gives the seat up almost immediately instead of blocking it.
     */
    disconnectGraceIdle: 10_000
} as const

const TEN_RANKS: LbRank[] = ['10', 'J', 'Q', 'K']

export function rankValue(rank: LbRank): number {
    if (rank === 'A') return 11
    if (TEN_RANKS.includes(rank)) return 10
    return Number(rank)
}

/** Best total for the face-up cards, plus whether an ace is still counted as 11. */
export function handScore(cards: LbCard[]): { total: number, soft: boolean } {
    let total = 0
    let aces = 0
    for (const card of cards) {
        if (!card.rank || card.hidden) continue
        if (card.rank === 'A') aces++
        total += rankValue(card.rank)
    }
    let soft = aces > 0
    while (total > 21 && aces > 0) {
        total -= 10
        aces--
    }
    if (aces === 0) soft = false
    return { total, soft }
}

export function isBlackjack(hand: LbHand): boolean {
    return !hand.fromSplit && hand.cards.length === 2 && handScore(hand.cards).total === 21
}

export function isBusted(hand: LbHand): boolean {
    return handScore(hand.cards).total > 21
}

export function canDouble(hand: LbHand): boolean {
    if (hand.status !== 'playing' || hand.doubled) return false
    if (hand.cards.length !== 2) return false
    if (hand.fromSplit && !LB_RULES.doubleAfterSplit) return false
    return true
}

export function canSplit(hand: LbHand, seatHands: LbHand[]): boolean {
    if (hand.status !== 'playing' || hand.cards.length !== 2) return false
    if (seatHands.length >= LB_RULES.maxHands) return false
    const [a, b] = hand.cards
    if (!a?.rank || !b?.rank) return false
    if (rankValue(a.rank) !== rankValue(b.rank)) return false
    if (a.rank === 'A' && hand.fromSplit && !LB_RULES.resplitAces) return false
    return true
}

export function canSurrender(hand: LbHand, seatHands: LbHand[]): boolean {
    if (!LB_RULES.lateSurrender) return false
    if (hand.status !== 'playing') return false
    if (hand.fromSplit && !LB_RULES.surrenderAfterSplit) return false
    if (!LB_RULES.surrenderAfterSplit && seatHands.length > 1) return false
    return hand.cards.length === 2
}

export function canHit(hand: LbHand): boolean {
    return hand.status === 'playing' && handScore(hand.cards).total < 21
}

export function dealerShouldHit(cards: LbCard[]): boolean {
    const { total, soft } = handScore(cards)
    if (total < 17) return true
    if (total === 17 && soft && !LB_RULES.dealerStandsSoft17) return true
    return false
}

export interface LbSettlement {
    status: LbHand['status']
    /** Total returned to the player, staked amount included. */
    payout: number
    net: number
}

/**
 * Resolve one player hand against the dealer's final hand. `staked` is what the
 * player actually put up, which is double the hand's bet once it was doubled.
 */
export function settleHand(hand: LbHand, dealerCards: LbCard[]): LbSettlement {
    const staked = hand.doubled ? hand.bet * 2 : hand.bet

    if (hand.status === 'surrendered') {
        const payout = round4(staked / 2)
        return { status: 'surrendered', payout, net: round4(payout - staked) }
    }

    const player = handScore(hand.cards).total
    if (player > 21) return { status: 'busted', payout: 0, net: -staked }

    const dealer = handScore(dealerCards).total
    const dealerBj = dealerCards.length === 2 && dealer === 21
    const playerBj = isBlackjack(hand)

    if (playerBj) {
        if (dealerBj) return { status: 'push', payout: staked, net: 0 }
        const payout = round4(staked * (1 + LB_RULES.blackjackPays))
        return { status: 'blackjack', payout, net: round4(payout - staked) }
    }
    if (dealerBj) return { status: 'lost', payout: 0, net: -staked }

    if (dealer > 21 || player > dealer) {
        return { status: 'won', payout: staked * 2, net: staked }
    }
    if (player === dealer) return { status: 'push', payout: staked, net: 0 }
    return { status: 'lost', payout: 0, net: -staked }
}

/** Hi-Lo: low cards +1, tens and aces -1, 7-9 neutral. */
export function hiLoValue(rank: LbRank): number {
    if (rank === 'A' || TEN_RANKS.includes(rank)) return -1
    const n = Number(rank)
    if (n >= 2 && n <= 6) return 1
    return 0
}

/** Money is a numeric(19,4) column; keep every derived amount on that grid. */
export function round4(value: number): number {
    return Math.round(value * 10_000) / 10_000
}
