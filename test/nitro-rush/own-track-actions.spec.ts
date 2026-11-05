import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useNitroRushOwnTrackActions } from '../../app/composables/useNitroRushOwnTrackActions'
import { ownTrackEntries } from '../../app/utils/nitro-rush/community'
import type { TrackRecord } from '../../app/utils/nitro-rush/types'
import type { NrPublishedTrack } from '#server/utils/nitro-rush-tracks'
import { compileCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'

const SOURCE_ID = 'custom-test'
const PUBLISHED_ID = 'pub-test'
const SECTIONS: SectionId[] = ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight']

const course: CustomTrack = { id: SOURCE_ID, name: 'Test', closed: true, sections: SECTIONS }
const published = {
    id: PUBLISHED_ID,
    sourceId: SOURCE_ID,
    name: 'Test',
    closed: true,
    sections: SECTIONS,
    author: 'Tester',
    votes: { up: 0, down: 0, myVote: 0 }
} as unknown as NrPublishedTrack

/** The game's stores in memory, so an action's effect shows on the My Tracks list. */
function setup(opts: { local: CustomTrack[], unpublishes?: boolean }) {
    let local = opts.local
    let mine = [published]
    const trackId = ref(PUBLISHED_ID)
    const compile = (t: { id: string, name: string, closed: boolean, sections: SectionId[] }) => compileCustomTrack(t).def
    const entries = () => ownTrackEntries(local, mine, compile, compile)
    const actions = useNitroRushOwnTrackActions({
        ownEntry: id => entries().find(e => e.track.id === id),
        publishTrack: async () => null,
        unpublishTrack: async () => {
            if (opts.unpublishes === false) return false
            mine = []
            return true
        },
        saveTrack: (t) => {
            local = [...local.filter(l => l.id !== t.id), t]
        },
        removeTrack: (id) => {
            local = local.filter(l => l.id !== id)
        },
        records: ref<Record<string, TrackRecord>>({}),
        forgetRecord: () => {},
        trackId,
        resolveTrack: (id): TrackDef | null => {
            const t = local.find(l => l.id === id)
            return t ? compile(t) : null
        },
        loadTrack: (def) => {
            trackId.value = def.id
        },
        click: () => {}
    })
    return { actions, entries, trackId, stored: () => local }
}

describe('Nitro Rush own track actions', () => {
    it('keeps a course with no copy here when it is unpublished', async () => {
        const { actions, entries } = setup({ local: [] })
        await actions.unpublish(SOURCE_ID)
        expect(entries()).toMatchObject([{ track: { id: SOURCE_ID, name: 'Test', sections: SECTIONS }, published: null, change: 'new' }])
    })

    it('moves the engine to the kept copy of the course it was driving', async () => {
        const { actions, trackId } = setup({ local: [] })
        await actions.unpublish(SOURCE_ID)
        expect(trackId.value).toBe(SOURCE_ID)
    })

    it('leaves a course stored here as it was when it is unpublished', async () => {
        const { actions, stored } = setup({ local: [course] })
        await actions.unpublish(SOURCE_ID)
        expect(stored()).toEqual([course])
    })

    it('keeps the published copy on the list when the take-down fails', async () => {
        const { actions, entries } = setup({ local: [], unpublishes: false })
        await actions.unpublish(SOURCE_ID)
        expect(entries()).toMatchObject([{ track: { id: SOURCE_ID }, published: { id: PUBLISHED_ID } }])
    })

    it('still deletes a course outright, leaving no copy behind', async () => {
        const { actions, entries, trackId } = setup({ local: [] })
        await actions.deleteTrack(SOURCE_ID)
        expect(entries()).toEqual([])
        expect(trackId.value).toBe(TRACKS[0]!.id)
    })
})
