import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** Each course's job takes a step per idle slot; the log says which course every step was for. */
const steps: string[] = []
const cache = new Map<string, unknown>()

vi.mock('~/utils/nitro-rush/medals', () => ({
    medalKey: (def: TrackDef) => def.id,
    cachedMedalTimes: (def: TrackDef) => cache.get(def.id),
    cacheMedalTimes: (def: TrackDef, times: unknown) => cache.set(def.id, times),
    markNoMedals: (def: TrackDef) => cache.set(def.id, null),
    medalFor: () => null,
    *medalJob(def: TrackDef) {
        for (let i = 0; i < 3; i++) {
            steps.push(def.id)
            yield
        }
        return { gold: 1, silver: 2, bronze: 3 }
    }
}))

const slots: ((deadline: { timeRemaining(): number }) => void)[] = []
vi.stubGlobal('ref', ref)

const { holdMedalWork, useNitroRushMedals } = await import('../../app/composables/useNitroRushMedals')

/** Runs `n` idle slots, each with no time to spare, so each does one step. */
function idle(n: number) {
    for (let i = 0; i < n && slots.length; i++) slots.shift()!({ timeRemaining: () => 0 })
}

const course = (id: string) => ({ id }) as TrackDef

describe('the medal queue', () => {
    beforeEach(() => {
        // Stubs come off after every test.
        vi.stubGlobal('window', { requestIdleCallback: (cb: (typeof slots)[number]) => slots.push(cb) })
        steps.length = 0
        holdMedalWork(false)
    })

    it('pauses a list course part done while a race runs, and puts the race course first', () => {
        const medals = useNitroRushMedals()
        medals.times(course('list'))
        idle(1)
        expect(steps).toEqual(['list'])
        holdMedalWork(true)
        expect(medals.ensure(course('race'))).toBeNull()
        idle(10)
        expect(steps).toEqual(['list', 'race', 'race', 'race'])
        expect(medals.times(course('race'))).toEqual({ gold: 1, silver: 2, bronze: 3 })
        holdMedalWork(false)
        idle(10)
        // It carries on where it stopped rather than starting again.
        expect(steps).toEqual(['list', 'race', 'race', 'race', 'list', 'list'])
        expect(medals.times(course('list'))).toEqual({ gold: 1, silver: 2, bronze: 3 })
    })

    it('lets the race course jump a list course part done even with nothing held', () => {
        const medals = useNitroRushMedals()
        medals.times(course('a'))
        idle(1)
        medals.ensure(course('b'))
        idle(10)
        expect(steps).toEqual(['a', 'b', 'b', 'b', 'a', 'a'])
    })
})
