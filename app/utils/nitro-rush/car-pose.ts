import * as THREE from 'three'
import { headingOf, newTrackFrame, wrapAngle, type Track } from '#shared/utils/nitro-rush/track'

/** The car between two physics steps, as rendering needs it. */
export interface PoseSample {
    x: number
    z: number
    /** The wheels' height. */
    y: number
    /** Distance along the course. */
    along: number
    lateral: number
    heading: number
    /** On rails: the car's angle to the road, + to the left. */
    rel: number
    vy: number
    speed: number
    onRail: boolean
    airborne: boolean
}

const frame = newTrackFrame()
const fwd = new THREE.Vector3()
const up = new THREE.Vector3()
const side = new THREE.Vector3()
const basis = new THREE.Matrix4()

/**
 * Where the car model sits and which way it faces. On the road it lies on the
 * surface: pitched up a ramp, tipped on a bank, upside down at the top of a
 * looping. In the air its nose follows its flight.
 */
export function poseCar(track: Track, c: PoseSample, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const f = track.frameAt(c.along, frame)
    if (c.airborne) {
        const pitch = Math.atan2(c.vy, Math.max(4, Math.abs(c.speed)))
        fwd.set(-Math.sin(c.heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(c.heading) * Math.cos(pitch))
        up.set(0, 1, 0)
        pos.set(c.x, c.y, c.z)
    } else {
        // The car's angle to the road, then its nose along the surface that much off the road's line.
        const rel = c.onRail ? c.rel : wrapAngle(c.heading - headingOf(f.tx, f.tz))
        const cos = Math.cos(rel)
        const sin = Math.sin(rel)
        fwd.set(f.tx * cos - f.rx * sin, f.ty * cos - f.ry * sin, f.tz * cos - f.rz * sin)
        // The surface's normal: right crossed with the road's direction.
        up.set(f.ry * f.tz - f.rz * f.ty, f.rz * f.tx - f.rx * f.tz, f.rx * f.ty - f.ry * f.tx)
        // On rails and banks the road's own frame places the car; on plain road its spot on the plan does, as it always has.
        if (c.onRail || Math.abs(f.ry) > 1e-4) pos.set(f.x + f.rx * c.lateral, f.y + f.ry * c.lateral, f.z + f.rz * c.lateral)
        else pos.set(c.x, c.y, c.z)
    }
    fwd.normalize()
    // Model axes: nose down -z, roof up +y, so x is forward crossed with up.
    side.crossVectors(fwd, up).normalize()
    up.crossVectors(side, fwd)
    basis.makeBasis(side, up, fwd.negate())
    quat.setFromRotationMatrix(basis)
}
