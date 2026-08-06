import { compareHands, dealerQualifies, type TcpHand } from './hand'

export type TcpPairPlusTier = 'straightFlush' | 'trips' | 'straight' | 'flush' | 'pair'
export type TcpAnteBonusTier = 'straightFlush' | 'trips' | 'straight'

/** Multiples of the stake, paid on top of it. */
export const TCP_PAIR_PLUS_PAYS: Record<TcpPairPlusTier, number> = {
    straightFlush: 40,
    trips: 30,
    straight: 6,
    flush: 3,
    pair: 1
}

export const TCP_ANTE_BONUS_PAYS: Record<TcpAnteBonusTier, number> = {
    straightFlush: 5,
    trips: 4,
    straight: 1
}

export const TCP_PAIR_PLUS_LABELS: Record<TcpPairPlusTier, string> = {
    straightFlush: 'Straight flush',
    trips: 'Three of a kind',
    straight: 'Straight',
    flush: 'Flush',
    pair: 'Pair'
}

export const TCP_ANTE_BONUS_LABELS: Record<TcpAnteBonusTier, string> = {
    straightFlush: 'Straight flush',
    trips: 'Three of a kind',
    straight: 'Straight'
}

export function pairPlusTier(hand: TcpHand): TcpPairPlusTier | null {
    return hand.category === 'highCard' ? null : hand.category
}

export function anteBonusTier(hand: TcpHand): TcpAnteBonusTier | null {
    if (hand.category === 'straightFlush' || hand.category === 'trips' || hand.category === 'straight') {
        return hand.category
    }
    return null
}

export type TcpAnteResult = 'win' | 'lose' | 'push' | 'fold'
export type TcpPlayResult = 'win' | 'lose' | 'push' | 'none'

export interface TcpBets {
    ante: number
    pairPlus: number
    /** False means the seat folded, forfeiting the ante. */
    played: boolean
}

export interface TcpResolution {
    /** Ante, pair plus, and the matching play bet when the seat played. */
    staked: number
    /** Everything handed back, stake included. */
    payout: number
    net: number
    dealerQualified: boolean
    ante: TcpAnteResult
    play: TcpPlayResult
    anteBonusTier: TcpAnteBonusTier | null
    anteBonusPayout: number
    pairPlusTier: TcpPairPlusTier | null
    pairPlusPayout: number
}

/**
 * Settles one seat against the dealer.
 *
 * Pair plus never looks at the dealer at all, so it pays a folded seat exactly
 * as it pays a played one. The ante bonus does not care about the dealer's hand
 * either, but it rides on the ante, so folding forfeits it along with the ante.
 */
export function resolveHand(bets: TcpBets, player: TcpHand, dealer: TcpHand): TcpResolution {
    const ppTier = pairPlusTier(player)
    const pairPlusPayout = ppTier ? bets.pairPlus * (1 + TCP_PAIR_PLUS_PAYS[ppTier]) : 0

    if (!bets.played) {
        const staked = bets.ante + bets.pairPlus
        return {
            staked,
            payout: pairPlusPayout,
            net: pairPlusPayout - staked,
            dealerQualified: dealerQualifies(dealer),
            ante: 'fold',
            play: 'none',
            anteBonusTier: null,
            anteBonusPayout: 0,
            pairPlusTier: ppTier,
            pairPlusPayout
        }
    }

    const abTier = anteBonusTier(player)
    const anteBonusPayout = abTier ? bets.ante * TCP_ANTE_BONUS_PAYS[abTier] : 0
    const qualified = dealerQualifies(dealer)

    let ante: TcpAnteResult
    let play: TcpPlayResult
    let anteReturn: number
    let playReturn: number

    if (!qualified) {
        // Ante pays even money on its own; the play bet has nothing to beat.
        ante = 'win'
        play = 'push'
        anteReturn = bets.ante * 2
        playReturn = bets.ante
    } else {
        const verdict = compareHands(player, dealer)
        if (verdict > 0) {
            ante = 'win'
            play = 'win'
            anteReturn = bets.ante * 2
            playReturn = bets.ante * 2
        } else if (verdict < 0) {
            ante = 'lose'
            play = 'lose'
            anteReturn = 0
            playReturn = 0
        } else {
            ante = 'push'
            play = 'push'
            anteReturn = bets.ante
            playReturn = bets.ante
        }
    }

    const staked = bets.ante * 2 + bets.pairPlus
    const payout = anteReturn + playReturn + anteBonusPayout + pairPlusPayout
    return {
        staked,
        payout,
        net: payout - staked,
        dealerQualified: qualified,
        ante,
        play,
        anteBonusTier: abTier,
        anteBonusPayout,
        pairPlusTier: ppTier,
        pairPlusPayout
    }
}
