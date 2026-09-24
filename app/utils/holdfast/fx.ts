// Holdfast — pooled, instanced particle effects. Everything here is cosmetic,
// so Math.random() is fine. Nothing allocates per frame.

import * as THREE from 'three'

export interface BurstOptions {
    color: number
    count: number
    speed?: number
    up?: number
    spread?: number
    size?: number
    life?: number
    gravity?: number
    /** 0..1 random lightness variation per particle. */
    jitter?: number
    spin?: number
}

const tmpColor = new THREE.Color()
const tmpMat = new THREE.Matrix4()
const tmpQuat = new THREE.Quaternion()
const tmpEuler = new THREE.Euler()
const tmpPos = new THREE.Vector3()
const tmpScale = new THREE.Vector3()

/** Chunky tumbling bits: dust, sparks, rubble, poofs. */
export class Particles {
    readonly mesh: THREE.InstancedMesh
    private readonly max: number
    private count = 0
    private pos: Float32Array
    private vel: Float32Array
    private rot: Float32Array
    private life: Float32Array
    private maxLife: Float32Array
    private size: Float32Array
    private grav: Float32Array
    private col: Float32Array

    constructor(geometry: THREE.BufferGeometry, material: THREE.Material, max = 1600) {
        this.max = max
        this.mesh = new THREE.InstancedMesh(geometry, material, max)
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
        this.mesh.frustumCulled = false
        this.mesh.count = 0
        this.pos = new Float32Array(max * 3)
        this.vel = new Float32Array(max * 3)
        this.rot = new Float32Array(max * 3)
        this.life = new Float32Array(max)
        this.maxLife = new Float32Array(max)
        this.size = new Float32Array(max)
        this.grav = new Float32Array(max)
        this.col = new Float32Array(max * 3)
    }

    burst(x: number, y: number, z: number, o: BurstOptions): void {
        const speed = o.speed ?? 2
        const up = o.up ?? 2
        const spread = o.spread ?? 0.15
        const size = o.size ?? 0.08
        const life = o.life ?? 0.6
        const jitter = o.jitter ?? 0.15
        tmpColor.setHex(o.color)
        for (let n = 0; n < o.count; n++) {
            let i = this.count
            if (i >= this.max) {
                // Pool full: recycle a random slot rather than dropping the effect.
                i = Math.floor(Math.random() * this.max)
            } else {
                this.count++
            }
            const a = Math.random() * Math.PI * 2
            const s = speed * (0.4 + Math.random() * 0.6)
            this.pos[i * 3] = x + (Math.random() - 0.5) * spread
            this.pos[i * 3 + 1] = y + Math.random() * spread
            this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread
            this.vel[i * 3] = Math.cos(a) * s
            this.vel[i * 3 + 1] = up * (0.5 + Math.random() * 0.7)
            this.vel[i * 3 + 2] = Math.sin(a) * s
            this.rot[i * 3] = Math.random() * 6
            this.rot[i * 3 + 1] = Math.random() * 6
            this.rot[i * 3 + 2] = (o.spin ?? 8) * (Math.random() - 0.5)
            const l = life * (0.7 + Math.random() * 0.6)
            this.life[i] = l
            this.maxLife[i] = l
            this.size[i] = size * (0.6 + Math.random() * 0.8)
            this.grav[i] = o.gravity ?? 9
            const j = 1 + (Math.random() - 0.5) * jitter * 2
            this.col[i * 3] = tmpColor.r * j
            this.col[i * 3 + 1] = tmpColor.g * j
            this.col[i * 3 + 2] = tmpColor.b * j
        }
    }

    update(dt: number): void {
        let w = 0
        const colors = this.mesh.instanceColor!.array as Float32Array
        for (let i = 0; i < this.count; i++) {
            const l = this.life[i]! - dt
            if (l <= 0) continue
            if (w !== i) {
                this.pos.copyWithin(w * 3, i * 3, i * 3 + 3)
                this.vel.copyWithin(w * 3, i * 3, i * 3 + 3)
                this.rot.copyWithin(w * 3, i * 3, i * 3 + 3)
                this.col.copyWithin(w * 3, i * 3, i * 3 + 3)
                this.maxLife[w] = this.maxLife[i]!
                this.size[w] = this.size[i]!
                this.grav[w] = this.grav[i]!
            }
            this.life[w] = l
            const p = w * 3
            this.vel[p + 1]! -= this.grav[w]! * dt
            this.pos[p]! += this.vel[p]! * dt
            this.pos[p + 1]! += this.vel[p + 1]! * dt
            this.pos[p + 2]! += this.vel[p + 2]! * dt
            if (this.pos[p + 1]! < 0.02) {
                // Bounce once, then slide to a stop on the grass.
                this.pos[p + 1] = 0.02
                this.vel[p + 1] = Math.abs(this.vel[p + 1]!) * 0.3
                this.vel[p]! *= 0.6
                this.vel[p + 2]! *= 0.6
            }
            this.rot[p]! += this.rot[p + 2]! * dt
            this.rot[p + 1]! += this.rot[p + 2]! * dt * 0.7
            const t = l / this.maxLife[w]!
            // Pop in fast, shrink out at the end of life.
            const s = this.size[w]! * Math.min(1, t * 4) * Math.min(1, (1 - t) * 12 + 0.2)
            tmpPos.set(this.pos[p]!, this.pos[p + 1]!, this.pos[p + 2]!)
            tmpQuat.setFromEuler(tmpEuler.set(this.rot[p]!, this.rot[p + 1]!, 0))
            tmpScale.setScalar(Math.max(0.0001, s))
            tmpMat.compose(tmpPos, tmpQuat, tmpScale)
            this.mesh.setMatrixAt(w, tmpMat)
            colors[p] = this.col[p]!
            colors[p + 1] = this.col[p + 1]!
            colors[p + 2] = this.col[p + 2]!
            w++
        }
        this.count = w
        this.mesh.count = w
        this.mesh.instanceMatrix.needsUpdate = true
        this.mesh.instanceColor!.needsUpdate = true
    }

    clear(): void {
        this.count = 0
        this.mesh.count = 0
    }
}

/** Expanding flat rings on the ground: deploy shockwaves, wave warnings. */
export class RingFx {
    readonly mesh: THREE.InstancedMesh
    private readonly items: { x: number, y: number, z: number, r0: number, r1: number, life: number, max: number, color: THREE.Color }[] = []
    private readonly max: number

    constructor(geometry: THREE.BufferGeometry, max = 64) {
        this.max = max
        const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })
        this.mesh = new THREE.InstancedMesh(geometry, mat, max)
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
        this.mesh.frustumCulled = false
        this.mesh.count = 0
        this.mesh.renderOrder = 2
    }

    spawn(x: number, z: number, r0: number, r1: number, life: number, color: number, y = 0.04): void {
        if (this.items.length >= this.max) this.items.shift()
        this.items.push({ x, y, z, r0, r1, life, max: life, color: new THREE.Color(color) })
    }

    update(dt: number): void {
        let w = 0
        for (const it of this.items) {
            it.life -= dt
            if (it.life <= 0) continue
            const t = 1 - it.life / it.max
            const ease = 1 - (1 - t) * (1 - t)
            const r = it.r0 + (it.r1 - it.r0) * ease
            tmpPos.set(it.x, it.y, it.z)
            tmpQuat.identity()
            tmpScale.set(r, 1, r)
            tmpMat.compose(tmpPos, tmpQuat, tmpScale)
            this.mesh.setMatrixAt(w, tmpMat)
            // Additive blending: fading to black fades the ring out.
            tmpColor.copy(it.color).multiplyScalar(1 - t)
            this.mesh.setColorAt(w, tmpColor)
            this.items[w++] = it
        }
        this.items.length = w
        this.mesh.count = w
        this.mesh.instanceMatrix.needsUpdate = true
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }
}
