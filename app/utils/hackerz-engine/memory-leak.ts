import * as THREE from 'three'
import { HACKERZ_LEAK_MAX } from '#shared/utils/gamelogic/hackerz'
import { hdr } from './models'

/**
 * A Daemon's memory leak, drawn: leaked allocations, glowing blocks spilled out
 * of its chest that stack up at the foot of the fence, pulsing as they drain it.
 * The board and the database turntable both draw it through this, so the
 * database shows the attack exactly as it plays.
 */

/** A block's edge, in world units. */
export const LEAK_BLOCK = 0.3
/** How long a spilled block takes to land on the stack, and how high it arcs. */
const SPILL_S = 0.45
const SPILL_ARC = 0.7
/** Blocks per row, bottom up: twelve in a rough pyramid. */
const ROWS = [4, 3, 3, 2]

const box = new THREE.BoxGeometry(1, 1, 1)
const boxEdges = new THREE.EdgesGeometry(box)

/** Where block `i` sits, relative to the stack's base centre. */
function slot(i: number, out: THREE.Vector3) {
    let row = 0
    let index = i
    while (row < ROWS.length - 1 && index >= ROWS[row]!) index -= ROWS[row++]!
    const across = ROWS[row]!
    // A little stagger front to back, so it reads as a heap rather than a wall.
    const z = ((i * 7) % 3 - 1) * LEAK_BLOCK * 0.18
    return out.set((index - (across - 1) / 2) * LEAK_BLOCK * 1.06, (row + 0.5) * LEAK_BLOCK * 1.02, z)
}

/**
 * The block in a Daemon's hands: pulled out of the disc on its back and heaved
 * overhead, until it is let go onto the stack. Positions are in its parent's space.
 */
export class LeakCarry {
    readonly mesh: THREE.Mesh
    private readonly fill: THREE.MeshBasicMaterial
    private readonly edge: THREE.LineBasicMaterial

    constructor(parent: THREE.Object3D, hex: number, private readonly scale = 1) {
        this.fill = new THREE.MeshBasicMaterial({ color: hdr(hex, 0.35), transparent: true, opacity: 0.85 })
        this.edge = new THREE.LineBasicMaterial({ color: hdr(hex, 2), toneMapped: false })
        this.mesh = new THREE.Mesh(box, this.fill)
        this.mesh.add(new THREE.LineSegments(boxEdges, this.edge))
        this.mesh.visible = false
        parent.add(this.mesh)
    }

    /** In hand at `at`, `grown` of the way out of the disc (it grows out of it). */
    show(at: THREE.Vector3, grown: number) {
        this.mesh.visible = grown > 0
        this.mesh.position.copy(at)
        this.mesh.scale.setScalar(LEAK_BLOCK * this.scale * Math.max(0.05, grown))
    }

    hide() {
        this.mesh.visible = false
    }

    dispose() {
        this.mesh.removeFromParent()
        this.fill.dispose()
        this.edge.dispose()
    }
}

interface Spill {
    block: THREE.Object3D
    from: THREE.Vector3
    to: THREE.Vector3
    t: number
}

/** One stack of leaked allocations, at the foot of the fence. Positions are in its parent's space. */
export class LeakStack {
    readonly group = new THREE.Group()
    private readonly blocks: THREE.Object3D[] = []
    private readonly spills: Spill[] = []
    private readonly fill: THREE.MeshBasicMaterial
    private readonly edge: THREE.LineBasicMaterial
    private age = 0
    private flare = 0

    /** `scale` sizes the stack to the units around it: the board's are bigger than the turntable's. */
    constructor(parent: THREE.Object3D, base: THREE.Vector3, readonly hex: number, private readonly scale = 1) {
        this.group.position.copy(base)
        this.group.scale.setScalar(scale)
        this.fill = new THREE.MeshBasicMaterial({ color: hdr(hex, 0.35), transparent: true, opacity: 0.85 })
        this.edge = new THREE.LineBasicMaterial({ color: hdr(hex, 2.2), toneMapped: false })
        parent.add(this.group)
    }

    get count() {
        return this.blocks.length
    }

    get full() {
        return this.blocks.length >= HACKERZ_LEAK_MAX
    }

    /** Throws a block from `from` (parent space) onto the stack. False when it is full. */
    spill(from: THREE.Vector3) {
        if (this.full) return false
        const block = new THREE.Mesh(box, this.fill)
        block.add(new THREE.LineSegments(boxEdges, this.edge))
        block.scale.setScalar(LEAK_BLOCK)
        const start = from.clone().sub(this.group.position).divideScalar(this.scale)
        block.position.copy(start)
        this.group.add(block)
        this.spills.push({ block, from: start, to: slot(this.blocks.length, new THREE.Vector3()), t: 0 })
        this.blocks.push(block)
        return true
    }

    /** Takes the top block off; returns where it was (parent space), or null when empty. */
    pop(out: THREE.Vector3) {
        const block = this.blocks.pop()
        if (!block) return null
        const spill = this.spills.findIndex(s => s.block === block)
        if (spill >= 0) this.spills.splice(spill, 1)
        out.copy(block.position).multiplyScalar(this.scale).add(this.group.position)
        block.removeFromParent()
        return out
    }

    /** The top of the stack (parent space): where a shot at it lands. */
    top(out: THREE.Vector3) {
        const rows = this.blocks.length > 9 ? 4 : this.blocks.length > 7 ? 3 : this.blocks.length > 4 ? 2 : 1
        return out.set(0, rows * LEAK_BLOCK * this.scale, 0).add(this.group.position)
    }

    /** It drained the fence: the whole stack flares. */
    drained() {
        this.flare = 1
    }

    update(dt: number) {
        this.age += dt
        this.flare = Math.max(0, this.flare - dt * 3)
        // A slow heartbeat while it drains, brighter on each tick.
        const beat = 1.1 + Math.sin(this.age * 5) * 0.35 + this.flare * 1.6
        this.edge.color.copy(hdr(this.hex, beat))
        for (let i = this.spills.length - 1; i >= 0; i--) {
            const spill = this.spills[i]!
            spill.t = Math.min(1, spill.t + dt / SPILL_S)
            const t = spill.t
            spill.block.position.lerpVectors(spill.from, spill.to, t)
            spill.block.position.y += Math.sin(t * Math.PI) * SPILL_ARC
            spill.block.rotation.set(t * 5, t * 3, 0)
            if (t < 1) continue
            spill.block.rotation.set(0, 0, 0)
            spill.block.position.copy(spill.to)
            this.spills.splice(i, 1)
        }
    }

    dispose() {
        this.group.removeFromParent()
        this.fill.dispose()
        this.edge.dispose()
    }
}
