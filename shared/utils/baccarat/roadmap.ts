/**
 * Derives the Big Road and Big Eye Boy reads from the flat P/B/T history the
 * table keeps. Bead Plate needs no derivation -- it is the flat history
 * itself, laid into a 6-row grid by CSS grid-auto-flow.
 */
import type { BacHistoryEntry } from './types'

export interface BigRoadColumn {
    result: 'player' | 'banker'
    rows: number
    ties: number
}

/**
 * Groups the flat history into Big Road columns: a repeat of the same winner
 * extends the current column downward, a change starts a new one, and a tie
 * marks the current column rather than starting one of its own.
 */
export function bigRoadColumns(history: BacHistoryEntry[]): BigRoadColumn[] {
    const columns: BigRoadColumn[] = []
    for (const entry of history) {
        if (entry.winner === 'tie') {
            if (columns.length) columns[columns.length - 1]!.ties++
            continue
        }
        const last = columns[columns.length - 1]
        if (last && last.result === entry.winner) last.rows++
        else columns.push({ result: entry.winner, rows: 1, ties: 0 })
    }
    return columns
}

export interface BigRoadCell {
    result: 'player' | 'banker' | null
    tie: boolean
}

/**
 * Flattens Big Road columns into a ready-to-render grid, column-major, capped
 * at `maxRows` per column -- real tables continue a long column sideways as a
 * "dragon tail", which is a display nicety this skips.
 */
export function bigRoadCells(history: BacHistoryEntry[], maxRows = 6): BigRoadCell[] {
    const columns = bigRoadColumns(history)
    const cells: BigRoadCell[] = []
    for (const col of columns) {
        const filled = Math.min(col.rows, maxRows)
        for (let row = 0; row < maxRows; row++) {
            cells.push(row < filled
                ? { result: col.result, tie: row === filled - 1 && col.ties > 0 }
                : { result: null, tie: false })
        }
    }
    return cells
}

/**
 * Simplified Big Eye Boy read: does the current column's shape echo the one
 * two columns back. Real Big Eye Boy has more edge cases than this; it is not
 * worth encoding precisely for a derived road nobody bets on directly.
 */
export function bigEyeBoyMarks(columns: BigRoadColumn[]): ('red' | 'blue')[] {
    const marks: ('red' | 'blue')[] = []
    for (let c = 1; c < columns.length; c++) {
        const col = columns[c]!.rows
        const prev = columns[c - 1]!.rows
        for (let r = 0; r < col; r++) {
            if (c === 1 && r === 0) continue
            let red: boolean
            if (r === 0) {
                const prevPrev = columns[c - 2]?.rows
                red = prevPrev !== undefined && prev === prevPrev
            } else {
                red = prev > r
            }
            marks.push(red ? 'red' : 'blue')
        }
    }
    return marks
}
