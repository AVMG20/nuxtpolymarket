import * as THREE from 'three'
import { poseCar, type PoseSample } from './car-pose'
import type { CarState } from './physics'
import { wrapAngle, type Track } from '#shared/utils/nitro-rush/track'

/** The car as drawn between physics states, and the smoothed accelerations the body and camera lean off. */
export class CarMotion {
    private readonly prev = { x: 0, z: 0, y: 0, s: 0, branch: 0, heading: 0, lateral: 0, rel: 0 }
    readonly drawn: PoseSample = { x: 0, z: 0, y: 0, along: 0, branch: 0, lateral: 0, heading: 0, rel: 0, vy: 0, speed: 0, onRail: false, airborne: false }
    readonly pos = new THREE.Vector3()
    readonly quat = new THREE.Quaternion()
    latAcc = 0
    longAcc = 0
    private lastTravel = 0
    private lastSpeed = 0

    /** The state before a physics step, which `pose` interpolates from. */
    keep(s: CarState) {
        const p = this.prev
        p.x = s.x
        p.z = s.z
        p.heading = s.heading
        p.y = s.y
        p.s = s.proj.s
        p.branch = s.proj.branch
        p.lateral = s.proj.lateral
        p.rel = s.rel
    }

    /** Snaps the history to the state, so nothing blends across a teleport. */
    snap(s: CarState, track: Track) {
        this.keep(s)
        this.lastTravel = s.travel
        this.lastSpeed = s.speed
        this.pose(s, track, 1)
    }

    /** Poses the car `a` of the way from the kept state to `s`. */
    pose(s: CarState, track: Track, a: number) {
        const p = this.prev
        const d = this.drawn
        let ds = s.proj.s - p.s
        // A loop's s jumps by its length at the start line; onto another branch, distances along the old one mean nothing.
        if (s.proj.branch !== p.branch) ds = 0
        else if (track.closed && Math.abs(ds) > track.length / 2) ds -= Math.sign(ds) * track.length
        d.x = p.x + (s.x - p.x) * a
        d.z = p.z + (s.z - p.z) * a
        d.y = p.y + (s.y - p.y) * a
        d.along = s.proj.branch !== p.branch ? s.proj.s : p.s + ds * a
        d.branch = s.proj.branch
        d.lateral = p.lateral + (s.proj.lateral - p.lateral) * a
        d.heading = p.heading + wrapAngle(s.heading - p.heading) * a
        d.rel = p.rel + wrapAngle(s.rel - p.rel) * a
        d.vy = s.vy
        d.speed = s.speed
        d.onRail = s.onRail
        d.airborne = s.airborne
        poseCar(track, d, this.pos, this.quat)
    }

    /** Reads this frame's accelerations off the car's real motion. */
    sense(s: CarState, dt: number) {
        const dTravel = wrapAngle(s.travel - this.lastTravel)
        this.latAcc += (s.speed * dTravel / Math.max(dt, 1e-3) - this.latAcc) * Math.min(1, dt * 8)
        this.longAcc += ((s.speed - this.lastSpeed) / Math.max(dt, 1e-3) - this.longAcc) * Math.min(1, dt * 6)
        this.lastTravel = s.travel
        this.lastSpeed = s.speed
    }
}
