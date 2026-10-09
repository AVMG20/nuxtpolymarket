import { describe, expect, it } from 'vitest'
import { TOWN_DRAFT_MAX_ITEMS, townSanitizeDraft, townStoredIsJob } from '../../shared/utils/gamelogic/town-storage'

describe('stored jobs', () => {
    it('counts a site or an upgrade with time left as a paused job', () => {
        expect(townStoredIsJob({ level: 0, upgradingTo: null, remainingMs: 5000 })).toBe(true)
        expect(townStoredIsJob({ level: 3, upgradingTo: 4, remainingMs: 5000 })).toBe(true)
        expect(townStoredIsJob({ level: 3, upgradingTo: null, remainingMs: 0 })).toBe(false)
        expect(townStoredIsJob({ level: 3, upgradingTo: 4, remainingMs: 0 })).toBe(false)
    })
})

describe('redesign draft sanitising', () => {
    const spot = { plotId: 'plot-1', tileX: 2, tileY: 3, rotation: 1 }

    it('keeps a well-formed draft as it is', () => {
        const draft = { placed: { a: spot }, newRoads: { 'new:1': { ...spot, rotation: 0 } }, toStore: ['b'] }
        expect(townSanitizeDraft(draft)).toEqual(draft)
    })

    it('drops malformed spots and ids instead of refusing the whole draft', () => {
        const out = townSanitizeDraft({
            placed: {
                good: spot,
                offPlot: { ...spot, tileX: 99 },
                badRotation: { ...spot, rotation: 7 },
                'bad id!': spot,
                noPlot: { tileX: 1, tileY: 1, rotation: 0 }
            },
            newRoads: 'nope',
            toStore: ['x', 'x', 42, 'bad id!']
        })
        expect(out).toEqual({ placed: { good: spot }, newRoads: {}, toStore: ['x'] })
    })

    it('refuses something that is not a draft, or one far too large', () => {
        expect(townSanitizeDraft(null)).toBeNull()
        expect(townSanitizeDraft('draft')).toBeNull()
        const huge = Object.fromEntries(Array.from({ length: TOWN_DRAFT_MAX_ITEMS + 1 }, (_, i) => [`b${i}`, spot]))
        expect(townSanitizeDraft({ placed: huge })).toBeNull()
    })
})
