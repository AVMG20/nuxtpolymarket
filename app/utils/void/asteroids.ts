// Void Runner — the asteroid field. A handful of sculpted rock shapes in three
// weights, each drawn as two instanced meshes (rock body + glowing ore
// crystals), so a few hundred rocks cost about two dozen draw calls. A coarse spatial hash answers "what rock is
// near here" and "what did this bolt hit".

import * as THREE from 'three'
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
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
    tier: number
    body: THREE.InstancedMesh
    crystals: THREE.InstancedMesh
    free: number[]
    owners: (Asteroid | null)[]
    dirty: boolean
}

/** Rocks come in three weights, so a pebble is cheap and a mountain has the polygons to hold up when you fly past it. */
const TIERS = [
    { maxRadius: 8, detail: 5, shapes: 4, perShape: 260, craters: 4, cuts: 5 },
    { maxRadius: 16, detail: 9, shapes: 4, perShape: 140, craters: 7, cuts: 7 },
    { maxRadius: Infinity, detail: 15, shapes: 3, perShape: 50, craters: 16, cuts: 5 }
] as const

/** Seeded 3D value noise with a few octaves stacked on top. */
function makeNoise(seed: number) {
    const hash = (x: number, y: number, z: number) => {
        let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(seed, 2246822519)
        h = Math.imul(h ^ (h >>> 13), 1274126177)
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296
    }
    const noise = (x: number, y: number, z: number) => {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
        const fx = x - xi, fy = y - yi, fz = z - zi
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz)
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t
        return lerp(
            lerp(lerp(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), lerp(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
            lerp(lerp(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), lerp(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
            w)
    }
    return (p: THREE.Vector3, freq: number, octaves: number) => {
        let sum = 0
        let amp = 0.5
        let total = 0
        for (let o = 0; o < octaves; o++) {
            sum += amp * noise(p.x * freq + 31.7, p.y * freq + 17.3, p.z * freq + 5.1)
            total += amp
            amp *= 0.5
            freq *= 2.1
        }
        return sum / total
    }
}

function buildShape(seed: number, tier: (typeof TIERS)[number]) {
    const rng = mulberry32(seed)
    const fbm = makeNoise(seed)
    let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, tier.detail)
    geo.deleteAttribute('normal')
    geo.deleteAttribute('uv')
    geo = mergeVertices(geo)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const randomDir = () => new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize()
    const stretch = new THREE.Vector3(0.85 + rng() * 0.4, 0.65 + rng() * 0.35, 0.8 + rng() * 0.45)
    // Impact craters: a bowl with a raised lip. Bigger rocks carry more, smaller ones.
    const big = tier.craters > 8
    const craters = Array.from({ length: tier.craters }, (_, i) => {
        const hero = i < 2
        const angle = hero ? 0.42 + rng() * 0.22 : (big ? 0.08 : 0.14) + rng() * (big ? 0.16 : 0.2)
        return { dir: randomDir(), angle, depth: angle * (0.4 + rng() * 0.25) }
    })
    // Fracture planes shear off caps and leave the flat, broken faces real rock has.
    const cuts = Array.from({ length: tier.cuts }, () => ({ dir: randomDir(), d: (big ? 0.88 : 0.8) + rng() * 0.22 }))

    const colors = new Float32Array(pos.count * 3)
    const v = new THREE.Vector3()
    const radii = new Float32Array(pos.count)
    let mean = 0
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize()
        let r = 1 + (fbm(v, 1.2, 3) - 0.5) * 0.85
        const ridge = 1 - Math.abs(fbm(v, 2.4, 3) * 2 - 1)
        r += (ridge * ridge - 0.35) * (big ? 0.32 : 0.2)
        // Deep gullies where the ridged field bottoms out.
        const gully = Math.max(0, 0.22 - ridge) / 0.22
        r -= gully * gully * 0.07
        let bowl = 0
        for (const c of craters) {
            const t = Math.acos(THREE.MathUtils.clamp(v.dot(c.dir), -1, 1)) / c.angle
            if (t > 1.6) continue
            if (t < 1) {
                r -= c.depth * (1 - t * t)
                bowl = Math.max(bowl, 1 - t * t)
            }
            r += c.depth * 0.3 * Math.exp(-(((t - 1) / 0.2) ** 2))
        }
        let cut = false
        for (const c of cuts) {
            const along = v.dot(c.dir)
            if (along > 0.05 && c.d / along < r) {
                r = c.d / along
                cut = true
            }
        }
        r += (fbm(v, 6.5, 2) - 0.5) * (cut ? 0.025 : 0.09)
        radii[i] = r
        mean += r / pos.count

        // Dusty highlands, dark bowls, paler fresh stone where a face broke away.
        const height = THREE.MathUtils.clamp((r - 0.75) / 0.5, 0, 1)
        let k = (0.42 + fbm(v, 2.2, 3) * 0.9) * (0.7 + height * 0.5) * (1 - bowl * 0.45) * (1 - gully * 0.35)
        if (cut) k *= 1.14
        const warm = height * 0.08 - bowl * 0.06
        colors[i * 3] = k * (1 + warm)
        colors[i * 3 + 1] = k
        colors[i * 3 + 2] = k * (1 - warm)
    }
    // Keep the average surface on the collision sphere whatever the carving took away.
    const norm = 0.95 / mean
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize().multiplyScalar(radii[i]! * norm).multiply(stretch)
        pos.setXYZ(i, v.x, v.y, v.z)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    // Smooth over the rolling surface, hard edges where a crag or fracture turns sharply.
    const body = toCreasedNormals(geo, 0.62)
    geo.dispose()

    // Crystal clusters: the biggest seams grow out of the crater floors, the rest anywhere. White, so the instance colour tints them.
    const parts: THREE.BufferGeometry[] = []
    const positions = body.attributes.position as THREE.BufferAttribute
    const up = new THREE.Vector3(0, 1, 0)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const triCount = positions.count / 3
    const triNearest = (dir: THREE.Vector3) => {
        let best = 0
        let bestDot = -Infinity
        for (let t = 0; t < triCount; t++) {
            const d = a.fromBufferAttribute(positions, t * 3).normalize().dot(dir)
            if (d > bestDot) {
                bestDot = d
                best = t
            }
        }
        return best
    }
    const clusters = 7 + Math.floor(rng() * 4)
    for (let i = 0; i < clusters; i++) {
        const seam = i < 3
        const tri = (seam ? triNearest(craters[i % craters.length]!.dir) : Math.floor(rng() * triCount)) * 3
        a.fromBufferAttribute(positions, tri)
        b.fromBufferAttribute(positions, tri + 1)
        c.fromBufferAttribute(positions, tri + 2)
        const p = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3)
        const n = new THREE.Vector3().subVectors(b, a).cross(c.clone().sub(a)).normalize()
        const q = new THREE.Quaternion().setFromUnitVectors(up, n)
        const shards = seam ? 5 + Math.floor(rng() * 4) : 2 + Math.floor(rng() * 3)
        for (let s = 0; s < shards; s++) {
            const lead = seam && s === 0
            const h = lead ? 0.42 + rng() * 0.22 : 0.2 + rng() * (seam ? 0.4 : 0.3)
            const w = h * (0.13 + rng() * 0.07)
            // A six-sided prism that tapers a little, capped with a point.
            const shaft = new THREE.CylinderGeometry(w * 0.72, w, h * 0.72, 6).translate(0, h * 0.36, 0)
            const tip = new THREE.CylinderGeometry(0, w * 0.72, h * 0.28, 6).translate(0, h * 0.86, 0)
            const g = mergeGeometries([shaft, tip])
            shaft.dispose()
            tip.dispose()
            const spread = lead ? 0.25 : 1.3
            const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * spread, rng() * 6, (rng() - 0.5) * spread))
            const scatter = lead ? 0 : seam ? 0.3 : 0.2
            const at = p.clone()
                .addScaledVector(n, -0.05)
                .add(new THREE.Vector3((rng() - 0.5) * scatter, 0, (rng() - 0.5) * scatter).applyQuaternion(q))
            const base = at.dot(n)
            g.applyMatrix4(new THREE.Matrix4().compose(at, q.clone().multiply(tilt), new THREE.Vector3(1, 1, 1)))
            const flat = g.toNonIndexed()
            g.dispose()
            flat.deleteAttribute('uv')
            flat.deleteAttribute('normal')
            const fp = flat.attributes.position as THREE.BufferAttribute
            const col = new Float32Array(fp.count * 3)
            const bright = 1 + rng() * 0.6
            for (let f = 0; f < fp.count; f += 3) {
                // Each facet catches the light differently; all of them burn hotter towards the tip.
                const facet = 0.75 + rng() * 0.5
                for (let j = f; j < f + 3; j++) {
                    const rise = Math.max(0, a.fromBufferAttribute(fp, j).dot(n) - base) / h
                    const k = bright * facet * (0.4 + rise * 0.95)
                    col[j * 3] = k
                    col[j * 3 + 1] = k
                    col[j * 3 + 2] = k
                }
            }
            flat.setAttribute('color', new THREE.BufferAttribute(col, 3))
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

    constructor(seed = 1) {
        TIERS.forEach((tier, t) => {
            for (let i = 0; i < tier.shapes; i++) {
                const { body, crystals } = buildShape(seed * 131 + t * 7919 + i * 977, tier)
                const bodyMesh = new THREE.InstancedMesh(body, ROCK_MATERIAL, tier.perShape)
                const crystalMesh = new THREE.InstancedMesh(crystals, GLOW_MATERIAL, tier.perShape)
                for (const mesh of [bodyMesh, crystalMesh]) {
                    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
                    mesh.frustumCulled = false
                    for (let k = 0; k < tier.perShape; k++) {
                        mesh.setMatrixAt(k, this.hidden)
                        mesh.setColorAt(k, _c.set(0x000000))
                    }
                    // Only the slots that have ever held a rock are drawn.
                    mesh.count = 0
                }
                this.group.add(bodyMesh, crystalMesh)
                this.shapes.push({ tier: t, body: bodyMesh, crystals: crystalMesh, free: Array.from({ length: tier.perShape }, (_, k) => tier.perShape - 1 - k), owners: new Array(tier.perShape).fill(null), dirty: true })
            }
        })
    }

    add(pos: THREE.Vector3, radius: number, ore: VoidResourceId | null, hpMult = 1): Asteroid | null {
        const tier = TIERS.findIndex(t => radius < t.maxRadius)
        const open = this.shapes.map((s, i) => i).filter(i => this.shapes[i]!.free.length > 0)
        const fitting = open.filter(i => this.shapes[i]!.tier === tier)
        const candidates = fitting.length ? fitting : open
        if (!candidates.length) return null
        const shapeIndex = candidates[Math.floor(Math.random() * candidates.length)]!
        const shape = this.shapes[shapeIndex]!
        const slot = shape.free.pop()!
        shape.body.count = Math.max(shape.body.count, slot + 1)
        shape.crystals.count = shape.body.count
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
