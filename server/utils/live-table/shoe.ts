import { randomInt } from '#shared/utils/random'
import type { LtCard, LtRank, LtSuit } from '#shared/utils/live-table/types'

const SUITS: LtSuit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS: LtRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

let cardSeq = 0

export interface LtShoeInfo {
    dealt: number
    total: number
    decks: number
    untilShuffle: number
}

/**
 * Cards are dealt off the top and only reshuffled once the cut card is reached.
 * Games that want a fresh deck every hand — three card poker, hold'em — pass
 * one deck and a penetration of 0, so `needsShuffle` is true the moment any
 * card has been dealt.
 */
export class LtShoe {
    private cards: { rank: LtRank, suit: LtSuit }[] = []
    private dealtCount = 0

    constructor(readonly decks: number = 6, readonly penetration: number = 0.75) {
        this.shuffle()
    }

    get total(): number {
        return this.decks * 52
    }

    get dealt(): number {
        return this.dealtCount
    }

    get remaining(): number {
        return this.cards.length
    }

    /** Cards left before the cut card, floored at zero once it is passed. */
    get untilShuffle(): number {
        return Math.max(0, this.remaining - Math.round(this.total * (1 - this.penetration)))
    }

    get needsShuffle(): boolean {
        return this.untilShuffle <= 0
    }

    info(): LtShoeInfo {
        return { dealt: this.dealt, total: this.total, decks: this.decks, untilShuffle: this.untilShuffle }
    }

    shuffle() {
        this.cards = []
        for (let d = 0; d < this.decks; d++) {
            for (const suit of SUITS) {
                for (const rank of RANKS) {
                    this.cards.push({ rank, suit })
                }
            }
        }
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = randomInt(0, i)
            const tmp = this.cards[i]!
            this.cards[i] = this.cards[j]!
            this.cards[j] = tmp
        }
        this.dealtCount = 0
    }

    /**
     * Reshuffling here would do it behind the table's back, so callers check
     * `needsShuffle` between rounds instead — a shoe that changes mid-deal
     * leaves the broadcast state describing cards that no longer exist.
     */
    draw(hidden = false): LtCard {
        const card = this.cards.pop()
        if (!card) throw new Error('live table: draw from an empty shoe')
        this.dealtCount++
        return { id: `c${++cardSeq}`, rank: card.rank, suit: card.suit, hidden: hidden || undefined }
    }
}
