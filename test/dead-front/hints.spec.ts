import { describe, expect, it } from 'vitest'
import { DF_HINT_GAP, DF_HINT_SECONDS, DF_HINT_START, DfHintTracker, dfAmmoHint } from '../../app/utils/dead-front/engine/hints'
import type { DfHintFacts } from '../../app/utils/dead-front/engine/hints'

const facts = (over: Partial<DfHintFacts> = {}): DfHintFacts => ({
    time: 10,
    alive: true,
    round: 1,
    phase: 'active',
    points: 500,
    brokenWindowNear: false,
    zombieClose: false,
    wallbuyNear: false,
    cheapestDoor: 750,
    doorsOpen: 0,
    power: false,
    perkNear: false,
    downedMate: null,
    reviving: false,
    ...over
})

describe('first-match coaching', () => {
    it('stays quiet at the start, then teaches each thing once, with a gap between hints', () => {
        const h = new DfHintTracker()
        const seen: string[] = []
        h.onSeen = id => seen.push(id)
        expect(h.update(facts({ time: DF_HINT_START - 1, brokenWindowNear: true }))).toBeNull()
        const a = h.update(facts({ time: DF_HINT_START, brokenWindowNear: true }))!
        expect(a.text).toBe('Hold F at a broken window to rebuild it')
        // stays up for its time even if another hint applies
        expect(h.update(facts({ time: DF_HINT_START + 1, brokenWindowNear: true, zombieClose: true }))!.id).toBe('rebuild')
        // then a breather, then the next one
        const off = DF_HINT_START + DF_HINT_SECONDS
        expect(h.update(facts({ time: off, zombieClose: true }))).toBeNull()
        expect(h.update(facts({ time: off + DF_HINT_GAP - 0.1, zombieClose: true }))).toBeNull()
        const b = h.update(facts({ time: off + DF_HINT_GAP, zombieClose: true, brokenWindowNear: true }))!
        expect(b.id).toBe('knife')
        expect(b.key).toBeGreaterThan(a.key)
        expect(seen).toEqual(['rebuild', 'knife'])
        // a seen hint never comes back, even in a new tracker built from storage
        const again = new DfHintTracker(seen)
        expect(again.update(facts({ time: 30, brokenWindowNear: true }))).toBeNull()
    })

    it('doing the thing takes the hint down at once', () => {
        const h = new DfHintTracker()
        h.update(facts({ time: 20, wallbuyNear: true }))
        expect(h.current?.id).toBe('wallbuy')
        h.done('wallbuy')
        expect(h.current).toBeNull()
        expect(h.seen.has('wallbuy')).toBe(true)
        // and a hint you act on before it shows is never shown
        h.done('doors')
        expect(h.update(facts({ time: 40, points: 2000, round: 2 }))).toBeNull()
    })

    it('walks doors, then the power', () => {
        const h = new DfHintTracker()
        expect(h.update(facts({ time: 20, points: 400, round: 2 }))).toBeNull()
        expect(h.update(facts({ time: 20, points: 900, round: 2 }))!.text).toBe('Open doors with points')
        const t = 20 + DF_HINT_SECONDS + DF_HINT_GAP
        h.update(facts({ time: 20 + DF_HINT_SECONDS, doorsOpen: 1 }))
        expect(h.update(facts({ time: t, doorsOpen: 1 }))!.text).toBe('Find the power')
    })

    it('a downed teammate is called out while it lasts, and again on the next down', () => {
        const h = new DfHintTracker(['rebuild', 'knife', 'wallbuy', 'doors', 'power', 'perks'])
        const r = h.update(facts({ time: 30, downedMate: 'Bea' }))!
        expect(r.text).toBe('Hold F next to Bea to revive')
        expect(h.update(facts({ time: 60, downedMate: 'Bea' }))!.id).toBe('revive')
        // reviving: the hint goes
        expect(h.update(facts({ time: 61, downedMate: 'Bea', reviving: true }))).toBeNull()
        expect(h.update(facts({ time: 70 }))).toBeNull()
        expect(h.update(facts({ time: 80, downedMate: 'Bea' }))!.id).toBe('revive')
    })

    it('says nothing to a downed or dead player', () => {
        const h = new DfHintTracker()
        expect(h.update(facts({ time: 20, alive: false, brokenWindowNear: true }))).toBeNull()
    })
})

describe('the ammo line', () => {
    it('reload, low and empty', () => {
        expect(dfAmmoHint(30, 30, 120, false)).toBeNull()
        expect(dfAmmoHint(7, 30, 120, false)).toBe('Press R to reload')
        expect(dfAmmoHint(7, 30, 120, true)).toBeNull()
        expect(dfAmmoHint(0, 30, 0, false)).toBe('No ammo')
        expect(dfAmmoHint(20, 30, 5, false)).toBe('Low ammo')
        expect(dfAmmoHint(1, 8, 0, false)).toBe('Low ammo')
    })
})
