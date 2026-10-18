import * as THREE from 'three'
import type { DfVoxMaterial } from '../../voxel/material'
import { DfVoxModel } from '../../voxel/model'

// Voxel debris: coloured cubes that burst off zombies (hit chips, headshot
// pops, gibs), bounce on the floor, settle and shrink away. One instanced
// mesh, fixed pool, no per-frame allocation.

export interface DfDebris {
    /** Spawns one cube; colour is sRGB hex. */
    spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, hex: number, floor: number, life?: number): void
    update(dt: number): void
    readonly count: number
    dispose(): void
}

export function createDfDebris(scene: THREE.Scene, material: DfVoxMaterial, onLand?: (x: number, y: number, z: number) => void, cap = 2400): DfDebris {
    const unit = new DfVoxModel(1, 1, 1)
    unit.box(0, 0, 0, 1, 1, 1, unit.c(0xffffff))
    const geo = unit.mesh(1, [0.5, 0.5, 0.5])!
    const inst = new THREE.InstancedMesh(geo, material, cap)
    inst.name = 'df-zombie-debris'
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    inst.frustumCulled = false
    inst.castShadow = false
    inst.count = 0
    scene.add(inst)
    const white = new THREE.Color(1, 1, 1)
    for (let i = 0; i < cap; i++) inst.setColorAt(i, white)
    // Struct of arrays: x y z vx vy vz ax ay az angle spin size age life floor landed
    const F = 16
    const s = new Float32Array(cap * F)
    let n = 0
    const col = new THREE.Color()
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const sc = new THREE.Vector3()
    const ax = new THREE.Vector3()

    return {
        get count() {
            return n
        },
        spawn(x, y, z, vx, vy, vz, size, hex, floor, life = 2.5 + Math.random() * 1.5) {
            let i = n
            if (n < cap) n++
            else i = Math.floor(Math.random() * cap)
            const o = i * F
            s[o] = x
            s[o + 1] = y
            s[o + 2] = z
            s[o + 3] = vx
            s[o + 4] = vy
            s[o + 5] = vz
            ax.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
            s[o + 6] = ax.x
            s[o + 7] = ax.y
            s[o + 8] = ax.z
            s[o + 9] = Math.random() * 6
            s[o + 10] = (Math.random() - 0.5) * 22
            s[o + 11] = size
            s[o + 12] = 0
            s[o + 13] = life
            s[o + 14] = floor
            s[o + 15] = 0
            col.setHex(hex)
            inst.setColorAt(i, col)
            if (inst.instanceColor) inst.instanceColor.needsUpdate = true
        },
        update(dt) {
            let i = 0
            while (i < n) {
                const o = i * F
                const age = s[o + 12]! + dt
                if (age >= s[o + 13]!) {
                    n--
                    if (i !== n) {
                        s.copyWithin(o, n * F, n * F + F)
                        inst.getColorAt(n, col)
                        inst.setColorAt(i, col)
                    }
                    continue
                }
                s[o + 12] = age
                let vx = s[o + 3]!
                let vy = s[o + 4]! - 14 * dt
                let vz = s[o + 5]!
                const x = s[o]! + vx * dt
                let y = s[o + 1]! + vy * dt
                const z = s[o + 2]! + vz * dt
                const size = s[o + 11]!
                const floor = s[o + 14]! + size * 0.5
                if (y < floor) {
                    y = floor
                    if (vy < -1.2) {
                        vy = -vy * 0.3
                        vx *= 0.55
                        vz *= 0.55
                        s[o + 10] = s[o + 10]! * 0.5
                        if (!s[o + 15]) {
                            s[o + 15] = 1
                            onLand?.(x, y, z)
                        }
                    } else {
                        vy = 0
                        vx *= 0.6
                        vz *= 0.6
                        s[o + 10] = 0
                    }
                }
                s[o] = x
                s[o + 1] = y
                s[o + 2] = z
                s[o + 3] = vx
                s[o + 4] = vy
                s[o + 5] = vz
                const ang = s[o + 9]! + s[o + 10]! * dt
                s[o + 9] = ang
                const left = s[o + 13]! - age
                const k = left < 0.6 ? left / 0.6 : 1
                q.setFromAxisAngle(ax.set(s[o + 6]!, s[o + 7]!, s[o + 8]!), ang)
                inst.setMatrixAt(i, m4.compose(p.set(x, y, z), q, sc.setScalar(size * k)))
                i++
            }
            inst.count = n
            inst.instanceMatrix.needsUpdate = true
            if (inst.instanceColor) inst.instanceColor.needsUpdate = true
        },
        dispose() {
            inst.removeFromParent()
            inst.dispose()
            geo.dispose()
        }
    }
}
