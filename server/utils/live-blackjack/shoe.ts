import { randomInt } from '#shared/utils/random'
import { LB_RULES } from '#shared/utils/live-blackjack/rules'
import type { LbCard, LbRank, LbSuit } from '#shared/utils/live-blackjack/types'

const SUITS: LbSuit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS: LbRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

let cardSeq = 0

/**
 * A real shoe: cards are dealt off the top and only reshuffled once the cut
 * card is reached, which is what makes counting the table possible at all.
 */
export class Shoe {
    private cards: { rank: LbRank, suit: LbSuit }[] = []
    private dealtCount = 0

    constructor(readonly decks: number = LB_RULES.decks) {
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
        return Math.max(0, this.remaining - Math.round(this.total * (1 - LB_RULES.penetration)))
    }

    get needsShuffle(): boolean {
        return this.untilShuffle <= 0
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
     * Callers must check `remaining` first. Reshuffling here instead would do it
     * behind the table's back, leaving the broadcast running count describing a
     * deck that no longer exists — which is exactly the integrity a counter is
     * relying on.
     */
    draw(hidden = false): LbCard {
        const card = this.cards.pop()
        if (!card) throw new Error('live blackjack: draw from an empty shoe')
        this.dealtCount++
        return { id: `c${++cardSeq}`, rank: card.rank, suit: card.suit, hidden: hidden || undefined }
    }
}
