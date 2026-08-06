import { describe, expect, it } from 'vitest'
import { bigEyeBoyMarks, bigRoadCells, bigRoadColumns } from '#shared/utils/baccarat/roadmap'
import type { BacHistoryEntry } from '#shared/utils/baccarat/types'

function entry(winner: BacHistoryEntry['winner']): BacHistoryEntry {
    return { winner, playerPair: false, bankerPair: false }
}

describe('bigRoadColumns', () => {
    it('is empty with no history', () => {
        expect(bigRoadColumns([])).toEqual([])
    })

    it('extends a column while the same side keeps winning', () => {
        const columns = bigRoadColumns([entry('banker'), entry('banker'), entry('banker')])
        expect(columns).toEqual([{ result: 'banker', rows: 3, ties: 0 }])
    })

    it('starts a new column when the winner changes', () => {
        const columns = bigRoadColumns([entry('player'), entry('player'), entry('banker')])
        expect(columns).toEqual([
            { result: 'player', rows: 2, ties: 0 },
            { result: 'banker', rows: 1, ties: 0 }
        ])
    })

    it('marks a tie on the current column instead of starting one', () => {
        const columns = bigRoadColumns([entry('player'), entry('tie'), entry('player')])
        expect(columns).toEqual([{ result: 'player', rows: 2, ties: 1 }])
    })

    it('drops a tie with no column open yet', () => {
        expect(bigRoadColumns([entry('tie'), entry('tie')])).toEqual([])
    })
})

describe('bigRoadCells', () => {
    it('caps a long column at maxRows and flags the tie on its last filled cell', () => {
        const history = [entry('banker'), entry('banker'), entry('banker'), entry('tie')]
        const cells = bigRoadCells(history, 2)

        // Column capped at 2 rows: banker, banker (tie flag on the last filled row), then empties.
        expect(cells[0]).toEqual({ result: 'banker', tie: false })
        expect(cells[1]).toEqual({ result: 'banker', tie: true })
    })

    it('pads every column out to maxRows with empty cells', () => {
        const cells = bigRoadCells([entry('player')], 6)
        expect(cells).toHaveLength(6)
        expect(cells[0]).toEqual({ result: 'player', tie: false })
        expect(cells.slice(1)).toEqual(Array.from({ length: 5 }, () => ({ result: null, tie: false })))
    })
})

describe('bigEyeBoyMarks', () => {
    it('produces nothing until there is a second column to compare', () => {
        expect(bigEyeBoyMarks(bigRoadColumns([entry('player'), entry('player')]))).toEqual([])
    })

    it('never throws and only emits red or blue marks', () => {
        const history = [
            entry('player'), entry('banker'), entry('banker'), entry('player'),
            entry('player'), entry('player'), entry('banker'), entry('tie'), entry('banker')
        ]
        const marks = bigEyeBoyMarks(bigRoadColumns(history))
        expect(marks.every(mark => mark === 'red' || mark === 'blue')).toBe(true)
    })
})
