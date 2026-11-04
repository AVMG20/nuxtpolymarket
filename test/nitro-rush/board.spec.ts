import { describe, expect, it } from 'vitest'
import { BoardCache } from '../../app/utils/nitro-rush/board'
import type { NrBoard } from '#server/utils/nitro-rush'

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
