import { describe, expect, it } from 'vitest'
import { ownTrackEntries, sortCommunity, voteCounts, voteScore } from '../../app/utils/nitro-rush/community'
import type { NrPublishedTrack } from '#server/utils/nitro-rush-tracks'
import { compileCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'

const RING: SectionId[] = ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight']
const LONG_RING: SectionId[] = RING.map(s => s === 'straight-100' ? 'straight-200' : s)
const local = (id: string, sections = RING, name = 'Ring'): CustomTrack => ({ id: `custom-${id}`, name, closed: true, sections })
const published = (id: string, sections = RING, name = 'Ring'): NrPublishedTrack => ({
    id: `pub-${id}`,
    sourceId: `custom-${id}`,
    name,
    closed: true,
    sections,
    author: 'me',
    summary: { trackId: `pub-${id}`, entries: 0, record: null, myLapMs: null },
    votes: { up: 0, down: 0, myVote: 0 }
})
const entries = (here: CustomTrack[], mine: NrPublishedTrack[]) => ownTrackEntries(
    here,
    mine,
    t => compileCustomTrack(t).def,
    p => compileCustomTrack({ ...p }).def
)

describe('my tracks', () => {
    it('drives an unchanged published course under its published id, so its times go on the board', () => {
        const [e] = entries([local('a')], [published('a')])
        expect(e).toMatchObject({ change: null, playId: 'pub-a' })
    })

    it('says what publishing would do: put it up, rename it, or replace it', () => {
        const [fresh, renamed, changed, unfinished] = entries(
            [local('new'), local('b', RING, 'New name'), local('c', LONG_RING), local('d', ['start'])],
            [published('b'), published('c')]
        )
        expect(fresh).toMatchObject({ change: 'new', playId: 'custom-new', published: null })
        expect(renamed).toMatchObject({ change: 'rename', playId: 'pub-b' })
        // A changed road races locally until it's published again.
        expect(changed).toMatchObject({ change: 'replace', playId: 'custom-c' })
        expect(unfinished).toMatchObject({ def: null, change: null })
    })

    it('lists a published course with no copy here, to drive, edit or take down', () => {
        const list = entries([local('a')], [published('a'), published('elsewhere', LONG_RING, 'Far')])
        expect(list.map(e => e.track.id)).toEqual(['custom-a', 'custom-elsewhere'])
        expect(list[1]).toMatchObject({ change: null, playId: 'pub-elsewhere', track: { name: 'Far', sections: LONG_RING } })
    })
})

describe('community sort', () => {
    const voted = (id: string, up: number, down: number) => ({ track: { ...published(id), votes: { up, down, myVote: 0 as const } } })
    // The server sends the list newest first.
    const list = [voted('new', 1, 0), voted('mid', 5, 1), voted('old', 3, 0), voted('oldest', 0, 2)]

    it('keeps the server\'s newest-first order by default', () => {
        expect(sortCommunity(list, 'newest').map(e => e.track.id)).toEqual(['pub-new', 'pub-mid', 'pub-old', 'pub-oldest'])
    })

    it('ranks by up minus down, ties newest first, and leaves the list it was given alone', () => {
        expect(sortCommunity(list, 'popular').map(e => e.track.id)).toEqual(['pub-mid', 'pub-old', 'pub-new', 'pub-oldest'])
        const tied = [voted('a', 2, 1), voted('b', 1, 0), voted('c', 4, 3)]
        expect(sortCommunity(tied, 'popular').map(e => e.track.id)).toEqual(['pub-a', 'pub-b', 'pub-c'])
        expect(list[0]!.track.id).toBe('pub-new')
    })
})

describe('vote chip', () => {
    it('shows the net score, below zero too, with the up and down votes behind it', () => {
        expect(voteScore({ up: 4, down: 1, myVote: 0 })).toBe(3)
        expect(voteScore({ up: 0, down: 1, myVote: 0 })).toBe(-1)
        expect(voteCounts({ up: 4, down: 1, myVote: 0 })).toBe('4 up · 1 down')
        expect(voteCounts({ up: 0, down: 0, myVote: 1 })).toBe('0 up · 0 down')
    })
})
