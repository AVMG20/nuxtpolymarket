/** Wire protocol for the live multiplayer blackjack table. */

export type LbSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
export type LbRank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

/**
 * Cards carry a stable id so the client can diff two snapshots: an id it has
 * not seen is a new card to animate in, and an id that gains rank/suit is the
 * hole card flipping face up in place.
 */
export interface LbCard {
    id: string
    rank?: LbRank
    suit?: LbSuit
    hidden?: boolean
}

export type LbSideBetKey = 'perfectPairs' | 'twentyOnePlusThree'

/** The three places a chip can land. */
export type LbBetSpot = 'main' | LbSideBetKey

export interface LbSideBetResult {
    key: LbSideBetKey
    stake: number
    tier: string | null
    /** Human-readable winning combination, null when the bet lost. */
    label: string | null
    multiplier: number
    /** Stake plus winnings, or zero on a loss. */
    payout: number
}

export type LbHandStatus =
    | 'playing'
    | 'stood'
    | 'busted'
    | 'blackjack'
    | 'surrendered'
    | 'won'
    | 'lost'
    | 'push'

export interface LbHand {
    id: string
    cards: LbCard[]
    bet: number
    status: LbHandStatus
    doubled: boolean
    fromSplit: boolean
    /** Best score of the face-up cards. */
    score: number
    soft: boolean
    /** Total returned to the player once settled — staked amount included. */
    payout?: number
    /** payout - staked, i.e. the number shown on the win/loss badge. */
    net?: number
}

export interface LbSeat {
    index: number
    userId: string
    name: string
    emblem: string | null
    connected: boolean
    /** Asked to stand up while a hand was live; the seat frees once it settles. */
    leaving: boolean
    /** Voted to deal early rather than wait out the betting clock. */
    votedStart: boolean
    /** Chips placed during the betting phase, not yet staked. */
    pendingBet: number
    /** Last staked bet, so the client can offer to re-place it. */
    lastBet: number
    /** Side bet chips placed this betting phase, not yet staked. */
    pendingSide: Record<LbSideBetKey, number>
    /** Last staked side bets, so repeat puts the whole layout back. */
    lastSide: Record<LbSideBetKey, number>
    /**
     * Side bets resolved off the opening deal, null until the cards are out.
     * They settle with the round even though they are decided before it plays.
     */
    sideResults: LbSideBetResult[] | null
    hands: LbHand[]
    insurance: number
    insuranceDecided: boolean
    /** Net result of the round that just resolved, for the flash badge. */
    lastNet: number | null
    /** Running profit/loss for this player since they joined the table. */
    sessionNet: number
    /** Profit/loss across every blackjack round this player has played today. */
    dailyNet: number
    /** Consecutive winning rounds. A push holds the streak rather than ending it. */
    winStreak: number
    roundsPlayed: number
}

export type LbPhase =
    | 'idle'
    | 'betting'
    | 'dealing'
    | 'insurance'
    | 'playing'
    | 'dealer'
    | 'payout'

export interface LbDealer {
    cards: LbCard[]
    score: number
    soft: boolean
    blackjack: boolean
    busted: boolean
}

export interface LbShoe {
    /** Cards drawn since the last shuffle. */
    dealt: number
    total: number
    decks: number
    /** Hi-Lo running count over revealed cards only. */
    runningCount: number
    /** Cards left before the cut card forces a reshuffle. */
    untilShuffle: number
}

export interface LbScoreEntry {
    userId: string
    name: string
    emblem: string | null
    net: number
    winStreak: number
    seated: boolean
    lastNet: number | null
}

export interface LbTableState {
    version: number
    roundId: number
    phase: LbPhase
    /** Epoch ms the current phase's timer expires, or null when untimed. */
    phaseEndsAt: number | null
    /** How long that timer ran for, so a client can draw it without guessing. */
    phaseDuration: number | null
    /** Server clock at snapshot time, so clients can correct for drift. */
    now: number
    seats: (LbSeat | null)[]
    dealer: LbDealer
    activeSeat: number | null
    activeHand: number | null
    shoe: LbShoe
    message: string
    scoreboard: LbScoreEntry[]
    watching: number
    minBet: number
    maxBet: number
}

export type LbClientMessage =
    | { t: 'sit', seat: number }
    | { t: 'leave' }
    | { t: 'bet', amount: number, spot?: LbBetSpot }
    | { t: 'undoBet' }
    | { t: 'clearBet' }
    | { t: 'repeatBet' }
    | { t: 'voteStart' }
    | { t: 'action', action: LbAction }
    | { t: 'insurance', take: boolean }
    | { t: 'chat', text: string }

export type LbAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender'

/** One-shot notifications that drive animation and sound on the client. */
export type LbEvent =
    | { t: 'event', kind: 'shuffle' }
    | { t: 'event', kind: 'sit', name: string, seat: number }
    | { t: 'event', kind: 'leave', name: string, seat: number }
    | { t: 'event', kind: 'watch', name: string, joined: boolean }
    | { t: 'event', kind: 'action', name: string, seat: number, action: LbAction }
    | { t: 'event', kind: 'settled', seat: number, net: number }
    | { t: 'event', kind: 'sideBet', seat: number, name: string, label: string, payout: number }
    | { t: 'event', kind: 'chat', name: string, seat: number, text: string }

export type LbServerMessage =
    | { t: 'state', state: LbTableState }
    | { t: 'you', userId: string, seat: number | null, balance: number }
    | { t: 'balance', balance: number }
    | { t: 'error', message: string }
    | LbEvent
