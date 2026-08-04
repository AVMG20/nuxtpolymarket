/**
 * Single-zero European wheel: pocket order for the spin animation, and the
 * colour every client needs for the felt, the history strip and the ball.
 */

export const WHEEL_ORDER: readonly number[] = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
]

export const RED_NUMBERS: ReadonlySet<number> = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
])

export type PocketColor = 'red' | 'black' | 'green'

export function pocketColor(n: number): PocketColor {
    if (n === 0) return 'green'
    return RED_NUMBERS.has(n) ? 'red' : 'black'
}
