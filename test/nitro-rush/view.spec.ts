import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { trackOf } from './bot-lap'
import { ChaseCamera, shotFor } from '../../app/utils/nitro-rush/camera'
import { poseCar } from '../../app/utils/nitro-rush/car-pose'
import { createCar, slipAngle, stepCar } from '../../app/utils/nitro-rush/physics'
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

    it('holds a standard screen to the pixel budget but never below native', () => {
        const r = new AdaptiveResolution(1)
        r.fit(2560, 1440)
        expect(r.ratio).toBe(1.5)
        r.fit(3200, 1800)
        expect(r.ratio * r.ratio * 3200 * 1800).toBeCloseTo(9e6, 0)
        r.fit(7680, 4320)
        expect(r.ratio).toBe(1)
    })

    it('climbs back when the view shrinks, but not past a ratio that ran slow', () => {
        const r = new AdaptiveResolution(1)
        r.fit(3840, 2160)
        r.fit(1920, 1080)
        run(r, 1 / 120, 60)
        expect(r.ratio).toBe(1.5)

        const slow = new AdaptiveResolution(1)
        run(slow, 1 / 30, 4)
        expect(slow.ratio).toBe(1.25)
        slow.fit(1920, 1080)
        run(slow, 1 / 120, 60, 4)
        expect(slow.ratio).toBe(1.25)
    })

    it('renders native rather than supersample too little to help', () => {
        const r = new AdaptiveResolution(1)
        r.fit(3840, 2160)
        expect(r.ratio).toBe(1)
    })

    it('never drops below a scaled standard screen\'s own pixels', () => {
        const r = new AdaptiveResolution(1.25)
        r.fit(4096, 1728)
        expect(r.ratio).toBe(1.25)
        run(r, 1 / 30, 30)
        expect(r.ratio).toBe(1.25)
    })

    it('leaves retina to its own ratio at any size', () => {
        const r = new AdaptiveResolution(2)
        r.fit(3840, 2160)
        expect(r.ratio).toBe(2)
    })
})

describe('chase camera on a bank', () => {
    it('stays over the road when the car runs along the raised side', () => {
        const track = trackOf(false, ['straight-20', 'start', 'straight-200', 'bank-right', 'straight-200', 'bank-flat', 'finish', 'straight-200'])
        const cam = new ChaseCamera(track)
        cam.setViewport(1440, 900)
        // Up by the left wall, the high side of a bank that's low on the right.
        const car = createCar(track, track.startS, -8)
        cam.cut(car.heading)
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const dt = 1 / 120
        let lowest = Infinity
        while (car.proj.s < track.finishS) {
            stepCar(car, { throttle: 1, brake: 0, steer: 0, drift: false }, track, dt)
            const { x, z, y, heading, travel, rel, vy, speed, onRail, airborne, proj: { s: along, lateral } } = car
            poseCar(track, { x, z, y, along, lateral, heading, rel, vy, speed, onRail, airborne }, pos, quat)
            cam.update(dt, 0, { x, y: pos.y, z, along, lateral, heading, travel, slip: slipAngle(car), speed, speedK: 0.5, nitroK: 0, latAcc: 0, pos, quat, onRail, airborne }, { target: 1, snap: true })
            const at = cam.camera.position
            const under = track.project(at.x, at.z, car.proj.seg)
            const f = track.frameAt(under.s)
            lowest = Math.min(lowest, at.y - (f.y + f.ry * under.lateral / Math.hypot(f.rx, f.rz)))
        }
        expect(lowest).toBeGreaterThan(0.5)
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
