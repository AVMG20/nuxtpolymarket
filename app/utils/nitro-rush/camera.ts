import * as THREE from 'three'
import { COUNTDOWN_SECONDS } from './config'
import { newTrackPoint, wrapAngle, type Track } from '#shared/utils/nitro-rush/track'
import type { Phase } from './types'

const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** The car this frame, interpolated between physics steps, and how hard it is moving. */
export interface CameraSubject {
    x: number
    y: number
    z: number
    /** Distance along the course, for the road heights behind and ahead. */
    along: number
    heading: number
    travel: number
    slip: number
    speed: number
    /** 0 to 1 of top speed. */
    speedK: number
    /** 0 to 1, eased in and out with the nitro burn. */
    nitroK: number
    latAcc: number
}

/** How far toward the chase view (1) from the orbit (0) a phase wants, and whether to jump there. */
export function shotFor(phase: Phase, countdownLeft: number, sinceFinish: number) {
    if (phase === 'countdown') return { target: ease(THREE.MathUtils.clamp(1 - countdownLeft / COUNTDOWN_SECONDS, 0, 1)), snap: true }
    if (phase === 'racing') return { target: 1, snap: false }
    // A beat on the chase cam past the line, then the orbit takes over.
    if (phase === 'finished') return { target: sinceFinish < 1.5 ? 1 : 0, snap: false }
    return { target: 0, snap: true }
}

/** A chase camera that blends with the menu's orbit, shakes on hits and widens its lens with speed. */
export class ChaseCamera {
    readonly camera = new THREE.PerspectiveCamera(64, 1, 0.1, 2000)
    /** The heading the camera follows; the speed lines stream along it. */
    yaw = 0
    /** 0 on the orbit, 1 on the chase. */
    blend = 0
    private track: Track
    private width = 1
    private height = 1
    /** Set on a fresh run: the camera cuts to the grid rather than flying there. */
    private cutNext = false
    private trauma = 0
    private readonly pos = new THREE.Vector3(0, 3, 9)
    private readonly look = new THREE.Vector3()
    private readonly chasePos = new THREE.Vector3()
    private readonly chaseLook = new THREE.Vector3()
    private readonly orbitPos = new THREE.Vector3()
    private readonly orbitLook = new THREE.Vector3()
    private readonly tmpP = newTrackPoint()

    constructor(track: Track) {
        this.track = track
    }

    setTrack(track: Track) {
        this.track = track
    }

    setViewport(width: number, height: number) {
        this.width = width
        this.height = height
        this.camera.aspect = width / height
        this.camera.updateProjectionMatrix()
    }

    cut(yaw: number) {
        this.yaw = yaw
        this.cutNext = true
    }

    shake(amount: number) {
        this.trauma = Math.min(1, this.trauma + amount)
    }

    update(dt: number, time: number, car: CameraSubject, shot: { target: number, snap: boolean }) {
        const { x, y, z } = car
        // It follows where the car is going more than where it points, so a drift shows the car sideways.
        const yawTarget = car.speed < -1 ? car.heading : car.travel + car.slip * 0.3
        this.yaw += wrapAngle(yawTarget - this.yaw) * Math.min(1, dt * 4.5)
        const fx = -Math.sin(this.yaw)
        const fz = -Math.cos(this.yaw)
        const back = 6.6 + car.speedK * 1.3 + car.nitroK * 0.6
        // Heights from the road behind and ahead, so the camera tips up a climb and down a drop.
        const roadBehind = this.track.pointAt(car.along - back, this.tmpP).y
        const roadAhead = this.track.pointAt(car.along + 9, this.tmpP).y
        const chasePos = this.chasePos.set(x - fx * back, roadBehind + 2.4 + car.speedK * 0.2, z - fz * back)
        const chaseLook = this.chaseLook.set(x + fx * 9, roadAhead + 1.1, z + fz * 9)
        const orbitA = time * 0.22
        const orbitPos = this.orbitPos.set(x + Math.sin(orbitA) * 9.5, y + 2.3 + Math.sin(time * 0.3) * 0.5, z + Math.cos(orbitA) * 9.5)
        const orbitLook = this.orbitLook.set(x, y + 0.9, z)

        if (shot.snap) this.blend = shot.target
        else this.blend += (shot.target - this.blend) * Math.min(1, dt * (shot.target < this.blend ? 0.8 : 4))
        const pos = orbitPos.lerp(chasePos, this.blend)
        const look = orbitLook.lerp(chaseLook, this.blend)
        if (this.cutNext) {
            this.pos.copy(pos)
            this.look.copy(look)
            this.cutNext = false
        } else {
            this.pos.lerp(pos, 1 - Math.exp(-dt * (this.blend > 0.98 ? 16 : 6)))
            this.look.lerp(look, 1 - Math.exp(-dt * 16))
        }

        this.trauma = Math.max(0, this.trauma - dt * 1.8)
        const shake = this.trauma * this.trauma
        const t = time * 40
        const camera = this.camera
        camera.position.set(this.pos.x + Math.sin(t * 1.1) * shake * 0.4, this.pos.y + Math.sin(t * 1.7 + 1) * shake * 0.3, this.pos.z)
        camera.lookAt(this.look)
        camera.rotateZ(car.latAcc * 0.0012 * this.blend + Math.sin(t * 0.9) * shake * 0.03)
        const fov = this.baseFov() + (6 + car.speedK * 14) * this.blend + car.nitroK * 8
        if (Math.abs(fov - camera.fov) > 0.01) {
            camera.fov = fov
            camera.updateProjectionMatrix()
        }
    }

    /** Wider lens on narrow screens so the bends stay in view. */
    private baseFov() {
        const aspect = this.width / this.height
        const minHorizontal = THREE.MathUtils.degToRad(84)
        const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontal / 2) / aspect))
        return THREE.MathUtils.clamp(Math.max(62, needed), 62, 104)
    }
}
