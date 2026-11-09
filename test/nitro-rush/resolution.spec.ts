import { describe, expect, it } from 'vitest'
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

    it('takes no notice of slow frames while held, then or after', () => {
        const r = new AdaptiveResolution(1)
        r.held = true
        expect(run(r, 1 / 20, 30)).toBe(false)
        expect(r.ratio).toBe(1.5)
        r.held = false
        expect(run(r, 1 / 60, 30, 30)).toBe(false)
        expect(r.ratio).toBe(1.5)
    })

    it('holds a standard screen to the pixel budget but never below native', () => {
        const r = new AdaptiveResolution(1)
        r.fit(2560, 1440)
        expect(r.ratio).toBe(1.5)
        r.fit(3200, 1800)
        expect(r.ratio * r.ratio * 3200 * 1800).toBeCloseTo(9e6, 0)
        r.fit(7680, 4320)
        expect(r.ratio).toBe(1)
    })

    it('never drops below a scaled standard screen\'s own pixels', () => {
        const r = new AdaptiveResolution(1.25)
        r.fit(4096, 1728)
        expect(r.ratio).toBe(1.25)
        run(r, 1 / 30, 30)
        expect(r.ratio).toBe(1.25)
    })
})
