import * as THREE from 'three'
import { hdr } from './models'

/**
 * BLACK ICE's spit and what it builds: dark, glowing globs of ice, lobbed out
 * to land and freeze together into a wall of crystals that grows with every
 * glob, shielding what stands behind it. The board and the database turntable
 * both draw it through this.
 */

/** The ice's colour: near-black body, a cold violet glow on its edges. */
const ICE_BODY = 0x0b0820
const ICE_GLOW = 0xa5b4fc
/** Crystals a full-grown wall stands, and how long a wall takes to grow into a fresh deposit. */
const CRYSTALS = 9
const GROW_S = 0.5
/** How long a wall takes to melt away once it is left. */
const MELT_S = 1.2

const crystal = new THREE.OctahedronGeometry(1, 0)
const crystalEdges = new THREE.EdgesGeometry(crystal)

function iceMaterials() {
    return {
        body: new THREE.MeshBasicMaterial({ color: ICE_BODY, transparent: true, opacity: 0.85 }),
        edge: new THREE.LineBasicMaterial({ color: hdr(ICE_GLOW, 1.8), toneMapped: false, transparent: true })
    }
}

/** A glob of black ice, as spat: a dark shard with glowing edges. `size` across. */
export function makeIceGlob(size: number) {
    const { body, edge } = iceMaterials()
    const mesh = new THREE.Mesh(crystal, body)
    mesh.add(new THREE.LineSegments(crystalEdges, edge))
    mesh.scale.set(size * 0.5, size * 0.7, size * 0.5)
    return mesh
}

/** Frees a glob's own materials once it has landed. */
export function disposeIceGlob(mesh: THREE.Mesh) {
    mesh.removeFromParent()
    ;(mesh.material as THREE.Material).dispose()
    for (const child of mesh.children) ((child as THREE.LineSegments).material as THREE.Material).dispose()
}

/**
 * A wall of black ice at one spot, in its parent's space: a row of crystals
 * `width` wide at full growth, grown a deposit at a time. `fill` (0–1) is how
 * much of it has formed.
 */
export class IceWall {
    readonly group = new THREE.Group()
    private readonly crystals: THREE.Mesh[] = []
    private readonly materials = iceMaterials()
    /** How much has been deposited (0–1), and how much of that has frozen into shape so far. */
    private target = 0
    private shown = 0
    private melt = -1

    constructor(parent: THREE.Object3D, at: THREE.Vector3, private readonly width: number, height: number) {
        this.group.position.copy(at)
        for (let i = 0; i < CRYSTALS; i++) {
            const mesh = new THREE.Mesh(crystal, this.materials.body)
            mesh.add(new THREE.LineSegments(crystalEdges, this.materials.edge))
            // Along the row, a little ragged front to back, leaning every which way.
            const along = (i / (CRYSTALS - 1) - 0.5) * width
            mesh.position.set(along, 0, (Math.random() - 0.5) * width * 0.08)
            mesh.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5)
            // Taller in the middle: it grows outward from where the ice first landed.
            mesh.userData.tall = height * (0.6 + 0.4 * (1 - Math.abs(i / (CRYSTALS - 1) - 0.5) * 2)) * (0.8 + Math.random() * 0.4)
            mesh.userData.order = Math.abs(i / (CRYSTALS - 1) - 0.5) * 2
            mesh.visible = false
            this.group.add(mesh)
            this.crystals.push(mesh)
        }
        parent.add(this.group)
    }

    /** How much of the wall has formed (0–1). */
    get fill() {
        return this.target
    }

    /** True once it has melted away entirely. */
    get gone() {
        return this.melt >= 1
    }

    /** A glob lands on it: it grows by `amount` of a full wall. */
    deposit(amount: number) {
        this.target = Math.min(1, this.target + amount)
        this.melt = -1
    }

    /** It starts to melt (its time is up, or the purge swept it). */
    thaw() {
        if (this.melt < 0) this.melt = 0
    }

    update(dt: number) {
        this.shown += Math.sign(this.target - this.shown) * Math.min(Math.abs(this.target - this.shown), dt / GROW_S)
        let fade = 1
        if (this.melt >= 0) {
            this.melt = Math.min(1, this.melt + dt / MELT_S)
            fade = 1 - this.melt
        }
        this.materials.body.opacity = 0.85 * fade
        this.materials.edge.opacity = fade
        for (const mesh of this.crystals) {
            // The middle crystals form first, the ends last, as it fills.
            const grown = Math.min(1, Math.max(0, (this.shown - mesh.userData.order * 0.7) / 0.3))
            mesh.visible = grown > 0.01 && fade > 0.01
            const tall = (mesh.userData.tall as number) * grown
            mesh.scale.set(this.width / CRYSTALS * 0.55 * Math.max(0.2, grown), tall * 0.5, this.width / CRYSTALS * 0.45 * Math.max(0.2, grown))
            mesh.position.y = tall * 0.35
        }
    }

    dispose() {
        this.group.removeFromParent()
        this.materials.body.dispose()
        this.materials.edge.dispose()
    }
}
