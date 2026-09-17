/**
 * Punto banco hand totals and the fixed third-card table. Both sides draw off
 * the same rule -- there is no player decision anywhere in this game, so
 * these functions are the entire rulebook.
 */
import type { LtCard, LtRank } from '#shared/utils/live-table/types'

const TEN_RANKS: LtRank[] = ['10', 'J', 'Q', 'K']

/** Baccarat scores a card as its pip value; tens and faces are zero, ace is one. */
export function rankValue(rank: LtRank): number {
    if (rank === 'A') return 1
    if (TEN_RANKS.includes(rank)) return 0
    return Number(rank)
}

/** A hand's total is the pip sum mod 10 -- the only number that ever shows on the felt. */
export function handTotal(cards: LtCard[]): number {
    let sum = 0
    for (const card of cards) {
        if (!card.rank || card.hidden) continue
        sum += rankValue(card.rank)
    }
    return sum % 10
}

/** The pair side bets look only at the first two cards, same rank regardless of suit. */
export function isPair(cards: LtCard[]): boolean {
    const [a, b] = cards
    return !!a?.rank && a.rank === b?.rank
}

/** A two-card 8 or 9 ends the hand immediately, before either side's third-card rule applies. */
export function isNatural(cards: LtCard[]): boolean {
    return cards.length === 2 && handTotal(cards) >= 8
}

export function playerDraws(playerTotal: number): boolean {
    return playerTotal <= 5
}

/**
 * The banker's third-card rule, straight off the punto banco table. Pass
 * `null` for the player's third-card value when the player stood -- the
 * banker then draws exactly as the player would have, 0 to 5 draws and 6 or 7
 * stands, since there is no player card left to react to.
 */
export function bankerDraws(bankerTotal: number, playerThirdCardValue: number | null): boolean {
    if (bankerTotal >= 7) return false
    if (bankerTotal <= 2) return true
    if (playerThirdCardValue === null) return bankerTotal <= 5
    switch (bankerTotal) {
        case 3: return playerThirdCardValue !== 8
        case 4: return playerThirdCardValue >= 2 && playerThirdCardValue <= 7
        case 5: return playerThirdCardValue >= 4 && playerThirdCardValue <= 7
        case 6: return playerThirdCardValue === 6 || playerThirdCardValue === 7
        default: return false
    }
}

export type BacWinner = 'player' | 'banker' | 'tie'

export function winnerOf(playerTotal: number, bankerTotal: number): BacWinner {
    if (playerTotal > bankerTotal) return 'player'
    if (bankerTotal > playerTotal) return 'banker'
    return 'tie'
}
