import * as THREE from 'three'
import { hdr } from './models'

/**
 * A warhead going off as corrupted data: a cloud of glitching blocks and torn
 * scanlines that scrambles the blast area — blocks blink out and reappear
 * elsewhere, flick between the round's colour and white, swell out to the
 * splash's edge and break up. Purely cosmetic, so it rolls on `Math.random`.
 */

/** Blocks in one cloud, and how long a cloud lasts (seconds). */
const BLOCKS = 46
const LIFE = 0.75
/** How long a block holds a spot before it glitches to another. */
const HOLD_MIN = 0.03
const HOLD_MAX = 0.12
/** Share of the blocks drawn as long, thin scanline tears rather than chunks. */
const TEARS = 0.3

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _turn = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _colour = new THREE.Color()
const _white = new THREE.Color()

interface Block {
    /** Where it sits in the cloud, as a share of the cloud's radius. */
    x: number
    y: number
    z: number
    /** Its size as a share of the radius, and whether it is a scanline tear. */
    size: number
    tear: boolean
    /** Seconds until it jumps somewhere else, and whether it shows the white flash. */
    hold: number
    white: boolean
}

interface Cloud {
    mesh: THREE.InstancedMesh
    material: THREE.MeshBasicMaterial
    blocks: Block[]
    radius: number
    age: number
    hex: THREE.Color
}

const geometry = new THREE.BoxGeometry(1, 1, 1)

export class GlitchClouds {
    private clouds: Cloud[] = []

    constructor(private readonly parent: THREE.Object3D) {}

    /** A cloud of `radius` world units, centred on `at` (its base on the floor). */
    burst(at: THREE.Vector3, radius: number, hex: number) {
        // A faint additive glow: the units glitching inside it carry the effect.
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
        })
        const mesh = new THREE.InstancedMesh(geometry, material, BLOCKS)
        mesh.position.copy(at)
        mesh.frustumCulled = false
        const blocks = Array.from({ length: BLOCKS }, () => this.place({ x: 0, y: 0, z: 0, size: 0, tear: false, hold: 0, white: false }))
        this.parent.add(mesh)
        // Bright enough to glow, dim enough that the bloom leaves each block its own shape.
        this.clouds.push({ mesh, material, blocks, radius, age: 0, hex: hdr(hex, 0.9) })
    }

    /** Drops a block somewhere fresh in the cloud: a glitch, not a move. */
    private place(block: Block) {
        const a = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.random())
        block.x = Math.cos(a) * r
        block.z = Math.sin(a) * r
        block.y = Math.random() * 0.7
        block.tear = Math.random() < TEARS
        block.size = block.tear ? 0.5 + Math.random() * 0.6 : 0.08 + Math.random() * 0.16
        block.hold = HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN)
        block.white = Math.random() < 0.25
        return block
    }

    update(dt: number) {
        for (let i = this.clouds.length - 1; i >= 0; i--) {
            const cloud = this.clouds[i]!
            cloud.age += dt
            const t = cloud.age / LIFE
            if (t >= 1) {
                this.drop(cloud)
                this.clouds.splice(i, 1)
                continue
            }
            // Swells out fast to the splash's edge, then holds there as it breaks up.
            const spread = cloud.radius * (0.35 + 0.65 * Math.min(1, t / 0.3))
            // Breaking up: ever fewer blocks, ever dimmer.
            const shown = Math.ceil(BLOCKS * (1 - t * t))
            cloud.material.opacity = 0.7 * (1 - t)
            for (let b = 0; b < BLOCKS; b++) {
                const block = cloud.blocks[b]!
                block.hold -= dt
                if (block.hold <= 0) this.place(block)
                if (b >= shown) {
                    _matrix.makeScale(0, 0, 0)
                    cloud.mesh.setMatrixAt(b, _matrix)
                    continue
                }
                _position.set(block.x * spread, block.y * cloud.radius * 0.8, block.z * spread)
                const unit = cloud.radius * block.size
                // A tear is a thin sliver across the cloud; a chunk is a small cube of noise.
                if (block.tear) _scale.set(unit, unit * 0.04, unit * 0.12)
                else _scale.setScalar(unit)
                _turn.setFromAxisAngle(_up, block.tear ? 0 : block.x * 3)
                _matrix.compose(_position, _turn, _scale)
                cloud.mesh.setMatrixAt(b, _matrix)
                cloud.mesh.setColorAt(b, block.white ? _white.setRGB(1.1, 1.1, 1.1) : _colour.copy(cloud.hex))
            }
            cloud.mesh.instanceMatrix.needsUpdate = true
            if (cloud.mesh.instanceColor) cloud.mesh.instanceColor.needsUpdate = true
        }
    }

    clear() {
        for (const cloud of this.clouds) this.drop(cloud)
        this.clouds = []
    }

    private drop(cloud: Cloud) {
        cloud.mesh.removeFromParent()
        cloud.mesh.dispose()
        cloud.material.dispose()
    }
}
