// Holdfast — incoming-wave route preview. While a wave is announced, red
// chevrons march along the raiders' real flow-field route from each lane to
// the keep, so the player can see which wall is about to be tested.

import * as THREE from 'three'
import { flowNext } from '#shared/utils/holdfast/grid'
import type { HoldfastSim } from '#shared/utils/holdfast/sim'

const MAX = 600
const SPACING = 1.25

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const e = new THREE.Euler()
const v = new THREE.Vector3()
const s = new THREE.Vector3()
const col = new THREE.Color()

function chevronGeometry(): THREE.BufferGeometry {
    // A flat "›" arrow lying on the ground, pointing along +Z.
    const shape = new THREE.Shape()
    shape.moveTo(-0.32, -0.18)
    shape.lineTo(0, 0.14)
    shape.lineTo(0.32, -0.18)
    shape.lineTo(0.32, 0.02)
    shape.lineTo(0, 0.34)
    shape.lineTo(-0.32, 0.02)
    shape.closePath()
    const g = new THREE.ShapeGeometry(shape)
    // Shape is in XY; lay it flat so +Y becomes +Z.
    g.rotateX(Math.PI / 2)
    g.scale(1, 1, -1)
    return g
}

export class LanePaths {
    readonly mesh: THREE.InstancedMesh
    private routes: { x: number, z: number }[][] = []
    private key = ''
    private refreshAt = 0
    private strength = 0

    constructor(private sim: HoldfastSim) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
        this.mesh = new THREE.InstancedMesh(chevronGeometry(), mat, MAX)
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3)
        this.mesh.frustumCulled = false
        this.mesh.count = 0
        this.mesh.renderOrder = 3
    }

    /** Follow the flow field from a lane to the keep, sampled every SPACING tiles. */
    private trace(x: number, z: number): { x: number, z: number }[] {
        const grid = this.sim.grid
        const n = grid.size
        const cells: { x: number, z: number }[] = [{ x: x + 0.5, z: z + 0.5 }]
        let c = grid.idx(x, z)
        for (let i = 0; i < 400; i++) {
            const next = flowNext(grid, c, j => !grid.solid(j))
            if (next < 0 || grid.flow[next] === 0) break
            c = next
            cells.push({ x: c % n + 0.5, z: Math.floor(c / n) + 0.5 })
        }
        // Resample at even spacing along the polyline.
        const out: { x: number, z: number }[] = []
        let carry = 0
        for (let i = 1; i < cells.length; i++) {
            const a = cells[i - 1]!
            const b = cells[i]!
            const len = Math.hypot(b.x - a.x, b.z - a.z)
            let d = carry
            while (d < len) {
                const t = d / len
                out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
                d += SPACING
            }
            carry = d - len
        }
        return out
    }

    update(dt: number, clock: number): void {
        const pending = this.sim.pending
        const lanes = pending ? pending.lanes : []
        const key = lanes.join(',')
        // Re-trace when the wave changes, and every second (walls change routes).
        if (key !== this.key || clock > this.refreshAt) {
            this.key = key
            this.refreshAt = clock + 1
            this.routes = lanes.map((l) => {
                const lane = this.sim.difficulty.lanes[l]
                return lane ? this.trace(lane.x, lane.z) : []
            })
        }
        this.strength += ((lanes.length ? 1 : 0) - this.strength) * Math.min(1, dt * 3)
        if (this.strength < 0.01) {
            this.mesh.count = 0
            return
        }
        let i = 0
        const flow = (clock * 1.6) % 1
        for (const route of this.routes) {
            for (let k = 0; k < route.length - 1 && i < MAX; k++) {
                const a = route[k]!
                const b = route[k + 1]!
                const t = flow
                const x = a.x + (b.x - a.x) * t
                const z = a.z + (b.z - a.z) * t
                q.setFromEuler(e.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0))
                m4.compose(v.set(x, 0.05, z), q, s.setScalar(0.85))
                this.mesh.setMatrixAt(i, m4)
                // Brighter near the keep end: that's where it will hurt.
                const heat = 0.35 + 0.65 * (k / route.length)
                col.setRGB(1, 0.22, 0.16).multiplyScalar(0.55 + heat * 0.3 + Math.sin(clock * 6 - k * 0.5) * 0.15)
                this.mesh.setColorAt(i, col)
                i++
            }
        }
        this.mesh.count = i
        ;(this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * this.strength
        this.mesh.instanceMatrix.needsUpdate = true
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }
}
