import * as THREE from 'three'
import { LightTrail, Particles, Shockwaves, SkidMarks, SpeedLines } from './fx'
import { slipAngle, type CarInput, type CarState } from './physics'

/** Rear wheels in the car's local space (nose toward -z). */
const REAR_WHEELS = [new THREE.Vector2(-0.82, 1.42), new THREE.Vector2(0.82, 1.42)]
const TAIL_RED = new THREE.Color(0xff2040)
const NITRO_BLUE = new THREE.Color(0x4da3ff)
const NITRO_PALE = new THREE.Color(0x9fd0ff)
const WHITE = new THREE.Color(0xffffff)
const NITRO_SPARK = new THREE.Color(0x8fc4ff)
const NITRO_SHOCK = new THREE.Color(0x4d7cff)
const WALL_SPARK = new THREE.Color(0xffb050)
const WALL_SHOCK = new THREE.Color(0xffc070)
const TYRE_SMOKE = new THREE.Color(0x8a8c96)

/** How hard the rear tyres slide, 0 to 1: sideways, locked up or spinning off the line. */
export function tyreSlide(s: CarState, input: CarInput, racing: boolean) {
    const slip = Math.abs(slipAngle(s))
    // Mid-drift the brakes are off, so a held pedal locks nothing.
    const locked = racing && !s.drifting && input.brake > 0 && s.speed > 18
    const spin = racing && input.throttle > 0 && s.speed > 0 && s.speed < 14
    return Math.abs(s.speed) < 4 ? 0 : Math.max(Math.min(1, (slip - 0.06) * 3), locked ? 0.55 : 0, spin ? 0.7 : 0)
}

/** What the per-frame effects need from the camera and the car. */
export interface FxFrame {
    camera: THREE.PerspectiveCamera
    /** Viewport height in CSS pixels and the renderer's pixel ratio, for minimum on-screen sizes. */
    height: number
    pixelRatio: number
    /** The camera's heading, which the speed lines stream along. */
    yaw: number
    /** 0 on the menu's orbit, 1 on the chase view. */
    blend: number
    roadY: number
    speed: number
    speedK: number
    nitroK: number
    nitro: boolean
    tails: readonly THREE.Vector3[]
}

/** Everything the car leaves behind: skid marks, smoke, sparks, shockwaves, light trails and speed lines. */
export class CarEffects {
    readonly speedLines = new SpeedLines(200)
    private readonly skids = new SkidMarks(2)
    private readonly sparks = new Particles()
    private readonly smoke = new Particles(2500, 'smoke')
    private readonly shock = new Shockwaves()
    private readonly trails = [new LightTrail(TAIL_RED, 40), new LightTrail(TAIL_RED, 40)]
    private readonly tmpV = new THREE.Vector3()

    constructor(scene: THREE.Scene) {
        scene.add(this.skids.mesh, this.sparks.points, this.smoke.points, this.speedLines.mesh, this.shock.group)
        for (const t of this.trails) scene.add(t.mesh)
    }

    clear() {
        this.skids.clear()
        this.sparks.clear()
        this.smoke.clear()
    }

    clearSkids() {
        this.skids.clear()
    }

    /** Snaps the trails to the tail lights and lifts the skid marks, for a car that jumped there. */
    place(tails: readonly THREE.Vector3[]) {
        for (let i = 0; i < 2; i++) {
            this.trails[i]!.reset(tails[i]!)
            this.skids.lift(i)
        }
    }

    /** Skid marks and smoke off the rear tyres while they slide. */
    tyres(dt: number, s: CarState, amount: number) {
        const cos = Math.cos(s.heading)
        const sin = Math.sin(s.heading)
        REAR_WHEELS.forEach((w, i) => {
            if (amount <= 0) {
                this.skids.lift(i)
                return
            }
            // The model's local frame turned by the heading.
            const x = s.x + w.x * cos + w.y * sin
            const z = s.z - w.x * sin + w.y * cos
            const y = s.proj.y + s.proj.grade * ((x - s.x) * s.proj.tx + (z - s.z) * s.proj.tz)
            this.skids.add(i, this.tmpV.set(x, y, z), 0.35 + amount * 0.65)
            if (Math.random() < amount * dt * 60) {
                this.smoke.emit(x, y + 0.35, z, 1 + Math.round(amount * 2), {
                    color: TYRE_SMOKE, speed: 1.2, up: 1.2, spread: 0.5, life: 1.6, size: 0.9, gravity: -0.8, drag: 1.4, grow: 3.2, jitter: 0.08,
                    vx: -Math.sin(s.travel) * s.speed * 0.25, vz: -Math.cos(s.travel) * s.speed * 0.25
                })
            }
        })
    }

    /** Sparks where the car meets the wall, and a shockwave on a hard hit. */
    wallHit(s: CarState, k: number, hard: boolean) {
        const side = Math.sign(s.proj.lateral)
        const cx = s.x - s.proj.tz * side * 1.1
        const cz = s.z + s.proj.tx * side * 1.1
        this.sparks.emit(cx, s.proj.y + 0.4, cz, Math.round(10 + k * 50), {
            color: WALL_SPARK, speed: 8 + k * 10, up: 2, life: 0.5, size: 0.13, gravity: 16,
            vx: -Math.sin(s.travel) * s.speed * 0.6, vz: -Math.cos(s.travel) * s.speed * 0.6
        })
        if (hard) this.shock.fire(cx, s.proj.y + 0.1, cz, WALL_SHOCK, 4, 0.35)
    }

    nitroFired(s: CarState) {
        this.shock.fire(s.x, s.proj.y + 0.1, s.z, NITRO_SHOCK, 9, 0.5)
    }

    /** Advances the particles, spraying sparks from under the car while the nitro burns. */
    update(dt: number, car: THREE.Vector3, nitro: boolean) {
        if (nitro) this.sparks.emit(car.x, car.y + 0.15, car.z, 3, { color: NITRO_SPARK, speed: 4, up: 2, life: 0.35, size: 0.16, gravity: 10 })
        this.sparks.update(dt)
        this.smoke.update(dt)
        this.shock.update(dt)
    }

    /** Sizes, trails and speed lines that follow the camera and the car's pose this frame. */
    frame(dt: number, f: FxFrame) {
        const { camera, height } = f
        this.sparks.setScale(height, f.pixelRatio, camera.fov)
        this.smoke.setScale(height, f.pixelRatio, camera.fov)

        // Tail-light ribbons: a faint wake at speed, bright on nitro.
        for (let i = 0; i < 2; i++) {
            this.trails[i]!.setColor(f.nitro ? NITRO_BLUE : TAIL_RED)
            this.trails[i]!.update(f.tails[i]!, (f.nitroK * 0.5 + Math.max(0, f.speedK - 0.5) * 0.25) * f.blend, f.nitro ? 0.08 : 0.04)
        }

        // Speed lines sit around the camera, streaming back along its heading.
        this.speedLines.mesh.position.set(camera.position.x, f.roadY, camera.position.z)
        this.speedLines.mesh.rotation.y = f.yaw
        const intensity = f.blend * (Math.max(0, f.speedK - 0.45) * 0.7 + f.nitroK * 0.45)
        const minWidth = 1.6 / (height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 8
        this.speedLines.update(dt, Math.abs(f.speed) * 3, intensity, f.nitro ? NITRO_PALE : WHITE, minWidth)
    }

    dispose() {
        this.sparks.dispose()
        this.smoke.dispose()
        this.speedLines.dispose()
        this.shock.dispose()
        this.skids.dispose()
        for (const t of this.trails) t.dispose()
    }
}
