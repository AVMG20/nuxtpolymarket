import { compareHands, evaluateHand, type TcpCard, type TcpHand } from './hand'

/**
 * Optimal play is a single threshold: Q-6-4 or better plays, everything below
 * folds. Anything stronger than a bare high card clears it automatically.
 */
export const TCP_PLAY_THRESHOLD: TcpHand = evaluateHand([
    { rank: 'Q', suit: 'spades' },
    { rank: '6', suit: 'hearts' },
    { rank: '4', suit: 'clubs' }
])

export function shouldPlay(cards: readonly TcpCard[]): boolean {
    return compareHands(evaluateHand(cards), TCP_PLAY_THRESHOLD) >= 0
}
