import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ChaseCamera, type CameraSubject } from '../../app/utils/nitro-rush/camera'
import { bridgeSprintDef } from './fork-courses'
import { Track } from '#shared/utils/nitro-rush/track'

describe('the chase camera on a forked course', () => {
    it('reads the road heights off the branch the car is on', () => {
        const track = new Track(bridgeSprintDef())
        const bridge = track.branches[1]!
        // Up on the bridge, where the main line at the same distance is still on the ground.
        const along = bridge.length - 300
        const p = bridge.pointAt(along)
        expect(p.y - track.pointAt(along).y).toBeGreaterThan(10)
        const cam = new ChaseCamera(track)
        const car: CameraSubject = {
            x: p.x, y: p.y, z: p.z, along, branch: 1, lateral: 0, heading: Math.atan2(-p.tx, -p.tz), travel: Math.atan2(-p.tx, -p.tz), slip: 0,
            speed: 0, speedK: 0, nitroK: 0, latAcc: 0, pos: new THREE.Vector3(p.x, p.y, p.z), quat: new THREE.Quaternion(), onRail: false, airborne: false
        }
        cam.cut(car.heading)
        cam.update(1 / 60, 0, car, { target: 1, snap: true })
        expect(cam.camera.position.y).toBeGreaterThan(p.y)
    })
})
