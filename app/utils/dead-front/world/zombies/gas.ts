import * as THREE from 'three'
import type { DfFx } from '../../context'
import { dfVoxMaterial } from '../../voxel/material'
import { DfVoxModel } from '../../voxel/model'

// Bloater death clouds: a churning heap of translucent green voxel blocks that
// swell, drift and shrink away, with gas particle bursts while they last.

const MAX_CLOUDS = 4
const BLOCKS = 28

interface Block {
    angle: number
    radial: number
    height: number
    size: number
    phase: number
    drift: number
}

interface Cloud {
    x: number
    y: number
    z: number
    radius: number
    seconds: number
    age: number
    nextPuff: number
    active: boolean
    blocks: Block[]
}

export interface DfGasClouds {
    spawn(x: number, y: number, z: number, radius: number, seconds: number): void
    update(dt: number): void
    dispose(): void
}

export function createDfGasClouds(scene: THREE.Scene, fx: DfFx): DfGasClouds {
    const unit = new DfVoxModel(1, 1, 1)
    unit.box(0, 0, 0, 1, 1, 1, unit.c(0x8fb04a, 0.18))
    const geo = unit.mesh(1, [0.5, 0.5, 0.5])!
    const mat = dfVoxMaterial({ transparent: true, opacity: 0.32 })
    mat.depthWrite = false
    const inst = new THREE.InstancedMesh(geo, mat, MAX_CLOUDS * BLOCKS)
    inst.name = 'df-gas'
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    inst.frustumCulled = false
    inst.renderOrder = 4
    inst.count = 0
    scene.add(inst)
    const clouds: Cloud[] = []
    for (let i = 0; i < MAX_CLOUDS; i++) {
        clouds.push({
            x: 0, y: 0, z: 0, radius: 1, seconds: 1, age: 0, nextPuff: 0, active: false,
            blocks: Array.from({ length: BLOCKS }, () => ({ angle: 0, radial: 0, height: 0, size: 0, phase: 0, drift: 0 }))
        })
    }
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const sc = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    return {
        spawn(x, y, z, radius, seconds) {
            const c = clouds.find(k => !k.active) ?? clouds.reduce((a, b) => (a.age / a.seconds > b.age / b.seconds ? a : b))
            c.x = x
            c.y = y
            c.z = z
            c.radius = radius
            c.seconds = seconds
            c.age = 0
            c.nextPuff = 0
            c.active = true
            for (const b of c.blocks) {
                b.angle = Math.random() * Math.PI * 2
                b.radial = Math.sqrt(Math.random()) * radius * 0.85
                b.height = 0.2 + Math.random() * 1.4
                b.size = 0.4 + Math.random() * 0.6
                b.phase = Math.random() * 10
                b.drift = (Math.random() - 0.5) * 0.5
            }
        },
        update(dt) {
            let n = 0
            for (const c of clouds) {
                if (!c.active) continue
                c.age += dt
                if (c.age >= c.seconds) {
                    c.active = false
                    continue
                }
                const u = c.age / c.seconds
                const grow = Math.min(1, c.age / 0.6)
                const fade = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1
                c.nextPuff -= dt
                if (c.nextPuff <= 0) {
                    c.nextPuff = 0.35
                    fx.burst('gas', { x: c.x + (Math.random() - 0.5) * c.radius, y: c.y + 0.3, z: c.z + (Math.random() - 0.5) * c.radius }, { count: 2, scale: 0.5 })
                }
                for (const b of c.blocks) {
                    b.angle += b.drift * dt
                    const r = b.radial * (0.7 + grow * 0.3)
                    const bob = Math.sin(c.age * 1.3 + b.phase) * 0.12
                    p.set(c.x + Math.cos(b.angle) * r, c.y + b.height * grow + bob, c.z + Math.sin(b.angle) * r)
                    q.setFromAxisAngle(up, b.angle + c.age * 0.2)
                    const s = b.size * (0.5 + grow * 0.5) * fade * (1 + Math.sin(c.age * 2 + b.phase) * 0.08)
                    inst.setMatrixAt(n++, m4.compose(p, q, sc.setScalar(s)))
                }
            }
            inst.count = n
            if (n) inst.instanceMatrix.needsUpdate = true
        },
        dispose() {
            inst.removeFromParent()
            inst.dispose()
            geo.dispose()
            mat.dispose()
        }
    }
}
