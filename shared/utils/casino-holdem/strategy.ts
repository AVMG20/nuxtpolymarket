/**
 * Which hands are worth the call bet. Casino Hold'em is a call-heavy game —
 * optimal play folds under a fifth of the time — because the call is only twice
 * the ante and a non-qualifying dealer still pays the ante.
 *
 * This is the simple strategy rather than the exact one: it folds a little too
 * often on the margins, which costs a fraction of a percent and is readable.
 */
import { rankValue } from './evaluator'
import type { ChCard } from './evaluator'

function fourToAFlush(hole: ChCard[], flop: ChCard[]): boolean {
    const suits = [...hole, ...flop].map(c => c.suit)
    return hole.some(card => suits.filter(suit => suit === card.suit).length >= 4)
}

function fourToAStraight(hole: ChCard[], flop: ChCard[]): boolean {
    const values = new Set([...hole, ...flop].map(c => rankValue(c.rank)))
    // The ace plays low as well, so the wheel draw counts.
    if (values.has(14)) values.add(1)
    const holeValues = hole.map(c => rankValue(c.rank))

    for (let low = 1; low <= 10; low++) {
        let hits = 0
        for (let i = low; i < low + 5; i++) {
            if (values.has(i)) hits++
        }
        if (hits < 4) continue
        // A draw the board makes on its own is the dealer's too, so it is only
        // worth calling when a hole card is part of it.
        if (holeValues.some(v => (v >= low && v < low + 5) || (v === 14 && low === 1))) return true
    }
    return false
}

/** True when the seat should post the call bet rather than fold the ante. */
export function shouldCall(hole: ChCard[], flop: ChCard[]): boolean {
    const holeValues = hole.map(c => rankValue(c.rank))
    const boardValues = flop.map(c => rankValue(c.rank))

    if (holeValues[0] === holeValues[1]) return true
    if (holeValues.some(v => boardValues.includes(v))) return true
    // A single high card is enough on its own. The ante is already dead the
    // moment a seat folds, so the call only has to be better than nothing.
    if (holeValues.some(v => v >= rankValue('J'))) return true
    if (fourToAFlush(hole, flop)) return true
    if (fourToAStraight(hole, flop)) return true

    // A live overcard still has three outs to top pair over two more streets,
    // and the dealer misses the qualifier better than a fifth of the time.
    const boardHigh = Math.max(...boardValues)
    return holeValues.some(v => v > boardHigh)
}
