/**
 * The betting layout: the 3x12 number grid plus the outside boxes, expressed
 * as a catalog of every legal bet. A client-submitted bet key is checked
 * against this rather than trusted blindly — it is what stops a "corner"
 * between cells that are not actually adjacent from paying out on adjacency
 * that does not exist.
 */
import { RED_NUMBERS } from '#shared/utils/roulette/wheel'

export type RouletteBetType =
    | 'straight' | 'street' | 'corner' | 'line'
    | 'column' | 'dozen' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high'

export interface RouletteBet {
    key: string
    type: RouletteBetType
    /** Winning pockets this bet covers, ascending. */
    numbers: number[]
}

/** Multiplier paid on top of the stake — a 35:1 win returns 36x the bet. */
export const ROULETTE_PAYOUTS: Record<RouletteBetType, number> = {
    straight: 35,
    street: 11,
    corner: 8,
    line: 5,
    column: 2,
    dozen: 2,
    red: 1,
    black: 1,
    odd: 1,
    even: 1,
    low: 1,
    high: 1
}

const GRID_ROWS = 3
const GRID_COLS = 12

/** Top row is 3-6-9…36, down to the bottom row 1-4-7…34, matching the felt. */
export function numberAt(row: number, col: number): number {
    if (row === 0) return 3 * (col + 1)
    if (row === 1) return 3 * (col + 1) - 1
    return 3 * (col + 1) - 2
}

/**
 * Canonical numbers-to-key encoding, shared with the client's felt geometry so
 * a marker built from the same (row, col) math always lands on the same key
 * the catalog generated it under.
 */
export function betKey(numbers: number[]): string {
    return [...numbers].sort((a, b) => a - b).join('-')
}

function street(col: number): number[] {
    return [numberAt(0, col), numberAt(1, col), numberAt(2, col)]
}

function buildCatalog(): Map<string, RouletteBet> {
    const catalog = new Map<string, RouletteBet>()
    const add = (type: RouletteBetType, numbers: number[], key: string) => {
        catalog.set(key, { key, type, numbers: [...numbers].sort((a, b) => a - b) })
    }

    add('straight', [0], 'straight:0')
    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            const n = numberAt(row, col)
            add('straight', [n], `straight:${n}`)
        }
    }

    // Streets: the three numbers in one grid column.
    for (let col = 0; col < GRID_COLS; col++) {
        const numbers = street(col)
        add('street', numbers, `street:${betKey(numbers)}`)
    }

    // Corners: 2x2 blocks of adjacent cells.
    for (let col = 0; col < GRID_COLS - 1; col++) {
        for (let row = 0; row < GRID_ROWS - 1; row++) {
            const numbers = [
                numberAt(row, col), numberAt(row, col + 1),
                numberAt(row + 1, col), numberAt(row + 1, col + 1)
            ]
            add('corner', numbers, `corner:${betKey(numbers)}`)
        }
    }

    // Lines: two adjacent streets combined.
    for (let col = 0; col < GRID_COLS - 1; col++) {
        const numbers = [...street(col), ...street(col + 1)]
        add('line', numbers, `line:${betKey(numbers)}`)
    }

    // Column bets (2:1): the 12 numbers sharing a grid row.
    for (let row = 0; row < GRID_ROWS; row++) {
        const numbers = Array.from({ length: GRID_COLS }, (_, col) => numberAt(row, col))
        add('column', numbers, `column:${row}`)
    }

    // Dozens.
    for (let d = 0; d < 3; d++) {
        const numbers = Array.from({ length: 12 }, (_, i) => d * 12 + i + 1)
        add('dozen', numbers, `dozen:${d}`)
    }

    // Outside even-money bets.
    const all = Array.from({ length: 36 }, (_, i) => i + 1)
    add('red', all.filter(n => RED_NUMBERS.has(n)), 'red')
    add('black', all.filter(n => !RED_NUMBERS.has(n)), 'black')
    add('odd', all.filter(n => n % 2 === 1), 'odd')
    add('even', all.filter(n => n % 2 === 0), 'even')
    add('low', all.filter(n => n <= 18), 'low')
    add('high', all.filter(n => n >= 19), 'high')

    return catalog
}

export const ROULETTE_BETS: ReadonlyMap<string, RouletteBet> = buildCatalog()

export function getBet(key: string): RouletteBet | undefined {
    return ROULETTE_BETS.get(key)
}

const DOZEN_NAMES = ['1st', '2nd', '3rd']

/** Short human label for the feed and any tooltip — never used to decide a payout. */
export function describeBet(bet: RouletteBet): string {
    switch (bet.type) {
        case 'straight': return `straight ${bet.numbers[0]}`
        case 'street': return `street ${bet.numbers.join('-')}`
        case 'corner': return `corner ${bet.numbers.join('-')}`
        case 'line': return `line ${bet.numbers.join('-')}`
        case 'column': return 'column 2:1'
        case 'dozen': return `${DOZEN_NAMES[Math.floor((bet.numbers[0]! - 1) / 12)]} dozen`
        default: return bet.type
    }
}
