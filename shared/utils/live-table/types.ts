/**
 * Wire protocol shared by every multiplayer table built on the LiveTable base.
 *
 * The generic slots are the whole design: the base class owns seats, phases,
 * chat, escrow and the scoreboard, so those are concrete here. Everything a
 * particular game invents — hands, a board, a wheel result, its own actions —
 * rides in `TSeat`, `TShared` and `TAction`, which each game fills in.
 */

import type { LbCard, LbRank, LbSuit } from '#shared/utils/live-blackjack/types'

/** Card primitives are identical across every card game, blackjack included. */
export type LtCard = LbCard
export type LtRank = LbRank
export type LtSuit = LbSuit

export interface LtSeat<TSeat = unknown> {
    index: number
    userId: string
    name: string
    emblem: string | null
    connected: boolean
    /** Asked to stand up while a stake was live; the seat frees once it settles. */
    leaving: boolean
    /** Voted to start the round early rather than wait out the betting clock. */
    votedStart: boolean
    /** Net result of the round that just resolved, for the flash badge. */
    lastNet: number | null
    /** Running profit or loss since this player sat down. */
    sessionNet: number
    /** Profit or loss across every round of this game the player has played today. */
    dailyNet: number
    /** Consecutive winning rounds. A push holds the streak rather than ending it. */
    winStreak: number
    roundsPlayed: number
    balanceHint: number
    game: TSeat
}

export interface LtScoreEntry {
    userId: string
    name: string
    emblem: string | null
    net: number
    winStreak: number
    seated: boolean
    lastNet: number | null
}

export interface LtTableState<TSeat = unknown, TShared = unknown> {
    version: number
    roundId: number
    phase: string
    /** Epoch ms the current phase's timer expires, or null when untimed. */
    phaseEndsAt: number | null
    /** How long that timer ran for, so a client can draw it without guessing. */
    phaseDuration: number | null
    /**
     * Epoch ms the next round's betting opens, published once the hand is over
     * so a client can run one countdown across the phases that settle it.
     */
    nextRoundAt: number | null
    /** Server clock at snapshot time, so clients can correct for drift. */
    now: number
    seats: (LtSeat<TSeat> | null)[]
    message: string
    scoreboard: LtScoreEntry[]
    watching: number
    minBet: number
    maxBet: number
    game: TShared
}

export type LtClientMessage<TAction = unknown> =
    | { t: 'sit', seat: number }
    | { t: 'leave' }
    | { t: 'voteStart' }
    | { t: 'chat', text: string }
    | { t: 'action', action: TAction }

/** One-shot notifications that drive animation and sound on the client. */
export type LtEvent =
    | { t: 'event', kind: 'sit', name: string, seat: number }
    | { t: 'event', kind: 'leave', name: string, seat: number }
    | { t: 'event', kind: 'watch', name: string, joined: boolean }
    | { t: 'event', kind: 'settled', seat: number, net: number }
    | { t: 'event', kind: 'chat', name: string, seat: number, text: string }
    | { t: 'event', kind: 'game', payload: unknown }

export type LtServerMessage<TSeat = unknown, TShared = unknown> =
    | { t: 'state', state: LtTableState<TSeat, TShared> }
    | { t: 'you', userId: string, seat: number | null, balance: number }
    | { t: 'balance', balance: number }
    | { t: 'error', message: string }
    | LtEvent

/**
 * What a game hands back from `resolveRound`. The base settles these — games
 * never call credit or debit themselves, so the concurrency rules live in one
 * reviewed place instead of one per game.
 */
export interface LtPayout {
    userId: string
    /** Everything the player staked this round, stake included in `payout`. */
    staked: number
    /** Total returned to the player. Zero on a total loss. */
    payout: number
}
