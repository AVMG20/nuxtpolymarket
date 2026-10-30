import { describe, expect, it } from 'vitest'
import { ownTrackEntries } from '../../app/utils/nitro-rush/community'
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
    summary: { trackId: `pub-${id}`, entries: 0, record: null, myLapMs: null }
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
