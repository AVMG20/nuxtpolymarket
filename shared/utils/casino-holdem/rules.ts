/**
 * Casino Hold'em money rules: the two paytables, dealer qualification, and the
 * resolution of one seat against the dealer. Everything here is pure, so a
 * payout can be argued about without booting a table.
 */
import { compareHands, rankValue } from './evaluator'
import type { ChHandValue } from './evaluator'
import type { ChOutcome } from './types'
import { LB_MIN_BET } from '#shared/utils/live-blackjack/chips'

export interface ChPayRow {
    label: string
    pays: number
}

/** Ante pays on the player's own five-card hand, whatever the dealer holds. */
export const CH_ANTE_TABLE: readonly ChPayRow[] = [
    { label: 'Straight or less', pays: 1 },
    { label: 'Flush', pays: 2 },
    { label: 'Full house', pays: 3 },
    { label: 'Four of a kind', pays: 10 },
    { label: 'Straight flush', pays: 20 },
    { label: 'Royal flush', pays: 100 }
]

/** AA bonus reads the player's two hole cards plus the flop, and nothing else. */
export const CH_AA_TABLE: readonly ChPayRow[] = [
    { label: 'Royal flush', pays: 100 },
    { label: 'Straight flush', pays: 50 },
    { label: 'Four of a kind', pays: 40 },
    { label: 'Full house', pays: 30 },
    { label: 'Flush', pays: 20 },
    { label: 'Straight', pays: 7 },
    { label: 'Three of a kind', pays: 7 },
    { label: 'Two pair', pays: 7 },
    { label: 'Pair of aces', pays: 7 }
]

/** The floor is the smallest chip in the ladder — there is no table maximum. */
export const CH_MIN_BET = LB_MIN_BET
/** The call bet is fixed at twice the ante — there is nothing to size. */
export const CH_CALL_MULTIPLIER = 2
/** The dealer plays with a pair of fours or better. */
export const CH_QUALIFY_RANK = rankValue('4')

export const CH_TIMERS = {
    betting: 18_000,
    /** Betting is cut to this the moment every seat has an ante down. */
    bettingCut: 3_500,
    /** Beat after the deal so the hole cards and flop land before anyone acts. */
    deal: 2_400,
    decision: 22_000,
    /** The same beat once every seat has called or folded. */
    decisionCut: 800,
    board: 2_800,
    reveal: 3_200,
    /**
     * The gap after a payout scales with how many results there are to read: a
     * lone player wants the next hand now, a full table needs a moment.
     */
    payoutBase: 3_200,
    payoutPerExtraSeat: 700
} as const

export function antePayMultiplier(hand: ChHandValue): number {
    switch (hand.category) {
        case 'royal-flush': return 100
        case 'straight-flush': return 20
        case 'four-of-a-kind': return 10
        case 'full-house': return 3
        case 'flush': return 2
        default: return 1
    }
}

export function aaPayMultiplier(hand: ChHandValue): number {
    switch (hand.category) {
        case 'royal-flush': return 100
        case 'straight-flush': return 50
        case 'four-of-a-kind': return 40
        case 'full-house': return 30
        case 'flush': return 20
        case 'straight':
        case 'three-of-a-kind':
        case 'two-pair': return 7
        // The bonus starts at aces; any lower pair is the bottom of the ladder.
        case 'pair': return hand.tiebreak[0] === rankValue('A') ? 7 : 0
        default: return 0
    }
}

export function dealerQualifies(hand: ChHandValue): boolean {
    if (hand.category === 'high-card') return false
    if (hand.category === 'pair') return hand.tiebreak[0]! >= CH_QUALIFY_RANK
    return true
}

export interface ChBets {
    ante: number
    call: number
    aa: number
}

export interface ChShowdown {
    folded: boolean
    /** Null when the seat folded and never made a hand. */
    player: ChHandValue | null
    dealer: ChHandValue | null
    /** Two hole cards plus the flop, for the AA bonus. */
    aa: ChHandValue | null
}

export interface ChResolution {
    outcome: ChOutcome
    dealerQualified: boolean
    anteMultiplier: number
    aaMultiplier: number
    /** Stake plus winnings on each leg, zero when that leg lost. */
    anteReturn: number
    callReturn: number
    aaReturn: number
    staked: number
    payout: number
    net: number
}

function total(parts: Omit<ChResolution, 'staked' | 'payout' | 'net'>, bets: ChBets): ChResolution {
    const staked = bets.ante + bets.call + bets.aa
    const payout = parts.anteReturn + parts.callReturn + parts.aaReturn
    return { ...parts, staked, payout, net: payout - staked }
}

/**
 * One seat against the dealer. Seats never play each other, so this is the whole
 * game: several seats can win the same hand, and a folded seat still collects
 * its AA bonus because that bet was decided on the flop, before anyone chose.
 */
export function resolveSeat(bets: ChBets, showdown: ChShowdown): ChResolution {
    const aaMultiplier = bets.aa > 0 && showdown.aa ? aaPayMultiplier(showdown.aa) : 0
    const aaReturn = aaMultiplier > 0 ? bets.aa * (1 + aaMultiplier) : 0

    if (showdown.folded || !showdown.player || !showdown.dealer) {
        return total({
            outcome: 'folded',
            dealerQualified: showdown.dealer ? dealerQualifies(showdown.dealer) : false,
            anteMultiplier: 0,
            aaMultiplier,
            anteReturn: 0,
            callReturn: 0,
            aaReturn
        }, bets)
    }

    const dealerQualified = dealerQualifies(showdown.dealer)
    const anteMultiplier = antePayMultiplier(showdown.player)

    // A dealer who never qualified cannot take the ante, and there is nothing
    // for the call bet to play against — it comes straight back.
    if (!dealerQualified) {
        return total({
            outcome: 'win',
            dealerQualified,
            anteMultiplier,
            aaMultiplier,
            anteReturn: bets.ante * (1 + anteMultiplier),
            callReturn: bets.call,
            aaReturn
        }, bets)
    }

    const verdict = compareHands(showdown.player, showdown.dealer)
    if (verdict > 0) {
        return total({
            outcome: 'win',
            dealerQualified,
            anteMultiplier,
            aaMultiplier,
            anteReturn: bets.ante * (1 + anteMultiplier),
            callReturn: bets.call * 2,
            aaReturn
        }, bets)
    }
    if (verdict === 0) {
        return total({
            outcome: 'push',
            dealerQualified,
            anteMultiplier: 0,
            aaMultiplier,
            anteReturn: bets.ante,
            callReturn: bets.call,
            aaReturn
        }, bets)
    }
    return total({
        outcome: 'lose',
        dealerQualified,
        anteMultiplier: 0,
        aaMultiplier,
        anteReturn: 0,
        callReturn: 0,
        aaReturn
    }, bets)
}
