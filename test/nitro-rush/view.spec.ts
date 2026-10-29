import { describe, expect, it } from 'vitest'
import { shotFor } from '../../app/utils/nitro-rush/camera'
import { COUNTDOWN_SECONDS } from '../../app/utils/nitro-rush/config'
import { AdaptiveResolution } from '../../app/utils/nitro-rush/resolution'

/** Feeds `seconds` of frames at a steady frame time, from `start`; returns whether any changed the ratio. */
function run(r: AdaptiveResolution, frame: number, seconds: number, start = 0) {
    let changed = false
    for (let t = start; t < start + seconds; t += frame) changed = r.sample(frame, t) || changed
    return changed
}

describe('adaptive resolution', () => {
    it('supersamples standard screens and keeps retina at its own ratio, capped at 2', () => {
        expect(new AdaptiveResolution(1).ratio).toBe(1.5)
        expect(new AdaptiveResolution(2).ratio).toBe(2)
        expect(new AdaptiveResolution(3).ratio).toBe(2)
    })

    it('backs off on slow frames but never below native', () => {
        const r = new AdaptiveResolution(1)
        expect(run(r, 1 / 30, 30)).toBe(true)
        expect(r.ratio).toBe(1)
    })

    it('never climbs back to a ratio that ran slow', () => {
        const r = new AdaptiveResolution(2)
        run(r, 1 / 30, 4)
        expect(r.ratio).toBe(1.75)
        run(r, 1 / 120, 60, 4)
        expect(r.ratio).toBe(1.75)
    })

    it('holds steady at a smooth frame rate', () => {
        const r = new AdaptiveResolution(1)
        expect(run(r, 1 / 60, 30)).toBe(false)
        expect(r.ratio).toBe(1.5)
    })
})

describe('camera shots', () => {
    it('sweeps from the orbit to the chase over the countdown', () => {
        expect(shotFor('countdown', COUNTDOWN_SECONDS, 0)).toEqual({ target: 0, snap: true })
        expect(shotFor('countdown', 0, 0)).toEqual({ target: 1, snap: true })
        expect(shotFor('racing', 0, 0)).toEqual({ target: 1, snap: false })
    })

    it('holds the chase briefly past a finish, then eases back to the orbit', () => {
        expect(shotFor('finished', 0, 1).target).toBe(1)
        expect(shotFor('finished', 0, 2)).toEqual({ target: 0, snap: false })
        expect(shotFor('attract', 0, 0)).toEqual({ target: 0, snap: true })
    })
})
