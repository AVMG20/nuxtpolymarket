import * as THREE from 'three'
import { modelShared } from './car-kit'
import { buildCar, type PlayerCar } from './car-models'
import type { CarId } from './config'
import { marksCar } from './stencil'
import { surging, type CarState } from './physics'
import type { CarPose } from './types'

/** The player's car model, posed on the road and animated from the physics state. */
export class CarView {
    readonly group: THREE.Group
    private readonly car: PlayerCar
    private readonly frontWheels: THREE.Object3D[]
    private roll = 0
    private pitch = 0
    private readonly poseMatrix = new THREE.Matrix4()
    private readonly posePos = new THREE.Vector3()
    private readonly poseQuat = new THREE.Quaternion()
    private readonly poseScale = new THREE.Vector3()

    constructor(car: CarId, color: number) {
        this.car = buildCar(car, color)
        this.group = this.car.group
        for (const w of this.car.wheels) w.parent!.userData.baseYaw = w.parent!.rotation.y
        this.frontWheels = this.car.wheels.map(w => w.parent!).filter(w => w.position.z < 0)
        const headlight = new THREE.SpotLight(0xe8f2ff, 40, 70, 0.42, 0.6, 1.2)
        headlight.position.set(0, 1.0, -1.8)
        headlight.target.position.set(0, 0, -30)
        this.group.add(headlight, headlight.target)
        // The shared materials carry the mark; only ghosts test it. The shadow and flames are left for ghosts to cover.
        const unmarked = new Set<THREE.Material>([modelShared().shadow, this.car.flameMat])
        this.group.traverse((o) => {
            if (o instanceof THREE.Mesh && !Array.isArray(o.material) && !unmarked.has(o.material)) marksCar(o.material)
        })
    }

    setPaint(color: number) {
        this.car.paint.color.setHex(color)
    }

    /** Places the car; `poseCar` works out where and which way up. */
    place(pos: THREE.Vector3, quat: THREE.Quaternion) {
        this.group.position.copy(pos)
        this.group.quaternion.copy(quat)
    }

    /** Where the car is drawn, read off the model so it holds every tilt the model takes. */
    pose(out: CarPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }): CarPose {
        this.group.updateWorldMatrix(true, false)
        this.poseMatrix.copy(this.group.matrixWorld).decompose(this.posePos, this.poseQuat, this.poseScale)
        out.x = this.posePos.x
        out.y = this.posePos.y
        out.z = this.posePos.z
        out.qx = this.poseQuat.x
        out.qy = this.poseQuat.y
        out.qz = this.poseQuat.z
        out.qw = this.poseQuat.w
        return out
    }

    /** Body lean, steering, spinning wheels and exhaust flames for one frame. */
    animate(dt: number, s: CarState, latAcc: number, longAcc: number, throttle: boolean) {
        const nitro = surging(s)
        // The body leans out of bends and squats or dives with the throttle and brakes.
        this.roll += (THREE.MathUtils.clamp(-latAcc * 0.0035, -0.085, 0.085) - this.roll) * Math.min(1, dt * 10)
        this.pitch += (THREE.MathUtils.clamp(longAcc * 0.0022, -0.05, 0.04) - this.pitch) * Math.min(1, dt * 8)
        this.car.body.rotation.set(this.pitch, 0, this.roll)
        const steerVisual = -s.steer * 0.45 / (1 + Math.abs(s.speed) / 30)
        for (const w of this.frontWheels) w.rotation.y = (w.userData.baseYaw ?? 0) + steerVisual
        for (const w of this.car.wheels) w.rotation.x -= s.speed * dt / this.car.wheelRadius * (w.userData.dir ?? 1)
        const flicker = 0.75 + Math.random() * 0.5
        for (const f of this.car.flames) {
            const k = nitro ? 1.6 * flicker : (throttle ? 0.3 * flicker : 0.001)
            f.scale.set(nitro ? 1.3 : 0.8, nitro ? 1.3 : 0.8, k)
        }
        this.car.flameMat.color.setHex(nitro ? 0x9fd0ff : 0xff7a2a)
    }

    /** The tail lights in world space, for the light trails. */
    tailLights(out: [THREE.Vector3, THREE.Vector3]) {
        for (let i = 0; i < 2; i++) this.car.body.localToWorld(out[i]!.copy(this.car.tailPoints[i]!))
        return out
    }

    dispose() {
        this.car.dispose()
    }
}
