// Holdfast — arrow storms. Every real arrow in the sim gets a couple of
// cosmetic companions loosed alongside it (they scatter around the target
// and stick where they land), and every arrow in the air draws a faint
// streak, so a firefight reads as a sky full of arrows.

import * as THREE from 'three'

interface Flight {
    fx: number
    fy: number
    fz: number
    tx: number
    ty: number
    tz: number
    t: number
    dur: number
    fire: boolean
}

const MAX_FLIGHTS = 900
const MAX_TRAILS = 1800

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const v = new THREE.Vector3()
const d = new THREE.Vector3()
const s = new THREE.Vector3()
const col = new THREE.Color()
const Z = new THREE.Vector3(0, 0, 1)

export class Volleys {
    readonly arrows: THREE.InstancedMesh
    readonly trails: THREE.InstancedMesh
    private flights: Flight[] = []
    private trailCount = 0

    constructor(arrowGeo: THREE.BufferGeometry, mat: THREE.Material, private land: (pos: THREE.Vector3, quat: THREE.Quaternion, fire: boolean) => void) {
        this.arrows = new THREE.InstancedMesh(arrowGeo, mat, MAX_FLIGHTS)
        this.arrows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLIGHTS * 3).fill(1), 3)
        this.arrows.frustumCulled = false
        this.arrows.count = 0
        // A streak is a unit box stretched behind the arrow; additive so it reads as motion.
        const streak = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5)
        this.trails = new THREE.InstancedMesh(streak, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_TRAILS)
        this.trails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRAILS * 3), 3)
        this.trails.frustumCulled = false
        this.trails.count = 0
        this.trails.renderOrder = 7
    }

    /** Cosmetic arrows flying with a real one, scattered around its target. */
    escort(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, dur: number, fire: boolean, count: number): void {
        for (let i = 0; i < count; i++) {
            if (this.flights.length >= MAX_FLIGHTS) return
            const a = Math.random() * Math.PI * 2
            const r = 0.4 + Math.random() * 0.9
            this.flights.push({
                fx: fx + (Math.random() - 0.5) * 0.3,
                fy,
                fz: fz + (Math.random() - 0.5) * 0.3,
                tx: tx + Math.cos(a) * r,
                ty: 0.03,
                tz: tz + Math.sin(a) * r,
                t: -Math.random() * 0.12,
                dur: dur * (0.95 + Math.random() * 0.2),
                fire
            })
        }
    }

    beginTrails(): void {
        this.trailCount = 0
    }

    /** Add a streak behind an arrow at `pos` travelling along unit `dir`. */
    trail(pos: THREE.Vector3, dir: THREE.Vector3, thick: number, fire: boolean): void {
        if (this.trailCount >= MAX_TRAILS) return
        q.setFromUnitVectors(Z, dir)
        m4.compose(pos, q, s.set(0.03 * thick, 0.03 * thick, 0.85))
        this.trails.setMatrixAt(this.trailCount, m4)
        this.trails.setColorAt(this.trailCount, fire ? col.setRGB(1, 0.55, 0.2) : col.setRGB(0.9, 0.9, 0.85))
        this.trailCount++
    }

    update(dt: number, thick: number): void {
        let n = 0
        let w = 0
        for (const f of this.flights) {
            f.t += dt
            const p = Math.max(0, Math.min(1, f.t / f.dur))
            const dx = f.tx - f.fx
            const dz = f.tz - f.fz
            const arc = Math.hypot(dx, dz) * 0.17
            const x = f.fx + dx * p
            const z = f.fz + dz * p
            const y = f.fy + (f.ty - f.fy) * p + arc * 4 * p * (1 - p)
            d.set(dx, (f.ty - f.fy) + arc * 4 * (1 - 2 * p), dz).normalize()
            if (p >= 1) {
                q.setFromUnitVectors(Z, d)
                this.land(v.set(x - d.x * 0.18, Math.max(0.04, y), z - d.z * 0.18), q, f.fire)
                continue
            }
            this.flights[w++] = f
            if (f.t < 0) continue
            q.setFromUnitVectors(Z, d)
            v.set(x - d.x * 0.21, y - d.y * 0.21, z - d.z * 0.21)
            m4.compose(v, q, s.set(thick, thick, 0.42))
            this.arrows.setMatrixAt(n, m4)
            this.arrows.setColorAt(n, f.fire ? col.setRGB(3, 1.4, 0.4) : col.setRGB(1, 1, 1))
            n++
            this.trail(v, d, thick, f.fire)
        }
        this.flights.length = w
        this.arrows.count = n
        this.arrows.instanceMatrix.needsUpdate = true
        if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true
    }

    endTrails(): void {
        this.trails.count = this.trailCount
        this.trails.instanceMatrix.needsUpdate = true
        if (this.trails.instanceColor) this.trails.instanceColor.needsUpdate = true
    }
}
