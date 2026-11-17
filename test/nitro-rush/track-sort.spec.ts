import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberedSort, rememberSort, sortTracks, withVote, type TrackStats } from '../../app/utils/nitro-rush/community'
import { STORAGE_KEYS } from '../../app/utils/nitro-rush/storage'
import type { NrTrackSummary } from '#server/utils/nitro-rush'

const summary = (trackId: string, racers: number, laps: number): NrTrackSummary => ({ trackId, entries: 0, record: null, myLapMs: null, plays: { racers, laps } })

const stats: TrackStats = {
    votes: {
        a: { up: 1, down: 0, myVote: 0 },
        b: { up: 5, down: 1, myVote: 0 },
        c: { up: 1, down: 0, myVote: 1 }
    },
    summaries: { a: summary('a', 2, 3), b: summary('b', 1, 90), c: summary('c', 2, 8) }
}
const ids = ['a', 'b', 'c', 'd']
const sort = (by: 'listed' | 'top' | 'popular') => sortTracks(ids, by, id => id, stats)

describe('Nitro Rush track sorting', () => {
    it('keeps the list\'s own order', () => {
        expect(sort('listed')).toEqual(ids)
    })

    it('ranks TOP by net votes, ties in list order and unvoted courses at zero', () => {
        expect(sort('top')).toEqual(['b', 'a', 'c', 'd'])
    })

    it('ranks POPULAR by recent racers before all-time laps, so one grinder can\'t carry a course', () => {
        expect(sort('popular')).toEqual(['c', 'a', 'b', 'd'])
    })

    it('counts a changed vote the way the server will', () => {
        expect(withVote({ up: 3, down: 1, myVote: 1 }, -1)).toEqual({ up: 2, down: 2, myVote: -1 })
        expect(withVote({ up: 3, down: 1, myVote: -1 }, 0)).toEqual({ up: 3, down: 0, myVote: 0 })
        expect(withVote({ up: 0, down: 0, myVote: 0 }, 1)).toEqual({ up: 1, down: 0, myVote: 1 })
    })
})

describe('Nitro Rush remembered sort', () => {
    afterEach(() => vi.unstubAllGlobals())

    function stubStorage() {
        const items = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => void items.set(key, value)
        })
        return items
    }

    it('opens in the list\'s own order until a sort is picked', () => {
        stubStorage()
        expect(rememberedSort('builtIn')).toBe('listed')
    })

    it('remembers each list\'s sort on its own', () => {
        stubStorage()
        rememberSort('builtIn', 'top')
        rememberSort('community', 'popular')
        expect(rememberedSort('builtIn')).toBe('top')
        expect(rememberedSort('community')).toBe('popular')
    })

    it('falls back to the list\'s own order for an unknown or broken value', () => {
        const items = stubStorage()
        items.set(STORAGE_KEYS.sort, JSON.stringify({ builtIn: 'fastest', community: 3 }))
        expect(rememberedSort('builtIn')).toBe('listed')
        expect(rememberedSort('community')).toBe('listed')
        items.set(STORAGE_KEYS.sort, '{not json')
        expect(rememberedSort('builtIn')).toBe('listed')
    })

    it('opens in the list\'s own order when storage is blocked', () => {
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
        expect(rememberedSort('community')).toBe('listed')
    })
})
