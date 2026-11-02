import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useNitroRushOwnTrackActions } from '../../app/composables/useNitroRushOwnTrackActions'
import type { CustomTrackEntry } from '../../app/utils/nitro-rush/types'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'

const entry = (published: boolean) => ({
    track: { id: 'custom-a', name: 'A', closed: true, sections: [] },
    def: null,
    published: published ? { id: 'nr-a' } : null,
    change: null,
    playId: published ? 'nr-a' : 'custom-a'
}) as unknown as CustomTrackEntry

function setup({ published = false, driving = 'polytown', unpublishes = true } = {}) {
    const deps = {
        ownEntry: vi.fn(() => entry(published)),
        publishTrack: vi.fn(async () => null),
        unpublishTrack: vi.fn(async () => unpublishes),
        removeTrack: vi.fn(),
        records: ref({}),
        forgetRecord: vi.fn(),
        trackId: ref(driving),
        resolveTrack: vi.fn(() => null),
        loadTrack: vi.fn(),
        click: vi.fn()
    }
    return { deps, actions: useNitroRushOwnTrackActions(deps) }
}

describe('deleting your own track', () => {
    it('removes a course that was never published, with no server call', async () => {
        const { deps, actions } = setup()
        await actions.deleteTrack('custom-a')
        expect(deps.unpublishTrack).not.toHaveBeenCalled()
        expect(deps.removeTrack).toHaveBeenCalledWith('custom-a')
        expect(deps.forgetRecord).toHaveBeenCalledWith('custom-a')
        expect(deps.loadTrack).not.toHaveBeenCalled()
        expect(deps.click).toHaveBeenCalledOnce()
    })

    it('takes a published copy down first, and forgets both records', async () => {
        const { deps, actions } = setup({ published: true })
        await actions.deleteTrack('custom-a')
        expect(deps.unpublishTrack).toHaveBeenCalledWith('custom-a')
        expect(deps.removeTrack).toHaveBeenCalledWith('custom-a')
        expect(deps.forgetRecord.mock.calls.flat()).toEqual(['nr-a', 'custom-a'])
    })

    it('keeps the course when the server refuses to take it down', async () => {
        const { deps, actions } = setup({ published: true, driving: 'nr-a', unpublishes: false })
        await actions.deleteTrack('custom-a')
        expect(deps.removeTrack).not.toHaveBeenCalled()
        expect(deps.forgetRecord).not.toHaveBeenCalled()
        expect(deps.loadTrack).not.toHaveBeenCalled()
    })

    it.each([['the published copy', 'nr-a', true], ['the local copy', 'custom-a', false]])('moves the engine off %s once, to a built-in', async (_, driving, published) => {
        const { deps, actions } = setup({ published, driving })
        await actions.deleteTrack('custom-a')
        expect(deps.loadTrack).toHaveBeenCalledOnce()
        expect(deps.loadTrack).toHaveBeenCalledWith(TRACKS[0])
    })
})

describe('unpublishing your own track', () => {
    it('keeps the local copy, and drives it if the published one was on the engine', async () => {
        const { deps, actions } = setup({ published: true, driving: 'nr-a' })
        await actions.unpublish('custom-a')
        expect(deps.removeTrack).not.toHaveBeenCalled()
        expect(deps.forgetRecord).toHaveBeenCalledWith('nr-a')
        expect(deps.resolveTrack).toHaveBeenCalledWith('custom-a')
        expect(deps.loadTrack).toHaveBeenCalledOnce()
    })
})
