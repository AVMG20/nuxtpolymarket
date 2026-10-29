import * as THREE from 'three'
import { buildPlayerCar, type PlayerCar } from './models'
import type { CarState } from './physics'
import type { Projection } from '#shared/utils/nitro-rush/track'

/** The player's car model, posed on the road and animated from the physics state. */
export class CarView {
    readonly group: THREE.Group
    private readonly car: PlayerCar
    private readonly frontWheels: THREE.Object3D[]
    private roll = 0
    private pitch = 0

    constructor(color: number) {
        this.car = buildPlayerCar(color)
        this.group = this.car.group
        // Yaw first, then the road's slope in the car's own frame.
        this.group.rotation.order = 'YXZ'
        for (const w of this.car.wheels) w.parent!.userData.baseYaw = w.parent!.rotation.y
        this.frontWheels = this.car.wheels.map(w => w.parent!).filter(w => w.position.z < 0)
        const headlight = new THREE.SpotLight(0xe8f2ff, 40, 70, 0.42, 0.6, 1.2)
        headlight.position.set(0, 1.0, -1.8)
        headlight.target.position.set(0, 0, -30)
        this.group.add(headlight, headlight.target)
    }

    setPaint(color: number) {
        this.car.paint.color.setHex(color)
    }

    /** Places the car, pitched by the slope ahead of its nose and rolled by the slope across it. */
    place(x: number, y: number, z: number, heading: number, road: Projection) {
        const gx = road.grade * road.tx
        const gz = road.grade * road.tz
        const sin = Math.sin(heading)
        const cos = Math.cos(heading)
        this.group.position.set(x, y, z)
        this.group.rotation.set(Math.atan(-gx * sin - gz * cos), heading, Math.atan(gx * cos - gz * sin))
    }

    /** Body lean, steering, spinning wheels and exhaust flames for one frame. */
    animate(dt: number, s: CarState, latAcc: number, longAcc: number, throttle: boolean) {
        const nitro = s.nitroTime > 0
        // The body leans out of bends and squats or dives with the throttle and brakes.
        this.roll += (THREE.MathUtils.clamp(-latAcc * 0.0035, -0.085, 0.085) - this.roll) * Math.min(1, dt * 10)
        this.pitch += (THREE.MathUtils.clamp(longAcc * 0.0022, -0.05, 0.04) - this.pitch) * Math.min(1, dt * 8)
        this.car.body.rotation.set(this.pitch, 0, this.roll)
        const steerVisual = -s.steer * 0.45 / (1 + Math.abs(s.speed) / 30)
        for (const w of this.frontWheels) w.rotation.y = (w.userData.baseYaw ?? 0) + steerVisual
        for (const w of this.car.wheels) w.rotation.x -= s.speed * dt / 0.37 * (w.userData.dir ?? 1)
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
