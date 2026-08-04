/**
 * Five-card poker evaluation for Casino Hold'em. Every seat and the dealer make
 * their best five from two hole cards and the five-card board, so the whole
 * game reduces to `bestHand` plus `compareHands`.
 *
 * A hand is scored as a category rank plus an ordered list of tiebreakers, which
 * is what makes kicker comparison fall out of a single loop rather than a case
 * per category.
 */
import type { LtRank, LtSuit } from '#shared/utils/live-table/types'

export interface ChCard {
    rank: LtRank
    suit: LtSuit
}

export type ChCategory =
    | 'high-card'
    | 'pair'
    | 'two-pair'
    | 'three-of-a-kind'
    | 'straight'
    | 'flush'
    | 'full-house'
    | 'four-of-a-kind'
    | 'straight-flush'
    | 'royal-flush'

export interface ChHandValue {
    category: ChCategory
    /** Category strength, 1 (high card) through 10 (royal flush). */
    rank: number
    /** Rank values that separate two hands inside a category, best first. */
    tiebreak: number[]
    /** The exact five cards that make the hand. */
    cards: ChCard[]
    label: string
}

const RANK_ORDER: readonly LtRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

const NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace']
const PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces']

export const CH_CATEGORY_RANK: Record<ChCategory, number> = {
    'high-card': 1,
    'pair': 2,
    'two-pair': 3,
    'three-of-a-kind': 4,
    'straight': 5,
    'flush': 6,
    'full-house': 7,
    'four-of-a-kind': 8,
    'straight-flush': 9,
    'royal-flush': 10
}

/** Two through ace, ace high at 14. */
export function rankValue(rank: LtRank): number {
    return RANK_ORDER.indexOf(rank) + 2
}

export function rankName(value: number): string {
    return NAMES[value - 2] ?? String(value)
}

export function rankPlural(value: number): string {
    return PLURALS[value - 2] ?? String(value)
}

/** Top card of the straight these five distinct descending values make, if any. */
function straightHigh(values: number[]): number | null {
    if (values[0]! - values[4]! === 4) return values[0]!
    // The wheel is the one straight where the ace plays low, and it is the
    // weakest straight rather than the strongest.
    if (values[0] === 14 && values[1] === 5 && values[4] === 2) return 5
    return null
}

function make(category: ChCategory, tiebreak: number[], cards: ChCard[], label: string): ChHandValue {
    return { category, rank: CH_CATEGORY_RANK[category], tiebreak, cards: [...cards], label }
}

export function evaluateFive(cards: ChCard[]): ChHandValue {
    if (cards.length !== 5) throw new Error("casino hold'em: evaluateFive needs exactly five cards")

    const values = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a)
    const counts = new Map<number, number>()
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

    // Ordered by how many of a rank there are, then by rank — which is exactly
    // the tiebreak order for every paired category.
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
    const ordered = groups.map(g => g[0]!)
    const shape = groups.map(g => g[1]).join('')

    const flush = cards.every(c => c.suit === cards[0]!.suit)
    const high = counts.size === 5 ? straightHigh(values) : null

    if (flush && high !== null) {
        return high === 14
            ? make('royal-flush', [high], cards, 'Royal flush')
            : make('straight-flush', [high], cards, `Straight flush, ${rankName(high)} high`)
    }
    if (shape === '41') {
        return make('four-of-a-kind', ordered, cards, `Four of a kind, ${rankPlural(ordered[0]!)}`)
    }
    if (shape === '32') {
        return make('full-house', ordered, cards, `Full house, ${rankPlural(ordered[0]!)} full of ${rankPlural(ordered[1]!)}`)
    }
    if (flush) {
        return make('flush', values, cards, `Flush, ${rankName(values[0]!)} high`)
    }
    if (high !== null) {
        return make('straight', [high], cards, `Straight, ${rankName(high)} high`)
    }
    if (shape === '311') {
        return make('three-of-a-kind', ordered, cards, `Three of a kind, ${rankPlural(ordered[0]!)}`)
    }
    if (shape === '221') {
        return make('two-pair', ordered, cards, `Two pair, ${rankPlural(ordered[0]!)} and ${rankPlural(ordered[1]!)}`)
    }
    if (shape === '2111') {
        return make('pair', ordered, cards, `Pair of ${rankPlural(ordered[0]!)}, ${rankName(ordered[1]!)} kicker`)
    }
    return make('high-card', values, cards, `${rankName(values[0]!)} high`)
}

export function compareHands(a: ChHandValue, b: ChHandValue): number {
    if (a.rank !== b.rank) return a.rank - b.rank
    const length = Math.max(a.tiebreak.length, b.tiebreak.length)
    for (let i = 0; i < length; i++) {
        const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0)
        if (diff !== 0) return diff
    }
    return 0
}

const COMBINATIONS = new Map<number, number[][]>()

/** Every way to pick five of `n`, memoised — a seven-card hand has 21 of them. */
function fiveOf(n: number): number[][] {
    const cached = COMBINATIONS.get(n)
    if (cached) return cached

    const out: number[][] = []
    const pick: number[] = []
    const walk = (start: number) => {
        if (pick.length === 5) {
            out.push([...pick])
            return
        }
        for (let i = start; i < n; i++) {
            pick.push(i)
            walk(i + 1)
            pick.pop()
        }
    }
    walk(0)
    COMBINATIONS.set(n, out)
    return out
}

/** Best five-card hand out of five or more cards. */
export function bestHand(cards: ChCard[]): ChHandValue {
    if (cards.length < 5) throw new Error("casino hold'em: bestHand needs at least five cards")
    if (cards.length === 5) return evaluateFive(cards)

    let best: ChHandValue | null = null
    for (const combo of fiveOf(cards.length)) {
        const value = evaluateFive([cards[combo[0]!]!, cards[combo[1]!]!, cards[combo[2]!]!, cards[combo[3]!]!, cards[combo[4]!]!])
        if (!best || compareHands(value, best) > 0) best = value
    }
    return best!
}
