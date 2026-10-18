import { describe, expect, it } from 'vitest'
import {
    createDfMixer, dfAirCutoff, dfDistanceGain, dfMergeDuck, dfSoundRule, DF_AUDIBLE, DF_MIX, DF_MIX_CATS, DF_VOCAL
} from '../../app/utils/dead-front/engine/audio'
import type { DfMixRequest } from '../../app/utils/dead-front/engine/audio'
import { DF_TOLL_MOTIF, registerDfEngineSounds } from '../../app/utils/dead-front/engine/sounds'
import { DF_GUN_VOICES, DF_WSND, registerDfWeaponSoundsImpl } from '../../app/utils/dead-front/weapons/sounds'
import { DF_WORLD_SOUNDS, dfAttackSound, dfDeathSound, dfGroanSound, dfPerkJingleSound } from '../../app/utils/dead-front/world/sound-names'
import { registerDfWorldSounds } from '../../app/utils/dead-front/world/sounds/index'
import type { DfAudio } from '../../app/utils/dead-front/context'
import { DF_WEAPON_IDS } from '#shared/utils/dead-front/weapons'

/** Deterministic rng so gate lengths are reproducible. */
function seq(...vals: number[]): () => number {
    let i = 0
    return () => vals[i++ % vals.length] ?? 0.5
}

const near = (name: string, now: number, dist = 3, volume = 1): DfMixRequest => ({ name, now, spatial: true, dist, volume })

describe('dead front sound rules', () => {
    it('sorts names into categories', () => {
        expect(dfSoundRule(dfGroanSound('shambler'), true).cat).toBe('zvocal')
        expect(dfSoundRule(dfAttackSound('brute'), true).vocal).toBe('attack')
        expect(dfSoundRule(dfDeathSound('ghoul'), true).vocal).toBe('death')
        expect(dfSoundRule(DF_WORLD_SOUNDS.flesh, true).cat).toBe('zfoley')
        expect(dfSoundRule(DF_WORLD_SOUNDS.bruteStep, true).cat).toBe('zfoley')
        expect(dfSoundRule(DF_WSND.fire('kar98k', 0), false).cat).toBe('weapon')
        expect(dfSoundRule(DF_WSND.fire('kar98k', 0), true).cat).toBe('remote')
        expect(dfSoundRule('df:hit', false).cat).toBe('ui')
        expect(dfSoundRule('df:round-start', false).cat).toBe('music')
        expect(dfSoundRule(dfPerkJingleSound('ironhide'), true).cat).toBe('music')
        expect(dfSoundRule('df:ambience', false).cat).toBe('ambience')
        expect(dfSoundRule(DF_WORLD_SOUNDS.doorOpen, true).cat).toBe('world')
        expect(dfSoundRule('df:step-mud', false).cat).toBe('ui')
        expect(dfSoundRule('df:step-mud', true).cat).toBe('world')
    })

    it('ducks on own shots and stingers only', () => {
        expect(dfSoundRule(DF_WSND.fire('m1911', 0), false).duck?.cats.zvocal).toBeLessThan(1)
        expect(dfSoundRule(DF_WSND.fire('m1911', 0), true).duck).toBeUndefined()
        expect(dfSoundRule('df:round-start', false).duck?.cats.ambience).toBeLessThan(0.6)
        expect(dfSoundRule(dfGroanSound('brute'), true).duck).toBeUndefined()
    })

    it('models distance falloff and air absorption', () => {
        expect(dfDistanceGain(1, 2, 1)).toBe(1)
        expect(dfDistanceGain(12, 2, 1)).toBeCloseTo(2 / 12)
        expect(dfAirCutoff(0)).toBe(20000)
        expect(dfAirCutoff(30)).toBeLessThan(dfAirCutoff(10))
        expect(dfAirCutoff(500)).toBe(1400)
    })

    it('keeps zombie vocals quieter than own gunfire on the bus', () => {
        for (const c of DF_MIX_CATS) expect(DF_MIX[c].gain, c).toBeLessThanOrEqual(DF_MIX.weapon.gain)
    })
})

describe('dead front mixer', () => {
    it('never starts several zombie vocals on one frame', () => {
        const m = createDfMixer({ rng: seq(0.5) })
        let ok = 0
        for (let i = 0; i < 24; i++) {
            if (m.request(near(dfGroanSound(i % 2 ? 'shambler' : 'ghoul'), 10, 2 + i * 0.1)).ok) ok++
            if (m.request(near(dfAttackSound('shambler'), 10, 2)).ok) ok++
        }
        expect(ok).toBe(1)
    })

    it('spaces idle groans out with long gaps', () => {
        const m = createDfMixer({ rng: seq(0) })
        let starts = 0
        // 24 zombies each asking to groan every frame for 20 s.
        for (let f = 0; f < 20 * 60; f++) {
            const now = f / 60
            for (let z = 0; z < 24; z++) if (m.request(near(dfGroanSound('shambler'), now, 3 + z)).ok) starts++
        }
        // With the shortest gap (rng 0) groans are at least DF_VOCAL.groanGap[0] apart.
        expect(starts).toBeLessThanOrEqual(Math.ceil(20 / DF_VOCAL.groanGap[0]) + 1)
        expect(starts).toBeGreaterThan(3)
    })

    it('caps concurrent vocals and lets a near attack steal a far groan', () => {
        const m = createDfMixer({ rng: seq(0) })
        let t = 0
        const groans: number[] = []
        // Fill the slots with far groans (groan gate 1.5 s at rng 0).
        for (let i = 0; i < DF_VOCAL.max; i++) {
            const res = m.request(near(dfGroanSound('brute'), t, 25 - i))
            expect(res.ok).toBe(true)
            if (res.ok) groans.push(res.id)
            t += DF_VOCAL.groanGap[0] + 0.01
        }
        // Brute groans last 2 s: the first has run out by now, so a fourth fits without stealing.
        expect(m.live(t).zvocal).toBeLessThanOrEqual(DF_VOCAL.max)
        // Another far groan is refused while full.
        const m2 = createDfMixer({ rng: seq(0) })
        const ids: number[] = []
        for (let i = 0; i < DF_VOCAL.max; i++) {
            const r = m2.request(near(i === 0 ? dfGroanSound('shambler') : dfDeathSound('shambler'), i * 0.5, 20))
            if (r.ok) ids.push(r.id)
        }
        expect(ids).toHaveLength(DF_VOCAL.max)
        expect(m2.request(near(dfGroanSound('ghoul'), 1.6, 20)).ok).toBe(false)
        // A snarl right next to the player steals the weakest slot.
        const snarl = m2.request(near(dfAttackSound('ghoul'), 1.6, 1.5))
        expect(snarl.ok).toBe(true)
        if (snarl.ok) {
            expect(snarl.steal).toHaveLength(1)
            expect(ids).toContain(snarl.steal[0])
        }
        expect(m2.live(1.6).zvocal).toBe(DF_VOCAL.max)
    })

    it('culls inaudible and too-far sounds', () => {
        const m = createDfMixer()
        expect(m.request(near(dfGroanSound('shambler'), 0, DF_MIX.zvocal.maxDist + 1))).toEqual({ ok: false, reason: 'far' })
        expect(m.request(near(DF_WORLD_SOUNDS.flesh, 0, 3, DF_AUDIBLE / 10))).toEqual({ ok: false, reason: 'quiet' })
        expect(m.request({ name: 'df:hit', now: 0, spatial: false, dist: 0, volume: 0.7 }).ok).toBe(true)
    })

    it('rate limits one name with its retrigger interval', () => {
        const m = createDfMixer()
        expect(m.request(near(DF_WORLD_SOUNDS.flesh, 0)).ok).toBe(true)
        expect(m.request(near(DF_WORLD_SOUNDS.flesh, 0.01))).toEqual({ ok: false, reason: 'interval' })
        expect(m.request(near(DF_WORLD_SOUNDS.flesh, 0.1)).ok).toBe(true)
    })

    it('steals the quietest voice when a category is full, and refuses weaker ones', () => {
        const m = createDfMixer()
        const cap = DF_MIX.zfoley.voices
        let t = 0
        for (let i = 0; i < cap; i++) {
            expect(m.request(near(DF_WORLD_SOUNDS.gib, t, 2 + i)).ok).toBe(true)
            t += 0.081
        }
        expect(m.live(t).zfoley).toBe(cap)
        // A far, quiet gib can't push out anything louder.
        expect(m.request(near(DF_WORLD_SOUNDS.gib, t, 28))).toEqual({ ok: false, reason: 'full' })
        // A close one steals.
        const res = m.request(near(DF_WORLD_SOUNDS.gib, t + 0.001, 1))
        expect(res.ok && res.steal.length).toBe(1)
        expect(m.live(t + 0.001).zfoley).toBe(cap)
    })

    it('limits rapid fire per name by stealing the oldest shot', () => {
        const m = createDfMixer()
        const name = DF_WSND.fire('thompson', 0)
        m.setNameLimit(name, 4)
        const ids: number[] = []
        for (let i = 0; i < 4; i++) {
            const r = m.request({ name, now: i * 0.07, spatial: false, dist: 0, volume: 1 })
            if (r.ok) ids.push(r.id)
        }
        const fifth = m.request({ name, now: 0.28, spatial: false, dist: 0, volume: 1 })
        expect(fifth.ok && fifth.steal).toEqual([ids[0]])
    })

    it('stays calm under a burst of every zombie call at once', () => {
        const m = createDfMixer()
        const names = [
            dfGroanSound('shambler'), dfAttackSound('shambler'), dfDeathSound('ghoul'), DF_WORLD_SOUNDS.rise,
            DF_WORLD_SOUNDS.swipe, DF_WORLD_SOUNDS.flesh, DF_WORLD_SOUNDS.bodyFall, DF_WORLD_SOUNDS.boardRip
        ]
        let maxVocal = 0
        let maxFoley = 0
        for (let f = 0; f < 600; f++) {
            const now = f / 60
            for (let z = 0; z < 24; z++) m.request(near(names[(z + f) % names.length] ?? names[0]!, now, 2 + z))
            const live = m.live(now)
            maxVocal = Math.max(maxVocal, live.zvocal)
            maxFoley = Math.max(maxFoley, live.zfoley)
        }
        expect(maxVocal).toBeLessThanOrEqual(DF_VOCAL.max)
        expect(maxFoley).toBeLessThanOrEqual(DF_MIX.zfoley.voices)
        const s = m.stats(10)
        expect(s.started.zvocal / 10).toBeLessThan(5)
    })

    it('merges ducks: deeper wins, hold extends', () => {
        let d = { depth: 1, until: 0 }
        d = dfMergeDuck(d, 1, 0.6, 0.1)
        expect(d).toEqual({ depth: 0.6, until: 1.1 })
        d = dfMergeDuck(d, 1.05, 0.8, 0.5)
        expect(d.depth).toBe(0.6)
        expect(d.until).toBeCloseTo(1.55)
        d = dfMergeDuck(d, 3, 0.9, 0.1)
        expect(d).toEqual({ depth: 0.9, until: 3.1 })
    })
})

describe('dead front sound registry', () => {
    function names(reg: (a: DfAudio) => void): Set<string> {
        const out = new Set<string>()
        reg({ ctx: null, register: n => out.add(n), play: () => {}, loop: () => {}, stopLoop: () => {} })
        return out
    }

    it('registers every weapon report and the foley', () => {
        const n = names(registerDfWeaponSoundsImpl)
        for (const id of DF_WEAPON_IDS) {
            expect(n.has(DF_WSND.fire(id, 0)), id).toBe(true)
            expect(n.has(DF_WSND.fire(id, 1)), id).toBe(true)
            expect(n.has(DF_WSND.fire(id, 0, true)), id).toBe(true)
        }
        for (const v of Object.values(DF_WSND)) if (typeof v === 'string') expect(n.has(v), v).toBe(true)
    })

    it('voices every gun distinctly', () => {
        const keys = new Set(Object.values(DF_GUN_VOICES).map(v => `${v.body}:${v.blast}:${v.crack}:${v.tail}`))
        expect(keys.size).toBe(Object.keys(DF_GUN_VOICES).length)
    })

    it('registers the engine sounds and the new zombie foley', () => {
        const e = names(registerDfEngineSounds)
        for (const n of ['df:hit', 'df:kill-head', 'df:round-start', 'df:round-end', 'df:heartbeat', 'df:pu-nuke']) expect(e.has(n), n).toBe(true)
        const w = names(registerDfWorldSounds)
        expect(w.has(DF_WORLD_SOUNDS.bruteStep)).toBe(true)
        expect(w.has(DF_WORLD_SOUNDS.bloaterGurgle)).toBe(true)
        expect(DF_TOLL_MOTIF.start).toHaveLength(4)
    })
})
