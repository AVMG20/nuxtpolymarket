// Holdfast — the RTS camera: a tilted perspective rig orbiting a ground
// target. Every input sets a goal; the rig eases toward it each frame so
// panning, zooming and rotating always glide instead of snapping.

import * as THREE from 'three'

const MIN_DIST = 12
const MAX_DIST = 62
const PITCH_NEAR = 0.82
const PITCH_FAR = 1.02

export class CameraRig {
    readonly camera = new THREE.PerspectiveCamera(34, 1, 0.5, 400)
    readonly target = new THREE.Vector3()
    readonly goal = new THREE.Vector3()
    dist = 34
    goalDist = 34
    yaw = 0
    goalYaw = 0
    /** Screen shake, decays on its own. */
    shake = 0

    private readonly ray = new THREE.Raycaster()
    private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    private readonly ndc = new THREE.Vector2()
    private readonly hit = new THREE.Vector3()

    constructor(private bounds: { minX: number, maxX: number, minZ: number, maxZ: number }) {}

    get pitch(): number {
        const t = (this.dist - MIN_DIST) / (MAX_DIST - MIN_DIST)
        return PITCH_NEAR + (PITCH_FAR - PITCH_NEAR) * Math.max(0, Math.min(1, t))
    }

    /** Screen-up direction on the ground plane. */
    forward(): { x: number, z: number } {
        return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }
    }

    right(): { x: number, z: number } {
        return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }
    }

    jumpTo(x: number, z: number, instant = false): void {
        this.goal.set(x, 0, z)
        this.clamp()
        if (instant) this.target.copy(this.goal)
    }

    /** Pan by screen-relative amounts in world units (right, up). */
    pan(dRight: number, dUp: number): void {
        const f = this.forward()
        const r = this.right()
        this.goal.x += r.x * dRight + f.x * dUp
        this.goal.z += r.z * dRight + f.z * dUp
        this.clamp()
    }

    /** Pan so the ground point under the cursor follows it (drag panning). */
    dragPan(from: THREE.Vector3, to: THREE.Vector3): void {
        this.goal.x += from.x - to.x
        this.goal.z += from.z - to.z
        this.target.x += from.x - to.x
        this.target.z += from.z - to.z
        this.clamp()
    }

    /** Zoom by a factor, keeping the ground point under the cursor in place. */
    zoom(factor: number, anchor?: THREE.Vector3 | null): void {
        const old = this.goalDist
        this.goalDist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.goalDist * factor))
        if (anchor) {
            const k = 1 - this.goalDist / old
            this.goal.x += (anchor.x - this.goal.x) * k
            this.goal.z += (anchor.z - this.goal.z) * k
            this.clamp()
        }
    }

    rotate(steps: number): void {
        this.goalYaw += steps * Math.PI / 2
    }

    private clamp(): void {
        const b = this.bounds
        this.goal.x = Math.max(b.minX, Math.min(b.maxX, this.goal.x))
        this.goal.z = Math.max(b.minZ, Math.min(b.maxZ, this.goal.z))
    }

    update(dt: number): void {
        const k = 1 - Math.exp(-dt * 10)
        this.target.lerp(this.goal, k)
        this.dist += (this.goalDist - this.dist) * (1 - Math.exp(-dt * 9))
        this.yaw += (this.goalYaw - this.yaw) * (1 - Math.exp(-dt * 8))
        const p = this.pitch
        const cam = this.camera
        cam.position.set(
            this.target.x + Math.sin(this.yaw) * Math.cos(p) * this.dist,
            Math.sin(p) * this.dist,
            this.target.z + Math.cos(this.yaw) * Math.cos(p) * this.dist
        )
        if (this.shake > 0.001) {
            // Cosmetic jitter only.
            const s = this.shake * 0.25
            cam.position.x += (Math.random() - 0.5) * s
            cam.position.y += (Math.random() - 0.5) * s
            this.shake *= Math.exp(-dt * 9)
        }
        cam.lookAt(this.target.x, 0, this.target.z)
    }

    setAspect(aspect: number): void {
        this.camera.aspect = aspect
        this.camera.updateProjectionMatrix()
    }

    /** Ground point (y = height) under a normalised device coordinate, or null. */
    groundAt(ndcX: number, ndcY: number, out: THREE.Vector3, height = 0): THREE.Vector3 | null {
        this.ndc.set(ndcX, ndcY)
        this.ray.setFromCamera(this.ndc, this.camera)
        this.plane.constant = -height
        const hit = this.ray.ray.intersectPlane(this.plane, this.hit)
        if (!hit) return null
        return out.copy(hit)
    }
}
