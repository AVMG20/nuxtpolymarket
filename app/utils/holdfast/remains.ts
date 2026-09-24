// Holdfast — what a battle leaves behind: fallen soldiers that topple and
// slowly sink away, arrows stuck in the ground and in timber, and buildings
// that crumble into the earth instead of vanishing. All cosmetic, all pooled.

import * as THREE from 'three'

interface Corpse {
    x: number
    y: number
    z: number
    yaw: number
    /** Direction the body topples, relative to yaw. */
    fall: number
    age: number
    color: THREE.Color
    slide: number
}

interface Stuck {
    pos: THREE.Vector3
    quat: THREE.Quaternion
    age: number
    fire: boolean
    scale: number
}

interface Collapse {
    mesh: THREE.Object3D
    age: number
    baseY: number
    tilt: number
}

const CORPSE_MAX = 320
const STUCK_MAX = 500
const CORPSE_LIFE = 7
const STUCK_LIFE = 6

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const q2 = new THREE.Quaternion()
const v = new THREE.Vector3()
const s = new THREE.Vector3()
const e = new THREE.Euler()
const col = new THREE.Color()
const X_AXIS = new THREE.Vector3(1, 0, 0)

function pool(geo: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, max)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3)
    mesh.frustumCulled = false
    mesh.count = 0
    return mesh
}

export class Remains {
    private readonly bodies: THREE.InstancedMesh
    private readonly trims: THREE.InstancedMesh
    private readonly heads: THREE.InstancedMesh
    private readonly arrows: THREE.InstancedMesh
    private corpses: Corpse[] = []
    private stuck: Stuck[] = []
    private collapses: Collapse[] = []

    constructor(private scene: THREE.Scene, mat: THREE.Material, parts: { body: THREE.BufferGeometry, trim: THREE.BufferGeometry, head: THREE.BufferGeometry, arrow: THREE.BufferGeometry }, private unitScale: number) {
        this.bodies = pool(parts.body, mat, CORPSE_MAX)
        this.trims = pool(parts.trim, mat, CORPSE_MAX)
        this.heads = pool(parts.head, mat, CORPSE_MAX)
        this.arrows = pool(parts.arrow, mat, STUCK_MAX)
        this.bodies.castShadow = true
        scene.add(this.bodies, this.trims, this.heads, this.arrows)
    }

    addCorpse(x: number, y: number, z: number, color: number, yaw = Math.random() * Math.PI * 2): void {
        if (this.corpses.length >= CORPSE_MAX) this.corpses.shift()
        this.corpses.push({
            x,
            y,
            z,
            yaw,
            fall: (Math.random() < 0.5 ? Math.PI : 0) + (Math.random() - 0.5) * 1.4,
            age: 0,
            color: new THREE.Color(color),
            slide: 0.15 + Math.random() * 0.2
        })
    }

    stickArrow(pos: THREE.Vector3, quat: THREE.Quaternion, fire: boolean, scale: number): void {
        if (this.stuck.length >= STUCK_MAX) this.stuck.shift()
        this.stuck.push({ pos: pos.clone(), quat: quat.clone(), age: 0, fire, scale })
    }

    /** Hand over a building mesh; it shakes, tilts and sinks into the ground. */
    collapse(mesh: THREE.Object3D): void {
        this.collapses.push({ mesh, age: 0, baseY: mesh.position.y, tilt: (Math.random() - 0.5) * 0.3 })
    }

    update(dt: number): void {
        // Fallen soldiers: topple with a small bounce, lie still, then sink.
        let n = 0
        let w = 0
        for (const c of this.corpses) {
            c.age += dt
            if (c.age > CORPSE_LIFE) continue
            this.corpses[w++] = c
            const t = Math.min(1, c.age / 0.4)
            // Ease-in fall, with a little rebound as the body hits the ground.
            const tip = t < 1 ? t * t * (Math.PI / 2) : Math.PI / 2 - Math.sin(Math.min(1, (c.age - 0.4) / 0.18) * Math.PI) * 0.12
            const sink = c.age > CORPSE_LIFE - 1.2 ? (c.age - (CORPSE_LIFE - 1.2)) * 0.35 : 0
            const slide = Math.min(1, c.age / 0.4) * c.slide
            const dir = c.yaw + c.fall
            v.set(c.x + Math.sin(dir) * slide, c.y + 0.02 - sink, c.z + Math.cos(dir) * slide)
            // Yaw to the fall direction, then tip over about the local X axis.
            q.setFromEuler(e.set(0, dir, 0))
            q2.setFromAxisAngle(X_AXIS, tip)
            q.multiply(q2)
            s.setScalar(this.unitScale)
            m4.compose(v, q, s)
            this.bodies.setMatrixAt(n, m4)
            this.trims.setMatrixAt(n, m4)
            this.heads.setMatrixAt(n, m4)
            col.copy(c.color).multiplyScalar(0.7)
            this.bodies.setColorAt(n, col)
            this.trims.setColorAt(n, col.setRGB(0.75, 0.75, 0.75))
            this.heads.setColorAt(n, col.setRGB(0.85, 0.82, 0.8))
            n++
        }
        this.corpses.length = w
        for (const mesh of [this.bodies, this.trims, this.heads]) {
            mesh.count = n
            mesh.instanceMatrix.needsUpdate = true
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }

        // Stuck arrows fade by shrinking into whatever they hit.
        n = 0
        w = 0
        for (const a of this.stuck) {
            a.age += dt
            if (a.age > STUCK_LIFE) continue
            this.stuck[w++] = a
            const fade = a.age > STUCK_LIFE - 0.8 ? 1 - (a.age - (STUCK_LIFE - 0.8)) / 0.8 : 1
            s.set(a.scale, a.scale, 0.42 * fade)
            m4.compose(a.pos, a.quat, s)
            this.arrows.setMatrixAt(n, m4)
            this.arrows.setColorAt(n, a.fire && a.age < 1.5 ? col.setRGB(2.2, 1, 0.3) : col.setRGB(0.85, 0.85, 0.85))
            n++
        }
        this.stuck.length = w
        this.arrows.count = n
        this.arrows.instanceMatrix.needsUpdate = true
        if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true

        // Crumbling buildings.
        w = 0
        for (const c of this.collapses) {
            c.age += dt
            if (c.age > 1.2) {
                this.scene.remove(c.mesh)
                continue
            }
            this.collapses[w++] = c
            const t = c.age / 1.2
            c.mesh.position.y = c.baseY - t * t * 3
            c.mesh.rotation.z = c.tilt * t + Math.sin(c.age * 40) * 0.03 * (1 - t)
            c.mesh.rotation.x = c.tilt * 0.5 * t
            c.mesh.scale.y = Math.max(0.05, 1 - t * 0.6)
        }
        this.collapses.length = w
    }

    clear(): void {
        for (const c of this.collapses) this.scene.remove(c.mesh)
        this.corpses = []
        this.stuck = []
        this.collapses = []
    }
}
