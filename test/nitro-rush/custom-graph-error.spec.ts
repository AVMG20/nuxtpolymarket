import { describe, expect, it, vi } from 'vitest'
import { TrackGraphError } from '#shared/utils/nitro-rush/track'

// No builder course can fork yet, so the layout is made to fail the way a forked one would.
vi.mock('#shared/utils/nitro-rush/layout', async (original) => {
    const layout = await original<typeof import('#shared/utils/nitro-rush/layout')>()
    return {
        ...layout,
        buildTrack: (t: Parameters<typeof layout.buildTrack>[0]) => {
            if (t.id === 'custom-forked') throw new TrackGraphError('Only two roads can meet here')
            return layout.buildTrack(t)
        }
    }
})

const { compileCustomTrack } = await import('#shared/utils/nitro-rush/custom')

describe('compiling a builder course', () => {
    it('gives a course the fork graph refuses as a reason, not a throw', () => {
        expect(compileCustomTrack({ id: 'custom-forked', name: 'T', closed: true, sections: ['start', 'straight-100'] })).toEqual({ def: null, error: 'Only two roads can meet here' })
    })
})
