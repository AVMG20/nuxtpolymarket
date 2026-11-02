import { describe, expect, it } from 'vitest'
import { BoardCache, topRows } from '../../app/utils/nitro-rush/board'
import type { NrBoard, NrBoardRow } from '#server/utils/nitro-rush'

const row = (rank: number, you = false): NrBoardRow => ({ rank, name: you ? 'Me' : `P${rank}`, lapMs: 20_000 + rank, you })
/** A board of `entries` laps with the viewer at `mine`, as the server sends it: its top 20 and the viewer's row. */
function board(entries: number, mine: number | null): NrBoard {
    const top = Array.from({ length: Math.min(entries, 20) }, (_, i) => row(i + 1, i + 1 === mine))
    return { trackId: 'polytown-oval', entries, top, me: mine === null ? null : row(mine, true) }
}

describe('select screen top 5', () => {
    it('takes the first five and marks the viewer inside them, with no extra row', () => {
        const { top, own } = topRows(board(12, 3))
        expect(top.map(r => r.rank)).toEqual([1, 2, 3, 4, 5])
        expect(top[2]).toMatchObject({ you: true })
        expect(own).toBeNull()
    })

    it('adds the viewer\'s own row below the five, from the server\'s list or past it', () => {
        expect(topRows(board(12, 9)).own).toMatchObject({ rank: 9, you: true })
        expect(topRows(board(80, 42)).own).toMatchObject({ rank: 42, you: true })
    })

    it('has no own row before the viewer\'s first lap, and nothing on an empty board', () => {
        expect(topRows(board(3, null))).toMatchObject({ own: null })
        expect(topRows(board(3, null)).top).toHaveLength(3)
        expect(topRows(board(0, null))).toEqual({ top: [], own: null })
    })
})

describe('board cache', () => {
    const lap = (lapMs: number): NrBoard => ({ trackId: 'polytown-oval', entries: 1, top: [{ rank: 1, name: 'Me', lapMs, you: true }], me: { rank: 1, name: 'Me', lapMs, you: true } })

    it('drops a fetch that resolves after a lap submitted while it was in flight', () => {
        const cache = new BoardCache(10)
        const fetch = cache.stamp()
        expect(cache.keep(lap(20_000), cache.stamp())).toBe(true)
        expect(cache.keep(lap(25_000), fetch)).toBe(false)
        expect(cache.get('polytown-oval')?.board.me?.lapMs).toBe(20_000)
    })

    it('keeps a fetch started after the lap, and the later of two fetches whatever order they land in', () => {
        const cache = new BoardCache(10)
        cache.keep(lap(20_000), cache.stamp())
        const first = cache.stamp()
        const second = cache.stamp()
        expect(cache.keep(lap(19_000), second)).toBe(true)
        expect(cache.keep(lap(21_000), first)).toBe(false)
        expect(cache.get('polytown-oval')?.board.me?.lapMs).toBe(19_000)
    })

    it('starts over past its limit', () => {
        const cache = new BoardCache(2)
        for (const trackId of ['a', 'b', 'c']) cache.keep({ ...lap(20_000), trackId }, cache.stamp())
        expect(['a', 'b', 'c'].map(id => !!cache.get(id))).toEqual([false, false, true])
    })
})
