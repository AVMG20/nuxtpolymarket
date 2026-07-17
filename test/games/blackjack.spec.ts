import { describe, it, expect, afterEach, vi } from 'vitest'
import {
    calculateScore,
    toClientState,
    startGame,
    performAction,
    type BlackjackState,
    type Card,
    type Hand,
    type Rank,
} from '../../shared/utils/gamelogic/blackjack'

afterEach(() => {
    vi.restoreAllMocks()
})

const card = (rank: Rank, suit: Card['suit'] = 'hearts', isHidden = false): Card => ({ suit, rank, isHidden })

function makeHand(rank1: Rank, rank2: Rank, bet = 100, status: Hand['status'] = 'playing', id = 'hand-0'): Hand {
    return { id, cards: [card(rank1), card(rank2)], bet, status }
}

// Dealer parked at exactly 17 by default so finishDealerTurn never needs to
// draw — most action tests only care about the player-side transition.
function makeState(overrides: Partial<BlackjackState> = {}): BlackjackState {
    return {
        deck: [],
        dealerHand: { id: 'dealer', cards: [card('9'), card('8', 'clubs', true)], bet: 0, status: 'playing' },
        playerHands: [makeHand('10', '6')],
        currentHandIndex: 0,
        phase: 'playing',
        insuranceBet: 0,
        message: '',
        ...overrides,
    }
}

describe('calculateScore', () => {
    it('sums numeric cards at face value', () => {
        expect(calculateScore([card('4'), card('5')])).toBe(9)
    })

    it('counts face cards as 10', () => {
        expect(calculateScore([card('K'), card('Q')])).toBe(20)
    })

    it('counts a single ace as 11 while under 21 (soft)', () => {
        expect(calculateScore([card('A'), card('6')])).toBe(17)
    })

    it('demotes an ace to 1 to avoid busting (soft -> hard)', () => {
        expect(calculateScore([card('A'), card('K'), card('5')])).toBe(16)
    })

    it('demotes both aces in a two-ace hand down to 12', () => {
        expect(calculateScore([card('A'), card('A')])).toBe(12)
    })

    it('keeps one ace soft when a second ace must be demoted', () => {
        expect(calculateScore([card('A'), card('A'), card('9')])).toBe(21)
    })

    it('detects blackjack as 21 on the first two cards', () => {
        expect(calculateScore([card('A'), card('K')])).toBe(21)
    })

    it('busts above 21 once there are no aces left to soften', () => {
        expect(calculateScore([card('K'), card('Q'), card('5')])).toBe(25)
    })

    it('ignores hidden cards entirely', () => {
        expect(calculateScore([card('9'), card('K', 'hearts', true)])).toBe(9)
    })
})

describe('toClientState', () => {
    it('masks the dealer hole card while it is hidden', () => {
        const state = makeState({ dealerHand: { id: 'dealer', cards: [card('9'), card('K', 'diamonds', true)], bet: 0, status: 'playing' } })
        expect(toClientState(state).dealerHand.cards[1]).toEqual({ suit: 'spades', rank: '2', isHidden: true })
    })

    it('leaves the dealer hole card visible once revealed', () => {
        const state = makeState({ dealerHand: { id: 'dealer', cards: [card('9'), card('K', 'diamonds', false)], bet: 0, status: 'resolved' } })
        expect(toClientState(state).dealerHand.cards[1]).toEqual({ suit: 'diamonds', rank: 'K', isHidden: false })
    })

    it('computes dealerScore from only the visible cards while hidden', () => {
        const state = makeState({ dealerHand: { id: 'dealer', cards: [card('9'), card('K', 'diamonds', true)], bet: 0, status: 'playing' } })
        expect(toClientState(state).dealerScore).toBe(9)
    })

    it('reports one playerScore per hand', () => {
        const state = makeState({ playerHands: [makeHand('10', '6'), makeHand('A', '8', 100, 'playing', 'hand-1')] })
        expect(toClientState(state).playerScores).toEqual([16, 19])
    })

    it('does not mutate the original state object', () => {
        const state = makeState({ dealerHand: { id: 'dealer', cards: [card('9'), card('K', 'diamonds', true)], bet: 0, status: 'playing' } })
        toClientState(state)
        expect(state.dealerHand.cards[1]!.rank).toBe('K')
    })
})

describe('performAction phase guards', () => {
    it('rejects hit outside the playing phase', () => {
        expect(() => performAction(makeState({ phase: 'betting' }), 'hit', 100)).toThrow()
    })

    it('rejects stand outside the playing phase', () => {
        expect(() => performAction(makeState({ phase: 'dealerTurn' }), 'stand', 100)).toThrow()
    })

    it('rejects double outside the playing phase', () => {
        expect(() => performAction(makeState({ phase: 'insurance' }), 'double', 100)).toThrow()
    })

    it('rejects split outside the playing phase', () => {
        expect(() => performAction(makeState({ phase: 'resolved' }), 'split', 100)).toThrow()
    })

    it('rejects surrender outside the playing phase', () => {
        expect(() => performAction(makeState({ phase: 'betting' }), 'surrender', 100)).toThrow()
    })

    it('rejects insurance actions outside the insurance phase', () => {
        expect(() => performAction(makeState({ phase: 'playing' }), 'insurance', 100)).toThrow()
        expect(() => performAction(makeState({ phase: 'playing' }), 'no-insurance', 100)).toThrow()
    })

    it('rejects an unknown action', () => {
        expect(() => performAction(makeState(), 'flee' as never, 100)).toThrow()
    })
})

describe('hit', () => {
    it('draws one card and stays in playing under 21', () => {
        const state = makeState({ playerHands: [makeHand('5', '4')], deck: [card('2')] })
        const result = performAction(state, 'hit', 100)
        expect(result.finished).toBe(false)
        expect(result.state.playerHands[0]!.cards).toHaveLength(3)
        expect(result.state.phase).toBe('playing')
    })

    it('busts and resolves the game when the hit pushes past 21', () => {
        const state = makeState({ playerHands: [makeHand('10', '9')], deck: [card('K')] })
        const result = performAction(state, 'hit', 100)
        expect(result.finished).toBe(true)
        expect(result.state.playerHands[0]!.status).toBe('busted')
        expect(result.netPayout).toBe(-100)
    })

    it('auto-stands and resolves a hand that hits exactly 21', () => {
        const state = makeState({ playerHands: [makeHand('10', '6')], deck: [card('5')] })
        const result = performAction(state, 'hit', 100)
        expect(result.finished).toBe(true)
        expect(result.state.playerHands[0]!.status).toBe('won')
        expect(result.netPayout).toBe(100) // 21 beats the dealer's 17
    })
})

describe('stand', () => {
    it('marks the hand stood and moves to the next hand if any', () => {
        const state = makeState({
            playerHands: [makeHand('10', '6'), makeHand('9', '9', 100, 'playing', 'hand-1')],
            currentHandIndex: 0,
        })
        const result = performAction(state, 'stand', 100)
        expect(result.state.playerHands[0]!.status).toBe('stood')
        expect(result.state.currentHandIndex).toBe(1)
        expect(result.finished).toBe(false)
    })

    it('runs the dealer turn and resolves when standing on the last hand', () => {
        const state = makeState({ playerHands: [makeHand('10', '9')] }) // 19 vs dealer's 17
        const result = performAction(state, 'stand', 100)
        expect(result.finished).toBe(true)
        expect(result.state.playerHands[0]!.status).toBe('won')
        expect(result.netPayout).toBe(100)
    })
})

describe('double', () => {
    it('doubles the bet, draws exactly one card, and auto-stands under 21', () => {
        // A second hand keeps the game unresolved, so the doubled hand's status is
        // still the auto-stand this test is about rather than a win/loss outcome.
        const state = makeState({
            playerHands: [makeHand('5', '4'), makeHand('9', '9', 100, 'playing', 'hand-1')],
            deck: [card('2')],
        })
        const result = performAction(state, 'double', 100)
        expect(result.state.playerHands[0]!.bet).toBe(200)
        expect(result.state.playerHands[0]!.cards).toHaveLength(3)
        expect(result.state.playerHands[0]!.status).toBe('stood')
        expect(result.finished).toBe(false)
    })

    it('busts on a double that pushes past 21', () => {
        const state = makeState({ playerHands: [makeHand('10', '9')], deck: [card('K')] })
        const result = performAction(state, 'double', 100)
        expect(result.state.playerHands[0]!.status).toBe('busted')
        expect(result.netPayout).toBe(-200)
    })

    it('pays out on the doubled bet, not the original bet', () => {
        const state = makeState({ playerHands: [makeHand('6', '5')], deck: [card('10')] }) // 11 -> 21
        const result = performAction(state, 'double', 100)
        expect(result.state.playerHands[0]!.bet).toBe(200)
        expect(result.netPayout).toBe(200) // 21 beats dealer's 17, paid on the 200 stake
    })

    it('loses the full doubled bet, not the original bet, on a loss', () => {
        const state = makeState({ playerHands: [makeHand('6', '4')], deck: [card('2')] }) // 10 -> 12, loses to 17
        const result = performAction(state, 'double', 100)
        expect(result.state.playerHands[0]!.bet).toBe(200)
        expect(result.netPayout).toBe(-200)
    })

    it('rejects doubling once a hand has more than two cards', () => {
        const state = makeState({ playerHands: [{ id: 'hand-0', cards: [card('5'), card('4'), card('2')], bet: 100, status: 'playing' }] })
        expect(() => performAction(state, 'double', 100)).toThrow()
    })
})

describe('split', () => {
    it('splits into two hands, each redrawn to two cards', () => {
        const state = makeState({ playerHands: [makeHand('8', '8')], deck: [card('3'), card('2')] })
        const result = performAction(state, 'split', 100)
        expect(result.state.playerHands).toHaveLength(2)
        expect(result.state.playerHands[0]!.cards).toHaveLength(2)
        expect(result.state.playerHands[1]!.cards).toHaveLength(2)
        expect(result.state.playerHands[1]!.bet).toBe(100)
        expect(result.finished).toBe(false)
    })

    it('allows splitting cards of equal value even with different ranks', () => {
        const state = makeState({ playerHands: [makeHand('10', 'K')], deck: [card('3'), card('2')] })
        expect(() => performAction(state, 'split', 100)).not.toThrow()
    })

    it('rejects splitting cards of unequal value', () => {
        const state = makeState({ playerHands: [makeHand('9', '8')] })
        expect(() => performAction(state, 'split', 100)).toThrow()
    })

    it('rejects splitting once a hand has more than two cards', () => {
        const state = makeState({ playerHands: [{ id: 'hand-0', cards: [card('8'), card('8'), card('2')], bet: 100, status: 'playing' }] })
        expect(() => performAction(state, 'split', 100)).toThrow()
    })
})

describe('surrender', () => {
    it('returns half the bet and resolves when it is the last hand', () => {
        const state = makeState({ playerHands: [makeHand('10', '6')] })
        const result = performAction(state, 'surrender', 100)
        expect(result.state.playerHands[0]!.status).toBe('surrendered')
        expect(result.finished).toBe(true)
        expect(result.netPayout).toBe(-50)
    })

    it('rejects surrendering once a hand has more than two cards', () => {
        const state = makeState({ playerHands: [{ id: 'hand-0', cards: [card('10'), card('6'), card('2')], bet: 100, status: 'playing' }] })
        expect(() => performAction(state, 'surrender', 100)).toThrow()
    })
})

describe('insurance', () => {
    it('breaks even when the dealer has blackjack (2:1 insurance payout)', () => {
        const state = makeState({
            phase: 'insurance',
            playerHands: [makeHand('10', '6')],
            dealerHand: { id: 'dealer', cards: [card('A'), card('K', 'clubs', true)], bet: 0, status: 'playing' },
        })
        const result = performAction(state, 'insurance', 100)
        expect(result.finished).toBe(true)
        expect(result.state.phase).toBe('resolved')
        expect(result.state.playerHands[0]!.status).toBe('lost')
        expect(result.netPayout).toBe(0)
    })

    it('loses just the insurance premium when the dealer has no blackjack', () => {
        const state = makeState({
            phase: 'insurance',
            playerHands: [makeHand('10', '6')],
            dealerHand: { id: 'dealer', cards: [card('A'), card('7', 'clubs', true)], bet: 0, status: 'playing' },
        })
        const result = performAction(state, 'insurance', 100)
        expect(result.finished).toBe(false)
        expect(result.state.phase).toBe('playing')
        expect(result.netPayout).toBe(-50)
        expect(result.state.dealerHand.cards[1]!.isHidden).toBe(true) // re-hidden after the peek
    })
})

describe('decline insurance', () => {
    it('loses the full bet outright when the dealer has blackjack', () => {
        const state = makeState({
            phase: 'insurance',
            playerHands: [makeHand('10', '6')],
            dealerHand: { id: 'dealer', cards: [card('A'), card('K', 'clubs', true)], bet: 0, status: 'playing' },
        })
        const result = performAction(state, 'no-insurance', 100)
        expect(result.finished).toBe(true)
        expect(result.netPayout).toBe(-100)
    })

    it('returns to play with no payout change when the dealer has no blackjack', () => {
        const state = makeState({
            phase: 'insurance',
            playerHands: [makeHand('10', '6')],
            dealerHand: { id: 'dealer', cards: [card('A'), card('7', 'clubs', true)], bet: 0, status: 'playing' },
        })
        const result = performAction(state, 'no-insurance', 100)
        expect(result.finished).toBe(false)
        expect(result.state.phase).toBe('playing')
        expect(result.netPayout).toBe(0)
    })
})

describe('dealer play', () => {
    it('hits until reaching at least 17', () => {
        const state = makeState({
            playerHands: [makeHand('10', '7')],
            dealerHand: { id: 'dealer', cards: [card('9'), card('5', 'clubs', true)], bet: 0, status: 'playing' },
            deck: [card('3'), card('2')], // dealer: 14 -> 16 -> 19
        })
        const result = performAction(state, 'stand', 100)
        expect(result.state.dealerHand.cards).toHaveLength(4)
        expect(calculateScore(result.state.dealerHand.cards)).toBe(19)
        expect(result.state.playerHands[0]!.status).toBe('lost')
    })

    it('does not draw further cards once every player hand is already settled', () => {
        const state = makeState({
            playerHands: [makeHand('10', '9')],
            dealerHand: { id: 'dealer', cards: [card('9'), card('5', 'clubs', true)], bet: 0, status: 'playing' },
            deck: [card('K')], // only enough for the player's own bust card
        })
        const result = performAction(state, 'hit', 100)
        expect(result.state.playerHands[0]!.status).toBe('busted')
        expect(result.state.dealerHand.cards).toHaveLength(2) // never drew, despite starting under 17
    })
})

describe('resolveGame payout outcomes', () => {
    it('pays 1:1 net on an ordinary win', () => {
        const state = makeState({ playerHands: [makeHand('10', '9')] }) // 19 vs dealer's 17
        const result = performAction(state, 'stand', 100)
        expect(result.state.playerHands[0]!.status).toBe('won')
        expect(result.netPayout).toBe(100)
    })

    it('loses the full bet net on an ordinary loss', () => {
        const state = makeState({ playerHands: [makeHand('10', '5')] }) // 15 vs dealer's 17
        const result = performAction(state, 'stand', 100)
        expect(result.state.playerHands[0]!.status).toBe('lost')
        expect(result.netPayout).toBe(-100)
    })

    it('nets zero on a push', () => {
        const state = makeState({ playerHands: [makeHand('10', '7')] }) // 17 ties dealer's 17
        const result = performAction(state, 'stand', 100)
        expect(result.state.playerHands[0]!.status).toBe('push')
        expect(result.netPayout).toBe(0)
    })

    it('pays the player when the dealer busts, even holding a lower score', () => {
        const state = makeState({
            playerHands: [makeHand('10', '5')], // 15
            dealerHand: { id: 'dealer', cards: [card('6'), card('6', 'clubs', true)], bet: 0, status: 'playing' }, // 12
            deck: [card('K')], // dealer: 12 -> 22, busts
        })
        const result = performAction(state, 'stand', 100)
        expect(result.state.playerHands[0]!.status).toBe('won')
        expect(result.netPayout).toBe(100)
    })
})

// --- startGame: driving the Fisher-Yates shuffle to a known deal -----------
//
// createDeck() shuffles with a single crypto.getRandomValues(Uint32Array(312))
// call, using arr[i] % (i+1) as the swap target at each step — independent of
// randomFloat()/stubRandomFloat entirely. scriptedShuffleValues replays that
// exact algorithm forward, greedily choosing each swap so a chosen sequence of
// cards ends up at the tail of the deck (which is what startGame pop()s first).

type SimpleCard = { suit: Card['suit'], rank: Rank }

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

function baseDeck(numDecks: number): SimpleCard[] {
    const deck: SimpleCard[] = []
    for (let d = 0; d < numDecks; d++) {
        for (const suit of SUITS) {
            for (const rank of RANKS) deck.push({ suit, rank })
        }
    }
    return deck
}

function scriptedShuffleValues(numDecks: number, popOrder: SimpleCard[]): Uint32Array {
    const deck = baseDeck(numDecks)
    const arr = new Uint32Array(deck.length)
    for (let i = deck.length - 1; i > 0; i--) {
        const popIndex = deck.length - 1 - i
        const desired = popOrder[popIndex]
        let j = 0
        if (desired) j = deck.findIndex((c, idx) => idx <= i && c.suit === desired.suit && c.rank === desired.rank)
        arr[i] = j
        ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
    }
    return arr
}

function stubDeal(popOrder: SimpleCard[]) {
    const scripted = scriptedShuffleValues(6, popOrder)
    return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        (array as unknown as Uint32Array).set(scripted)
        return array
    })
}

describe('startGame', () => {
    it('deals player, dealer(up), player, dealer(hidden) in that order', () => {
        stubDeal([
            { suit: 'hearts', rank: '9' },
            { suit: 'clubs', rank: '7' },
            { suit: 'diamonds', rank: '6' },
            { suit: 'spades', rank: 'K' },
        ])
        const result = startGame(100)
        const p = result.state.playerHands[0]!
        expect(p.cards.map(c => c.rank)).toEqual(['9', '6'])
        expect(result.state.dealerHand.cards[0]!.rank).toBe('7')
        expect(result.state.dealerHand.cards[1]!.rank).toBe('K')
        expect(result.state.dealerHand.cards[1]!.isHidden).toBe(true)
        expect(result.state.phase).toBe('playing')
        expect(result.finished).toBe(false)
    })

    it('enters the insurance phase when the dealer shows an ace', () => {
        stubDeal([
            { suit: 'hearts', rank: '9' },
            { suit: 'clubs', rank: 'A' },
            { suit: 'diamonds', rank: '6' },
            { suit: 'spades', rank: 'K' },
        ])
        const result = startGame(100)
        expect(result.state.phase).toBe('insurance')
        expect(result.finished).toBe(false)
    })

    it('pays 3:2 on an immediate player blackjack against a non-blackjack dealer', () => {
        stubDeal([
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: '9' },
            { suit: 'diamonds', rank: 'K' },
            { suit: 'spades', rank: '5' },
        ])
        const result = startGame(100)
        expect(result.state.playerHands[0]!.status).toBe('blackjack')
        expect(result.finished).toBe(true)
        expect(result.netPayout).toBe(150)
    })

    it('skips the insurance offer for an immediate blackjack even when the dealer shows an ace', () => {
        stubDeal([
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: 'A' },
            { suit: 'diamonds', rank: 'K' },
            { suit: 'spades', rank: 'K' },
        ])
        const result = startGame(100)
        expect(result.state.phase).toBe('resolved')
        expect(result.finished).toBe(true)
    })

    it('pushes (not 3:2) when both player and dealer land a natural blackjack', () => {
        stubDeal([
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: 'A' },
            { suit: 'diamonds', rank: 'K' },
            { suit: 'spades', rank: 'K' },
        ])
        const result = startGame(100)
        expect(result.state.playerHands[0]!.status).toBe('push')
        expect(result.netPayout).toBe(0)
    })
})
