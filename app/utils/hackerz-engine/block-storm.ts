import * as THREE from 'three'
import { hdr, type ModelRig } from './models'

/**
 * ZERO DAY's attack: its body comes apart. Every block it is built from
 * explodes off, then gathers in three queues beside the gem in its chest —
 * one to its left, one to its right, one above — and the queues fire their
 * blocks at the target one after another, a barrage, each queue shuffling up
 * as its front block goes. Then the body regrows out of the gem, block by
 * block, back into shape. The board and the database turntable both run it
 * through this.
 */

/** The units whose attack is a block storm. */
export const BLOCK_STORM_IDS: readonly string[] = ['zeroday']

/** The beats, in seconds: the explosion, gathering into the queues, the gap between shots, each shot's flight, and a block's regrowth. */
const BURST_S = 0.25
const GATHER_S = 0.4
const FIRE_GAP_S = 0.055
const FLY_S = 0.35
const REGROW_S = 0.45
/** How far apart, through the barrage order, blocks start to regrow. */
const REGROW_GAP_S = 0.03
/** Per unit of height: how far the blocks explode out, where a queue starts beside the gem, and the spacing down it. */
const BURST_OUT = 0.45
const QUEUE_GAP = 0.18
const QUEUE_SPACING = 0.1
/** How far shots may stray off the line at the target, per unit of height. */
const SPREAD = 0.2
/** How quickly a queued block shuffles up to its next place. */
const SHUFFLE = 12

interface Piece {
    /** The block itself: hidden while its copy flies, regrown into place after. */
    part: THREE.Mesh
    restPosition: THREE.Vector3
    restScale: THREE.Vector3
    /** Its centre in its own space, so it can be placed by its middle. */
    centre: THREE.Vector3
    /** The copy that flies; where it is (its middle, in the parent's space); where its explosion carries it. */
    copy: THREE.Mesh | null
    at: THREE.Vector3
    burst: THREE.Vector3
    /** From its middle to the copy's origin: the copy is moved by its middle. */
    offset: THREE.Vector3
    /** Its queue (0 left, 1 right, 2 above), its place in that queue, and its turn in the barrage. */
    queue: number
    place: number
    turn: number
    /** Its shot: from where, to where; set when it fires. */
    launched: boolean
    from: THREE.Vector3
    to: THREE.Vector3
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _gem = new THREE.Vector3()
const _right = new THREE.Vector3()
const _quat = new THREE.Quaternion()

function ease(t: number) {
    const c = Math.min(1, Math.max(0, t))
    return c * c * (3 - 2 * c)
}

export class BlockStorm {
    private pieces: Piece[] = []
    private age = -1
    private size = 1
    private readonly target = new THREE.Vector3()
    private readonly toParent = new THREE.Matrix4()
    private readonly material: THREE.MeshBasicMaterial
    private readonly edge: THREE.LineBasicMaterial

    /**
     * Copies fly in `parent`'s space (the board's root, or the turntable's
     * scene); `onArrive` is told where each strikes home.
     */
    constructor(private readonly rig: ModelRig, private readonly parent: THREE.Object3D, hex: number,
        private readonly onArrive?: (at: THREE.Vector3) => void) {
        this.material = new THREE.MeshBasicMaterial({ color: hdr(hex, 0.45), toneMapped: false })
        this.edge = new THREE.LineBasicMaterial({ color: hdr(hex, 1.8), toneMapped: false })
        rig.core?.geometry.computeBoundingSphere()
        rig.blocks.forEach((part, i) => {
            part.geometry.computeBoundingSphere()
            this.pieces.push({
                part,
                restPosition: part.position.clone(),
                restScale: part.scale.clone(),
                centre: part.geometry.boundingSphere!.center.clone(),
                copy: null,
                at: new THREE.Vector3(),
                burst: new THREE.Vector3(),
                offset: new THREE.Vector3(),
                queue: i % 3,
                place: Math.floor(i / 3),
                turn: i,
                launched: false,
                from: new THREE.Vector3(),
                to: new THREE.Vector3()
            })
        })
    }

    /** True from the explosion until the body has regrown. */
    get running() {
        return this.age >= 0
    }

    /** Where the gem is, in world space: its middle — its node sits at the model's feet. */
    private gemCentre(out: THREE.Vector3) {
        const core = this.rig.core!
        return core.localToWorld(out.copy(core.geometry.boundingSphere!.center))
    }

    /** The barrage's length: when the last block fires, after the start. */
    private get lastShot() {
        return BURST_S + GATHER_S + (this.pieces.length - 1) * FIRE_GAP_S
    }

    /** Throws the body at `target` (world space). Ignored while a storm is already under way. */
    start(target: THREE.Vector3) {
        if (this.running || !this.rig.core) return
        this.age = 0
        this.size = this.rig.box.max.y * this.rig.root.getWorldScale(_a).y
        this.rig.root.updateWorldMatrix(true, true)
        this.parent.updateWorldMatrix(true, false)
        this.toParent.copy(this.parent.matrixWorld).invert()
        this.target.copy(target).applyMatrix4(this.toParent)
        this.gemCentre(_gem)
        for (const piece of this.pieces) {
            const part = piece.part
            // The copy starts exactly where the block is.
            const copy = new THREE.Mesh(part.geometry, this.material)
            const edges = part.geometry.userData.edges as THREE.BufferGeometry | undefined
            if (edges) copy.add(new THREE.LineSegments(edges, this.edge))
            copy.applyMatrix4(this.toParent.clone().multiply(part.matrixWorld))
            this.parent.add(copy)
            piece.copy = copy
            part.visible = false
            const start = part.localToWorld(_a.copy(piece.centre))
            piece.at.copy(start).applyMatrix4(this.toParent)
            piece.from.copy(piece.at)
            piece.offset.copy(piece.at).sub(copy.position)
            // Blown straight out from the gem.
            const out = _b.copy(start).sub(_gem)
            if (out.lengthSq() < 1e-6) out.set(0, 1, 0)
            out.normalize()
            piece.burst.copy(start).addScaledVector(out, this.size * BURST_OUT).applyMatrix4(this.toParent)
            piece.launched = false
        }
    }

    update(dt: number) {
        if (!this.running) return
        this.age += dt
        const t = this.age
        // The queues hang off the gem as it stands now, square to the way the unit faces.
        this.gemCentre(_gem)
        _right.set(1, 0, 0).applyQuaternion(this.rig.root.getWorldQuaternion(_quat))
        let done = true
        for (const piece of this.pieces) {
            const copy = piece.copy
            if (copy) {
                done = false
                const fireAt = BURST_S + GATHER_S + piece.turn * FIRE_GAP_S
                if (t < BURST_S) {
                    piece.at.lerpVectors(piece.from, piece.burst, ease(t / BURST_S))
                } else if (t < fireAt) {
                    const slot = this.slot(piece, t, _a)
                    if (t < BURST_S + GATHER_S) piece.at.lerpVectors(piece.burst, slot, ease((t - BURST_S) / GATHER_S))
                    else piece.at.lerp(slot, Math.min(1, dt * SHUFFLE))
                } else {
                    if (!piece.launched) {
                        piece.launched = true
                        piece.from.copy(piece.at)
                        const spread = this.size * SPREAD
                        piece.to.copy(this.target).add(_b.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread))
                    }
                    const f = Math.min(1, (t - fireAt) / FLY_S)
                    piece.at.lerpVectors(piece.from, piece.to, f * f)
                    if (f >= 1) {
                        copy.removeFromParent()
                        piece.copy = null
                        this.onArrive?.(piece.to.clone().applyMatrix4(this.parent.matrixWorld))
                    }
                }
                if (piece.copy) copy.position.copy(piece.at).sub(piece.offset)
            }
            // Regrowing out of the gem once the barrage is away, in the order it fired.
            const g = (t - this.lastShot - FLY_S * 0.5 - piece.turn * REGROW_GAP_S) / REGROW_S
            if (g < 0) {
                done = false
                continue
            }
            this.regrow(piece, ease(g))
            if (g < 1) done = false
        }
        if (done) this.settle()
    }

    /**
     * A queued block's place, in the parent's space: out from the gem along
     * its queue's side, one place nearer for every block of its queue already
     * fired.
     */
    private slot(piece: Piece, t: number, out: THREE.Vector3) {
        let ahead = 0
        for (const other of this.pieces) {
            if (other.queue === piece.queue && other.place < piece.place
                && t >= BURST_S + GATHER_S + other.turn * FIRE_GAP_S) ahead++
        }
        const place = piece.place - ahead
        const dir = piece.queue === 0 ? _b.copy(_right).negate() : piece.queue === 1 ? _b.copy(_right) : _b.set(0, 1, 0)
        out.copy(_gem).addScaledVector(dir, this.size * (QUEUE_GAP + place * QUEUE_SPACING))
        return out.applyMatrix4(this.toParent)
    }

    /** Puts the block `k` of the way back from the gem: grown from nothing, out to its rest place. */
    private regrow(piece: Piece, k: number) {
        const part = piece.part
        const parent = part.parent
        if (!parent || !this.rig.core) return
        part.visible = k > 0.02
        parent.worldToLocal(this.gemCentre(_gem))
        // Where its middle sits at rest, in its parent's space.
        const rest = _b.copy(piece.centre).multiply(piece.restScale).add(piece.restPosition)
        const middle = _a.lerpVectors(_gem, rest, k)
        part.scale.copy(piece.restScale).multiplyScalar(Math.max(0.001, k))
        part.position.copy(middle).sub(_b.copy(piece.centre).multiply(part.scale))
    }

    /** All back in shape: every block at rest, the storm over. */
    private settle() {
        for (const piece of this.pieces) {
            piece.part.position.copy(piece.restPosition)
            piece.part.scale.copy(piece.restScale)
            piece.part.visible = true
            piece.copy?.removeFromParent()
            piece.copy = null
        }
        this.age = -1
    }

    dispose() {
        this.settle()
        this.material.dispose()
        this.edge.dispose()
    }
}
