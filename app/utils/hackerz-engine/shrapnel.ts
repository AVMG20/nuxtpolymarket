import * as THREE from 'three'
import { hdr, type ModelRig } from './models'

/**
 * A Sapper going off: its spikes blown out of the cage, each flying along its
 * own line, tumbling, skidding across the floor and burning out. The board and
 * the database turntable both blow a Sapper up through this, so they match.
 */

/** Launch speed out along a spike and the kick upward (units a second per model height), fall, life and tumble. */
const SPEED = 3
const LIFT = 1.8
const GRAVITY = 7
const LIFE = 1.3
const TUMBLE = 14
/** What a bounce off the floor keeps: of the fall, and of the slide. */
const BOUNCE = 0.35
const SKID = 0.6

interface Shard {
    mesh: THREE.Mesh
    fill: THREE.MeshBasicMaterial
    edge: THREE.LineBasicMaterial | null
    velocity: THREE.Vector3
    spin: THREE.Vector3
    gravity: number
    age: number
}

const _centre = new THREE.Vector3()
const _tip = new THREE.Vector3()
const _matrix = new THREE.Matrix4()

/** Flying spikes, in `parent`'s space, above a floor at y = `floor`. */
export class Shrapnel {
    private shards: Shard[] = []

    constructor(private readonly parent: THREE.Object3D, private readonly floor = 0) {}

    /**
     * Blows `parts` of `rig` off it (a Sapper's spikes by default, a Warden's
     * shield as it breaks), each out along its own line from the body's middle.
     * Speeds scale with the model's height, so the board's and the turntable's match.
     */
    burst(rig: ModelRig, hex: number, parts: THREE.Mesh[] = rig.spikes) {
        if (!parts.length) return
        rig.root.updateWorldMatrix(true, true)
        this.parent.updateWorldMatrix(true, false)
        const toParent = _matrix.copy(this.parent.matrixWorld).invert()
        const size = rig.height * rig.root.getWorldScale(new THREE.Vector3()).y
        // From the body's middle (a Sapper's is its cage's centre).
        rig.root.localToWorld(_centre.set(0, rig.box.max.y * 0.5, 0))
        const centre = _centre.clone()
        for (const spike of parts) {
            const fill = new THREE.MeshBasicMaterial({ color: hdr(hex, 1.6), toneMapped: false, transparent: true })
            const mesh = new THREE.Mesh(spike.geometry, fill)
            mesh.applyMatrix4(toParent.clone().multiply(spike.matrixWorld))
            const edges = spike.geometry.userData.edges as THREE.BufferGeometry | undefined
            let edge: THREE.LineBasicMaterial | null = null
            if (edges) {
                edge = new THREE.LineBasicMaterial({ color: hdr(0xffffff, 1.8), toneMapped: false, transparent: true })
                mesh.add(new THREE.LineSegments(edges, edge))
            }
            this.parent.add(mesh)
            // Out along the part: from the body's middle through the part itself.
            spike.geometry.computeBoundingSphere()
            spike.localToWorld(_tip.copy(spike.geometry.boundingSphere!.center))
            const out = _tip.sub(centre).normalize().clone()
            if (out.lengthSq() === 0) out.set(0, 1, 0)
            const speed = SPEED * size * (0.75 + Math.random() * 0.5)
            const velocity = out.multiplyScalar(speed).add(new THREE.Vector3(0, LIFT * size * (0.6 + Math.random() * 0.6), 0))
            // Back into the parent's frame (it only ever turns about y here).
            velocity.applyQuaternion(this.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
            const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(TUMBLE)
            this.shards.push({ mesh, fill, edge, velocity, spin, gravity: GRAVITY * size, age: 0 })
        }
    }

    update(dt: number) {
        for (let i = this.shards.length - 1; i >= 0; i--) {
            const shard = this.shards[i]!
            shard.age += dt
            shard.velocity.y -= shard.gravity * dt
            shard.mesh.position.addScaledVector(shard.velocity, dt)
            shard.mesh.rotation.x += shard.spin.x * dt
            shard.mesh.rotation.y += shard.spin.y * dt
            shard.mesh.rotation.z += shard.spin.z * dt
            if (shard.mesh.position.y < this.floor) {
                shard.mesh.position.y = this.floor
                shard.velocity.y = Math.abs(shard.velocity.y) * BOUNCE
                shard.velocity.x *= SKID
                shard.velocity.z *= SKID
                shard.spin.multiplyScalar(SKID)
            }
            // Burns out over its last third.
            const fade = Math.min(1, (LIFE - shard.age) / (LIFE / 3))
            shard.fill.opacity = fade
            if (shard.edge) shard.edge.opacity = fade
            if (shard.age < LIFE) continue
            this.drop(shard)
            this.shards.splice(i, 1)
        }
    }

    clear() {
        for (const shard of this.shards) this.drop(shard)
        this.shards = []
    }

    private drop(shard: Shard) {
        shard.mesh.removeFromParent()
        shard.fill.dispose()
        shard.edge?.dispose()
    }
}
