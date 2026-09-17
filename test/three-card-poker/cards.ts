import type { TcpCard } from '#shared/utils/three-card-poker/hand'
import type { LtRank, LtSuit } from '#shared/utils/live-table/types'

const SUITS: Record<string, LtSuit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }

/** 'Qs 6h 4c' — rank then suit initial, space separated. */
export function hand(notation: string): TcpCard[] {
    return notation.split(' ').map(token => ({
        rank: token.slice(0, -1) as LtRank,
        suit: SUITS[token.slice(-1)]!
    }))
}
