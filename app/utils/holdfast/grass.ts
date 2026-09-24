// Holdfast — a wind-blown grass field. Thousands of instanced blade clumps
// cover open ground; a vertex shader sways them in rolling gusts. Clumps under
// buildings are hidden whenever the base changes. Cosmetic only.

import * as THREE from 'three'
import { MAP_SIZE } from '#shared/utils/holdfast/config'
import { Terrain } from '#shared/utils/holdfast/grid'
import type { HoldfastSim } from '#shared/utils/holdfast/sim'

const PER_TILE = 5
const HEIGHT = 0.3

/** A clump of tapered blades, dark at the root and sunlit at the tip. */
function clumpGeometry(): THREE.BufferGeometry {
    const pos: number[] = []
    const colors: number[] = []
    const root = new THREE.Color(0x3f6b2a)
    const tip = new THREE.Color(0xb9d97a)
    const blades = 7
    for (let b = 0; b < blades; b++) {
        const a = (b / blades) * Math.PI * 2 + (b % 2) * 0.4
        const r = 0.05 + (b % 3) * 0.03
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        const h = HEIGHT * (0.65 + ((b * 37) % 10) / 22)
        const lean = 0.08 + (b % 4) * 0.02
        const tx = x + Math.cos(a) * lean
        const tz = z + Math.sin(a) * lean
        // Blade width across the direction it leans.
        const wx = -Math.sin(a) * 0.022
        const wz = Math.cos(a) * 0.022
        pos.push(x - wx, 0, z - wz, x + wx, 0, z + wz, tx, h, tz)
        colors.push(root.r, root.g, root.b, root.r, root.g, root.b, tip.r, tip.g, tip.b)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    // Normals point up so the grass is lit like the ground under it.
    const normals = new Float32Array(pos.length)
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    return g
}

export class GrassField {
    readonly mesh: THREE.InstancedMesh
    private readonly cells: Int32Array
    private readonly base: THREE.Matrix4[] = []
    private readonly uniforms = { uTime: { value: 0 } }

    constructor(private sim: HoldfastSim) {
        const grid = sim.grid
        const n = MAP_SIZE
        let seed = (sim.seed ^ 0x51f15e) >>> 0
        const rand = (): number => {
            seed = (seed + 0x6D2B79F5) >>> 0
            let t = seed
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
        const spots: { x: number, z: number, cell: number, s: number }[] = []
        for (let cz = 0; cz < n; cz++) {
            for (let cx = 0; cx < n; cx++) {
                const i = grid.idx(cx, cz)
                const t = grid.terrain[i]
                if (t === Terrain.Rock) continue
                // Sparse tufts at road edges, lush clumps on grass and under trees.
                const count = t === Terrain.Road ? (rand() < 0.12 ? 1 : 0) : t === Terrain.Tree ? 3 : PER_TILE
                for (let k = 0; k < count; k++) {
                    spots.push({ x: cx + rand(), z: cz + rand(), cell: i, s: t === Terrain.Road ? 0.55 : 0.7 + rand() * 0.6 })
                }
            }
        }
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.uniforms.uTime
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nuniform float uTime;')
                .replace('#include <begin_vertex>', `
                    vec3 transformed = vec3(position);
                    float h = clamp(position.y / ${HEIGHT.toFixed(2)}, 0.0, 1.0);
                    vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
                    // Rolling gusts travel across the field, with a quick flutter on top.
                    float gust = sin(uTime * 0.9 + ip.x * 0.18 + ip.y * 0.11) * 0.5 + 0.5;
                    float sway = sin(uTime * 2.3 + ip.x * 0.9 + ip.y * 0.7) * (0.35 + gust * 0.65);
                    sway += sin(uTime * 5.1 + ip.x * 2.3) * 0.15;
                    transformed.x += sway * 0.07 * h * h;
                    transformed.z += sway * 0.04 * h * h;
                `)
        }
        this.mesh = new THREE.InstancedMesh(clumpGeometry(), mat, spots.length)
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3)
        this.cells = new Int32Array(spots.length)
        const q = new THREE.Quaternion()
        const e = new THREE.Euler()
        const c = new THREE.Color()
        spots.forEach((p, i) => {
            q.setFromEuler(e.set(0, rand() * Math.PI * 2, 0))
            const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s * (0.8 + rand() * 0.5), p.s))
            this.base.push(m)
            this.mesh.setMatrixAt(i, m)
            // Patchy tint: some clumps drier, some lusher.
            const dry = rand()
            c.setRGB(0.92 + dry * 0.12, 0.95 + (1 - dry) * 0.08, 0.85)
            this.mesh.setColorAt(i, c)
            this.cells[i] = p.cell
        })
        this.mesh.receiveShadow = true
        this.mesh.frustumCulled = false
        this.refresh()
    }

    /** Hide clumps that ended up under a structure (call when buildings change). */
    refresh(): void {
        const zero = new THREE.Matrix4().makeScale(0, 0, 0)
        const occ = this.sim.grid.occupant
        for (let i = 0; i < this.cells.length; i++) {
            this.mesh.setMatrixAt(i, occ[this.cells[i]!]! >= 0 ? zero : this.base[i]!)
        }
        this.mesh.instanceMatrix.needsUpdate = true
    }

    update(time: number): void {
        this.uniforms.uTime.value = time
    }
}
