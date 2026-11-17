import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { WorldKit } from './world-kit'
import { OBSTACLE_KINDS, type ObstacleKind } from '#shared/utils/nitro-rush/obstacles'
import type { ObstacleBody } from '#shared/utils/nitro-rush/track'

/**
 * The obstacles on the road: one instanced mesh per kind, stood on the road's surface and tipped with its bank.
 * A knocked one flies off tumbling and is gone until the obstacles are reset. The tumble is cosmetic, so it uses Math.random.
 */

/** Seconds a knocked obstacle flies before it's gone. */
const FLY_TIME = 1.6
const GRAVITY = 14
/** How long an explosion's flash lasts, and how big it grows. */
const BLAST_TIME = 0.45
const BLAST_SIZE = 5

/** Each kind's mesh, built at its real size unturned: x across the road, y up, z along it. */
export function kindGeometry(kind: ObstacleKind): THREE.BufferGeometry {
    const k = OBSTACLE_KINDS[kind]
    switch (kind) {
        case 'barrel':
        case 'explosive': {
            const g = new THREE.CylinderGeometry(k.halfAlong * 0.92, k.halfAlong * 0.92, k.height, 16, 1)
            const rim = new THREE.TorusGeometry(k.halfAlong * 0.95, 0.04, 6, 16).rotateX(Math.PI / 2)
            return mergeGeometries([g.translate(0, k.height / 2, 0), rim.clone().translate(0, k.height * 0.3, 0), rim.translate(0, k.height * 0.7, 0)])!
        }
        case 'block': {
            // A jersey barrier: a wide foot and a narrower top, as a box on a box.
            const foot = new THREE.BoxGeometry(1, 0.35, 1).translate(0, 0.175, 0)
            const top = new THREE.BoxGeometry(0.55, 0.65, 1).translate(0, 0.35 + 0.325, 0)
            return mergeGeometries([foot, top])!
        }
        case 'tyres': {
            const rings = [0, 1, 2, 3].map(i => new THREE.TorusGeometry(k.halfAlong * 0.68, k.halfAlong * 0.3, 8, 18).rotateX(Math.PI / 2).translate(0, k.halfAlong * 0.3 + i * k.height / 4, 0))
            return mergeGeometries(rings)!
        }
        case 'cones': {
            const base = new THREE.BoxGeometry(k.halfAlong * 2, 0.06, k.halfAlong * 2).translate(0, 0.03, 0)
            const cone = new THREE.ConeGeometry(k.halfAlong * 0.75, k.height, 12).translate(0, k.height / 2, 0)
            return mergeGeometries([base, cone])!
        }
        case 'bumper': {
            const post = new THREE.CylinderGeometry(k.halfAlong * 0.7, k.halfAlong, k.height, 20).translate(0, k.height / 2, 0)
            const cap = new THREE.TorusGeometry(k.halfAlong * 0.75, 0.12, 8, 20).rotateX(Math.PI / 2).translate(0, k.height, 0)
            return mergeGeometries([post, cap])!
        }
        case 'oil':
            return new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2).scale(k.halfAcross, 1, k.halfAlong).translate(0, 0.035, 0)
    }
}

function kindMaterial(kind: ObstacleKind): THREE.Material {
    switch (kind) {
        case 'barrel': return new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.45, metalness: 0.5 })
        case 'explosive': return new THREE.MeshStandardMaterial({ color: 0xd4241c, emissive: 0x5a0800, roughness: 0.4, metalness: 0.45 })
        case 'block': return new THREE.MeshStandardMaterial({ color: 0xbab5aa, roughness: 0.9 })
        case 'tyres': return new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 })
        case 'cones': return new THREE.MeshStandardMaterial({ color: 0xff6a10, emissive: 0x401000, roughness: 0.6 })
        case 'bumper': return new THREE.MeshStandardMaterial({ color: 0x1fd6ff, emissive: 0x0a8fb0, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.6 })
        case 'oil': return new THREE.MeshStandardMaterial({ color: 0x07070b, roughness: 0.08, metalness: 0.7, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    }
}

/** Whether the body stands turned a quarter from how its kind is built. */
const turned = (o: ObstacleBody) => OBSTACLE_KINDS[o.kind].turns && Math.abs(o.halfAlong - OBSTACLE_KINDS[o.kind].halfAlong) > 1e-6

const basisX = new THREE.Vector3()
const basisY = new THREE.Vector3()
const basisZ = new THREE.Vector3()
const scratchM = new THREE.Matrix4()
const scaleM = new THREE.Matrix4()
const scratchQ = new THREE.Quaternion()
const scratchS = new THREE.Vector3()

/** Where an obstacle stands: on the road's surface, its up the road's, scaled for a block to its footprint. */
export function obstacleMatrix(o: ObstacleBody, out = new THREE.Matrix4()) {
    basisY.set(o.ux, o.uy, o.uz).normalize()
    basisZ.set(o.ax, 0, o.az)
    if (turned(o)) basisZ.set(-o.az, 0, o.ax)
    basisX.crossVectors(basisY, basisZ).normalize()
    basisZ.crossVectors(basisX, basisY).normalize()
    out.makeBasis(basisX, basisY, basisZ)
    if (o.kind === 'block') {
        const k = OBSTACLE_KINDS.block
        out.multiply(scaleM.makeScale(k.halfAcross * 2, k.height, k.halfAlong * 2))
    }
    out.setPosition(o.x, o.y, o.z)
    return out
}

interface Flight {
    mesh: THREE.InstancedMesh
    index: number
    base: THREE.Matrix4
    pos: THREE.Vector3
    vel: THREE.Vector3
    axis: THREE.Vector3
    spin: number
    t: number
}

/** The obstacles of a course in its world, knocked away and put back as the race goes. */
export class ObstacleMeshes {
    private readonly slots = new Map<number, { mesh: THREE.InstancedMesh, index: number, body: ObstacleBody }>()
    private readonly meshes: THREE.InstancedMesh[] = []
    private readonly flights: Flight[] = []
    private readonly blasts: { mesh: THREE.Mesh, mat: THREE.MeshBasicMaterial, t: number }[] = []

    constructor(kit: WorldKit) {
        const byKind = new Map<ObstacleKind, ObstacleBody[]>()
        for (const o of kit.track.allObstacles) byKind.set(o.kind, [...byKind.get(o.kind) ?? [], o])
        for (const [kind, list] of byKind) {
            const mesh = kit.instanced(kindGeometry(kind), kit.own(kindMaterial(kind)), list.length)
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
            mesh.receiveShadow = kind === 'oil'
            list.forEach((o, i) => {
                mesh.setMatrixAt(i, obstacleMatrix(o, scratchM))
                this.slots.set(o.id, { mesh, index: i, body: o })
            })
            mesh.computeBoundingSphere()
            this.meshes.push(mesh)
        }
        if (byKind.has('explosive')) {
            const geo = kit.own(new THREE.SphereGeometry(1, 16, 12))
            for (let i = 0; i < 3; i++) {
                const mat = kit.own(new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
                const mesh = new THREE.Mesh(geo, mat)
                mesh.visible = false
                kit.group.add(mesh)
                this.blasts.push({ mesh, mat, t: BLAST_TIME })
            }
        }
    }

    /** Sends obstacle `id` flying off the car moving (vx, vz) at `speed`. */
    knock(id: number, vx: number, vz: number) {
        const slot = this.slots.get(id)
        if (!slot || this.flights.some(f => f.mesh === slot.mesh && f.index === slot.index)) return
        const base = obstacleMatrix(slot.body).setPosition(0, 0, 0)
        const pos = new THREE.Vector3(slot.body.x, slot.body.y, slot.body.z)
        const speed = Math.hypot(vx, vz)
        const scatter = (Math.random() - 0.5) * 0.6
        const vel = new THREE.Vector3(
            vx * 0.7 + -vz * scatter,
            3 + Math.min(10, speed * 0.15) + Math.random() * 2,
            vz * 0.7 + vx * scatter
        )
        const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5).normalize()
        this.flights.push({ mesh: slot.mesh, index: slot.index, base, pos, vel, axis, spin: 6 + Math.random() * 8, t: 0 })
        if (slot.body.kind === 'explosive') this.blast(pos)
    }

    private blast(at: THREE.Vector3) {
        const b = this.blasts.find(b => b.t >= BLAST_TIME) ?? this.blasts[0]
        if (!b) return
        b.t = 0
        b.mesh.position.copy(at).setY(at.y + 0.8)
        b.mesh.visible = true
    }

    /** Every obstacle back where it stood. */
    reset() {
        this.flights.length = 0
        for (const { mesh, index, body } of this.slots.values()) mesh.setMatrixAt(index, obstacleMatrix(body, scratchM))
        for (const m of this.meshes) m.instanceMatrix.needsUpdate = true
        for (const b of this.blasts) {
            b.t = BLAST_TIME
            b.mesh.visible = false
        }
    }

    update(dt: number) {
        for (let i = this.flights.length - 1; i >= 0; i--) {
            const f = this.flights[i]!
            f.t += dt
            if (f.t >= FLY_TIME) {
                f.mesh.setMatrixAt(f.index, scratchM.makeScale(0, 0, 0))
                f.mesh.instanceMatrix.needsUpdate = true
                this.flights.splice(i, 1)
                continue
            }
            f.vel.y -= GRAVITY * dt
            f.pos.addScaledVector(f.vel, dt)
            scratchQ.setFromAxisAngle(f.axis, f.spin * f.t)
            const shrink = f.t > FLY_TIME * 0.7 ? 1 - (f.t - FLY_TIME * 0.7) / (FLY_TIME * 0.3) : 1
            scratchS.setScalar(Math.max(0.001, shrink))
            scratchM.compose(f.pos, scratchQ, scratchS).multiply(f.base)
            f.mesh.setMatrixAt(f.index, scratchM)
            f.mesh.instanceMatrix.needsUpdate = true
        }
        for (const b of this.blasts) {
            if (b.t >= BLAST_TIME) continue
            b.t += dt
            const k = Math.min(1, b.t / BLAST_TIME)
            b.mesh.scale.setScalar(0.5 + BLAST_SIZE * (1 - (1 - k) * (1 - k)))
            b.mat.opacity = (1 - k) * 0.9
            if (k >= 1) b.mesh.visible = false
        }
    }
}
