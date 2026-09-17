// Void Runner — the asteroid field. A handful of rock shapes, each drawn as two
// instanced meshes (rock body + glowing ore crystals), so a few hundred rocks
// cost about a dozen draw calls. A coarse spatial hash answers "what rock is
// near here" and "what did this bolt hit".

import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { VoidResourceId } from '#shared/utils/gamelogic/void'
import { GLOW_MATERIAL, ROCK_MATERIAL, mulberry32 } from './models'

export const ORE_GLOW: Partial<Record<VoidResourceId, number>> = {
    ferrite: 0x9fc3e6,
    cobalt: 0x3f8cff,
    iridium: 0xb66dff,
    xenite: 0x2dffa6
}

const ROCK_TINT: Record<string, number> = {
    none: 0x6a6462,
    ferrite: 0x7a7c82,
    cobalt: 0x56657f,
    iridium: 0x625470,
    xenite: 0x4b6a5f
}

export interface Asteroid {
    id: number
    shape: number
    slot: number
    pos: THREE.Vector3
    radius: number
    ore: VoidResourceId | null
    hp: number
    maxHp: number
    quat: THREE.Quaternion
    spinAxis: THREE.Vector3
    spin: number
    flash: number
    /** Chip thresholds already paid out (each quarter of hp drops a little ore). */
    chips: number
    alive: boolean
}

interface Shape {
    body: THREE.InstancedMesh
    crystals: THREE.InstancedMesh
    free: number[]
    owners: (Asteroid | null)[]
    dirty: boolean
}

function buildShape(seed: number) {
    const rng = mulberry32(seed)
    let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1)
    geo.deleteAttribute('normal')
    geo.deleteAttribute('uv')
    geo = mergeVertices(geo)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const stretch = new THREE.Vector3(0.8 + rng() * 0.4, 0.7 + rng() * 0.35, 0.8 + rng() * 0.45)
    const bumps = Array.from({ length: 6 }, () => ({ dir: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), amp: (rng() - 0.45) * 0.55 }))
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize()
        let d = 1 + (rng() - 0.5) * 0.3
        for (const bump of bumps) d += Math.max(0, v.dot(bump.dir) - 0.45) * bump.amp
        v.multiplyScalar(d).multiply(stretch)
        pos.setXYZ(i, v.x, v.y, v.z)
    }
    const body = geo.toNonIndexed()
    geo.dispose()
    body.computeVertexNormals()
    const count = body.attributes.position!.count
    const colors = new Float32Array(count * 3)
    for (let f = 0; f < count / 3; f++) {
        const k = 0.72 + rng() * 0.5
        for (let j = 0; j < 9; j++) colors[f * 9 + j] = k
    }
    body.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    // Crystal clusters sprouting from random faces, white so the instance colour tints them.
    const parts: THREE.BufferGeometry[] = []
    const positions = body.attributes.position as THREE.BufferAttribute
    const normals = body.attributes.normal as THREE.BufferAttribute
    const up = new THREE.Vector3(0, 1, 0)
    const clusters = 4 + Math.floor(rng() * 3)
    for (let i = 0; i < clusters; i++) {
        const tri = Math.floor(rng() * (positions.count / 3)) * 3
        const p = new THREE.Vector3().fromBufferAttribute(positions, tri)
            .add(new THREE.Vector3().fromBufferAttribute(positions, tri + 1))
            .add(new THREE.Vector3().fromBufferAttribute(positions, tri + 2))
            .multiplyScalar(1 / 3)
        const n = new THREE.Vector3().fromBufferAttribute(normals, tri).normalize()
        const q = new THREE.Quaternion().setFromUnitVectors(up, n)
        const shards = 2 + Math.floor(rng() * 3)
        for (let s = 0; s < shards; s++) {
            const h = 0.3 + rng() * 0.45
            const w = 0.06 + rng() * 0.07
            const g = new THREE.CylinderGeometry(0, w, h, 5).translate(0, h / 2, 0)
            const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 1.1, rng() * 6, (rng() - 0.5) * 1.1))
            const at = p.clone()
                .addScaledVector(n, -0.04)
                .add(new THREE.Vector3((rng() - 0.5) * 0.22, 0, (rng() - 0.5) * 0.22).applyQuaternion(q))
            g.applyMatrix4(new THREE.Matrix4().compose(at, q.clone().multiply(tilt), new THREE.Vector3(1, 1, 1)))
            const flat = g.toNonIndexed()
            g.dispose()
            flat.deleteAttribute('uv')
            flat.computeVertexNormals()
            const c = new Float32Array(flat.attributes.position!.count * 3)
            const bright = 1.2 + rng() * 1.0
            for (let j = 0; j < c.length; j += 3) {
                // Brighter towards the tip.
                const y = (flat.attributes.position as THREE.BufferAttribute).getY(j / 3)
                const k = bright * (0.7 + Math.max(0, y - p.y) * 1.2)
                c[j] = k
                c[j + 1] = k
                c[j + 2] = k
            }
            flat.setAttribute('color', new THREE.BufferAttribute(c, 3))
            parts.push(flat)
        }
    }
    const crystals = mergeGeometries(parts)
    parts.forEach(g => g.dispose())
    return { body, crystals }
}

const CELL = 90
const key = (x: number, y: number, z: number) => ((x + 512) * 1048576) + ((y + 512) * 1024) + (z + 512)

const _m = new THREE.Matrix4()
const _s = new THREE.Vector3()
const _c = new THREE.Color()
const _q = new THREE.Quaternion()
const _d = new THREE.Vector3()
const _o = new THREE.Vector3()

export class AsteroidField {
    readonly group = new THREE.Group()
    rocks: Asteroid[] = []
    private shapes: Shape[] = []
    private grid = new Map<number, Asteroid[]>()
    private nextId = 1
    private hidden = new THREE.Matrix4().makeScale(0, 0, 0)

    constructor(shapeCount = 7, perShape = 160, seed = 1) {
        for (let i = 0; i < shapeCount; i++) {
            const { body, crystals } = buildShape(seed * 131 + i * 977)
            const bodyMesh = new THREE.InstancedMesh(body, ROCK_MATERIAL, perShape)
            const crystalMesh = new THREE.InstancedMesh(crystals, GLOW_MATERIAL, perShape)
            for (const mesh of [bodyMesh, crystalMesh]) {
                mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
                mesh.frustumCulled = false
                for (let k = 0; k < perShape; k++) {
                    mesh.setMatrixAt(k, this.hidden)
                    mesh.setColorAt(k, _c.set(0x000000))
                }
            }
            this.group.add(bodyMesh, crystalMesh)
            this.shapes.push({ body: bodyMesh, crystals: crystalMesh, free: Array.from({ length: perShape }, (_, k) => perShape - 1 - k), owners: new Array(perShape).fill(null), dirty: true })
        }
    }

    add(pos: THREE.Vector3, radius: number, ore: VoidResourceId | null, hpMult = 1): Asteroid | null {
        const candidates = this.shapes.map((s, i) => i).filter(i => this.shapes[i]!.free.length > 0)
        if (!candidates.length) return null
        const shapeIndex = candidates[Math.floor(Math.random() * candidates.length)]!
        const shape = this.shapes[shapeIndex]!
        const slot = shape.free.pop()!
        const maxHp = ore ? Math.round(Math.pow(radius, 1.55) * 3.2 * hpMult) : Number.POSITIVE_INFINITY
        const rock: Asteroid = {
            id: this.nextId++,
            shape: shapeIndex,
            slot,
            pos: pos.clone(),
            radius,
            ore,
            hp: maxHp,
            maxHp,
            quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
            spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
            spin: (0.05 + Math.random() * 0.2) * (radius > 20 ? 0.3 : 1),
            flash: 0,
            chips: 0,
            alive: true
        }
        shape.owners[slot] = rock
        this.rocks.push(rock)
        this.gridInsert(rock)
        this.writeColor(rock)
        return rock
    }

    remove(rock: Asteroid) {
        if (!rock.alive) return
        rock.alive = false
        const shape = this.shapes[rock.shape]!
        shape.owners[rock.slot] = null
        shape.free.push(rock.slot)
        shape.body.setMatrixAt(rock.slot, this.hidden)
        shape.crystals.setMatrixAt(rock.slot, this.hidden)
        shape.dirty = true
        this.rocks = this.rocks.filter(r => r !== rock)
        this.gridEach(rock.pos, rock.radius, (cellKey) => {
            const list = this.grid.get(cellKey)
            if (list) this.grid.set(cellKey, list.filter(r => r !== rock))
        })
    }

    clear() {
        for (const rock of [...this.rocks]) this.remove(rock)
        this.grid.clear()
    }

    private writeColor(rock: Asteroid) {
        const shape = this.shapes[rock.shape]!
        const flash = rock.flash
        _c.set(ROCK_TINT[rock.ore ?? 'none']!)
        if (flash > 0) _c.lerp(new THREE.Color(1.6, 1.4, 1.2), flash * 0.6)
        shape.body.setColorAt(rock.slot, _c)
        if (rock.ore) _c.set(ORE_GLOW[rock.ore] ?? 0xffffff).multiplyScalar(1 + flash * 1.5)
        else _c.setRGB(0, 0, 0)
        shape.crystals.setColorAt(rock.slot, _c)
        shape.dirty = true
    }

    private gridEach(pos: THREE.Vector3, radius: number, cb: (key: number) => void) {
        const x0 = Math.floor((pos.x - radius) / CELL)
        const x1 = Math.floor((pos.x + radius) / CELL)
        const y0 = Math.floor((pos.y - radius) / CELL)
        const y1 = Math.floor((pos.y + radius) / CELL)
        const z0 = Math.floor((pos.z - radius) / CELL)
        const z1 = Math.floor((pos.z + radius) / CELL)
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                for (let z = z0; z <= z1; z++) cb(key(x, y, z))
            }
        }
    }

    private gridInsert(rock: Asteroid) {
        this.gridEach(rock.pos, rock.radius, (k) => {
            const list = this.grid.get(k)
            if (list) list.push(rock)
            else this.grid.set(k, [rock])
        })
    }

    private stamp = 0
    private seen = new Map<number, number>()

    /** Calls `cb` once for every rock whose bounds touch the sphere. */
    query(pos: THREE.Vector3, radius: number, cb: (rock: Asteroid) => void) {
        const stamp = ++this.stamp
        this.gridEach(pos, radius, (k) => {
            const list = this.grid.get(k)
            if (!list) return
            for (const rock of list) {
                if (this.seen.get(rock.id) === stamp) continue
                this.seen.set(rock.id, stamp)
                const r = rock.radius + radius
                if (rock.pos.distanceToSquared(pos) <= r * r) cb(rock)
            }
        })
    }

    /** Nearest rock hit by the segment a→b, with the hit distance along it. */
    raycast(a: THREE.Vector3, b: THREE.Vector3, pad = 0): { rock: Asteroid, t: number } | null {
        _d.subVectors(b, a)
        const len = _d.length()
        if (len < 1e-5) return null
        _d.divideScalar(len)
        _o.addVectors(a, b).multiplyScalar(0.5)
        let best: { rock: Asteroid, t: number } | null = null
        this.query(_o, len / 2 + pad, (rock) => {
            const r = rock.radius * 0.92 + pad
            const t = raySphere(a, _d, rock.pos, r)
            if (t !== null && t <= len && (!best || t < best.t)) best = { rock, t }
        })
        return best
    }

    update(dt: number) {
        for (const rock of this.rocks) {
            _q.setFromAxisAngle(rock.spinAxis, rock.spin * dt)
            rock.quat.premultiply(_q)
            _s.set(rock.radius, rock.radius, rock.radius)
            _m.compose(rock.pos, rock.quat, _s)
            const shape = this.shapes[rock.shape]!
            shape.body.setMatrixAt(rock.slot, _m)
            shape.crystals.setMatrixAt(rock.slot, rock.ore ? _m : this.hidden)
            if (rock.flash > 0) {
                rock.flash = Math.max(0, rock.flash - dt * 6)
                this.writeColor(rock)
            }
        }
        for (const shape of this.shapes) {
            shape.body.instanceMatrix.needsUpdate = true
            shape.crystals.instanceMatrix.needsUpdate = true
            if (shape.dirty) {
                if (shape.body.instanceColor) shape.body.instanceColor.needsUpdate = true
                if (shape.crystals.instanceColor) shape.crystals.instanceColor.needsUpdate = true
                shape.dirty = false
            }
        }
    }

    hit(rock: Asteroid) {
        rock.flash = 1
        this.writeColor(rock)
    }

    dispose() {
        for (const shape of this.shapes) {
            shape.body.geometry.dispose()
            shape.crystals.geometry.dispose()
            shape.body.dispose()
            shape.crystals.dispose()
        }
    }
}

/** Distance along a normalised ray to a sphere, or null. */
export function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
    const ox = origin.x - center.x
    const oy = origin.y - center.y
    const oz = origin.z - center.z
    const b = ox * dir.x + oy * dir.y + oz * dir.z
    const c = ox * ox + oy * oy + oz * oz - radius * radius
    if (c <= 0) return 0
    const h = b * b - c
    if (h < 0 || b > 0) return null
    return -b - Math.sqrt(h)
}
