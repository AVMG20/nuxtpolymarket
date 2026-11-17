import { describe, expect, it } from 'vitest'
import { BoardCache, boardSummary, mergeSummaries } from '../../app/utils/nitro-rush/board'
import type { NrBoard, NrTrackSummary } from '#server/utils/nitro-rush'

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

    it('makes a menu summary from a board, with the plays given', () => {
        expect(boardSummary(lap(20_000), { racers: 2, laps: 9 })).toEqual({
            trackId: 'polytown-oval', entries: 1, record: { name: 'Me', lapMs: 20_000, mine: true }, myLapMs: 20_000, plays: { racers: 2, laps: 9 }
        })
    })
})

describe('menu summaries', () => {
    const summary = (trackId: string, lapMs: number, laps: number): NrTrackSummary =>
        ({ trackId, entries: 1, record: { name: 'Them', lapMs, mine: false }, myLapMs: null, plays: { racers: 1, laps } })

    it('keeps the open board\'s record and times from a menu reload, but takes its fresh plays', () => {
        const current = { a: summary('a', 20_000, 3), b: summary('b', 30_000, 1) }
        const merged = mergeSummaries(current, [summary('a', 25_000, 8), summary('b', 31_000, 4), summary('c', 40_000, 2)], 'a')
        expect(merged.a).toEqual({ ...current.a, plays: { racers: 1, laps: 8 } })
        expect(merged.b).toEqual(summary('b', 31_000, 4))
        expect(merged.c).toEqual(summary('c', 40_000, 2))
    })

    it('takes the whole summary while no board is loaded', () => {
        const merged = mergeSummaries({ a: summary('a', 20_000, 3) }, [summary('a', 25_000, 8)], null)
        expect(merged.a).toEqual(summary('a', 25_000, 8))
    })
})
