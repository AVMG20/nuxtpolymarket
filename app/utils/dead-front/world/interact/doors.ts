import * as THREE from 'three'
import type { DfDoor, DfSolid } from '#shared/utils/dead-front/map'
import { dfRaycast } from '#shared/utils/dead-front/physics'
import { dfHash3 } from '#shared/utils/dead-front/voxel'
import { DfVoxModel } from '../../voxel/model'
import type { DfWorldKit, DfWorldPart } from '../kit'
import { DF_WORLD_SOUNDS } from '../sound-names'
import { clamp01, dfRng, easeInCubic, easeOutBack } from '../util'

// Buyable doors: plank doors and an iron cemetery gate that burst open on
// their hinges with an overshoot, and rubble heaps of voxel blocks that blow
// apart, tumble, settle and crumble away.

interface Chunk {
    pos: THREE.Vector3
    quat: THREE.Quaternion
    vel: THREE.Vector3
    spin: THREE.Vector3
    size: number
    floor: number
    settled: boolean
}

interface DoorVis {
    door: DfDoor
    open: boolean
    t: number
    animating: boolean
    pivot?: THREE.Group
    swing?: number
    chunks?: Chunk[]
    inst?: THREE.InstancedMesh
    group: THREE.Group
    centre: THREE.Vector3
}

function bboxOf(solids: DfSolid[]): THREE.Box3 {
    const b = new THREE.Box3()
    for (const s of solids) {
        b.expandByPoint(new THREE.Vector3(s.min.x, s.min.y, s.min.z))
        b.expandByPoint(new THREE.Vector3(s.max.x, s.max.y, s.max.z))
    }
    return b
}

const CELL = 0.125

/** A door leaf `w` voxels wide and `h` tall, along +x from the hinge, 2 voxels thick. */
function leafModel(w: number, h: number, iron: boolean): DfVoxModel {
    const m = new DfVoxModel(w, h, 2)
    if (iron) {
        const bar = m.c(0x2a2b2e)
        const rust = m.c(0x5e3b26)
        for (let i = 0; i < w; i += 2) m.box(i, 0, 0, i + 1, h - 2 + (i % 4 === 0 ? 2 : 0), 1, dfHash3(i, 0, 0, 3) < 0.3 ? rust : bar)
        for (const y of [1, Math.floor(h / 2), h - 3]) m.box(0, y, 0, w, y + 1, 2, bar)
        m.box(0, 0, 0, 1, h, 2, bar).box(w - 1, 0, 0, w, h, 2, bar)
        return m
    }
    const plank = (i: number, j: number, k: number) => m.c([0x6e4d2f, 0x7b5735, 0x664629][((i >> 2) + (dfHash3(i >> 2, j >> 3, k, 5) < 0.2 ? 1 : 0)) % 3]!)
    m.box(0, 0, 0, w, h, 2, plank)
    const strap = m.c(0x2a2a2c)
    for (const y of [3, Math.floor(h / 2), h - 4]) m.box(0, y, 1, w, y + 1, 2, strap)
    // A Z brace.
    for (let i = 1; i < w - 1; i++) m.set(i, Math.floor(3 + (i / w) * (h / 2 - 3)), 1, m.c(0x523720))
    m.box(w - 4, Math.floor(h * 0.45), 1, w - 3, Math.floor(h * 0.45) + 2, 2, m.c(0x9a7a3a))
    return m
}

export function createDfDoors(kit: DfWorldKit): DfWorldPart {
    const { map, ctx } = kit
    const rnd = dfRng(31)
    const geos: THREE.BufferGeometry[] = []
    const cube = new DfVoxModel(1, 1, 1)
    cube.box(0, 0, 0, 1, 1, 1, cube.c(0xffffff))
    const cubeGeo = cube.mesh(1, [0.5, 0.5, 0.5])!
    geos.push(cubeGeo)
    const stoneCols = [0x7b7569, 0x696359, 0x8b8579, 0x8f4c37, 0x5c574f, 0x4b3521].map(h => new THREE.Color(h))
    const doors: DoorVis[] = []
    const m4 = new THREE.Matrix4()
    const s3 = new THREE.Vector3()

    for (const door of map.doors) {
        const solids = map.solids.filter(s => s.door === door.id)
        const bb = bboxOf(solids)
        const size = bb.getSize(new THREE.Vector3())
        const centre = bb.getCenter(new THREE.Vector3())
        const group = new THREE.Group()
        kit.root.add(group)
        const vis: DoorVis = { door, open: false, t: 0, animating: false, group, centre }
        if ((door.style ?? 'door') === 'door') {
            const alongX = size.x >= size.z
            const width = alongX ? size.x : size.z
            const iron = solids.some(s => s.mat === 'metal')
            const w = Math.round(width / CELL)
            const h = Math.round(size.y / CELL)
            const geo = leafModel(w, h, iron).mesh(CELL, [0, 0, 1])!
            geos.push(geo)
            const pivot = new THREE.Group()
            pivot.position.set(alongX ? bb.min.x : centre.x, bb.min.y, alongX ? centre.z : bb.min.z)
            group.add(pivot)
            const leaf = new THREE.Mesh(geo, kit.mat)
            leaf.castShadow = kit.shadows
            leaf.receiveShadow = kit.shadows
            // The leaf model runs along +x; along z it is turned so it runs along +z.
            if (!alongX) leaf.rotation.y = -Math.PI / 2
            pivot.add(leaf)
            const n = alongX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
            const probe = (dir: THREE.Vector3) => dfRaycast(kit.collision, { x: centre.x + dir.x * 0.6, y: bb.min.y + 1, z: centre.z + dir.z * 0.6 }, { x: dir.x, y: 0, z: dir.z }, 3)?.dist ?? 3
            const sign = probe(n) >= probe(n.clone().negate()) ? 1 : -1
            vis.swing = (alongX ? -sign : sign) * 1.75
            vis.pivot = pivot
        } else {
            const chunks: Chunk[] = []
            for (const s of solids) {
                const sx = s.max.x - s.min.x
                const sy = s.max.y - s.min.y
                const sz = s.max.z - s.min.z
                const n = Math.min(60, Math.max(10, Math.round(sx * sy * sz * 14)))
                for (let k = 0; k < n; k++) {
                    const size = rnd() < 0.3 ? 0.5 : rnd() < 0.6 ? 0.375 : 0.25
                    const yt = Math.min(0.95, rnd() ** 1.3)
                    const narrow = 1 - yt * 0.4
                    chunks.push({
                        pos: new THREE.Vector3(s.min.x + sx * (0.5 + (rnd() - 0.5) * narrow), s.min.y + sy * yt + size * 0.4, s.min.z + sz * (0.5 + (rnd() - 0.5) * narrow)),
                        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.6, rnd() * 3, (rnd() - 0.5) * 0.6)),
                        vel: new THREE.Vector3(),
                        spin: new THREE.Vector3(),
                        size,
                        floor: s.min.y,
                        settled: false
                    })
                }
                // Fallen beams across the opening.
                for (let k = 0; k < 2; k++) {
                    const long = Math.max(sx, sz) * (1 + rnd() * 0.2)
                    chunks.push({
                        pos: new THREE.Vector3(s.min.x + sx / 2, s.min.y + sy * (0.35 + rnd() * 0.45), s.min.z + sz / 2),
                        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sx >= sz ? 0 : Math.PI / 2, (rnd() - 0.5) * 0.8)),
                        vel: new THREE.Vector3(),
                        spin: new THREE.Vector3(),
                        size: -long,
                        floor: s.min.y,
                        settled: false
                    })
                }
            }
            const inst = new THREE.InstancedMesh(cubeGeo, kit.mat, chunks.length)
            inst.castShadow = kit.shadows
            inst.receiveShadow = kit.shadows
            chunks.forEach((c, i) => inst.setColorAt(i, c.size < 0 ? stoneCols[5]! : stoneCols[Math.floor(rnd() * 5)]!))
            vis.chunks = chunks
            vis.inst = inst
            writeChunks(vis, 0)
            group.add(inst)
        }
        doors.push(vis)
    }

    function writeChunks(d: DoorVis, fade: number): void {
        const inst = d.inst!
        d.chunks!.forEach((c, i) => {
            const k = 1 - fade
            if (c.size < 0) {
                s3.set(-c.size * k, 0.22 * k, 0.22 * k)
            } else {
                s3.setScalar(c.size * k)
            }
            inst.setMatrixAt(i, m4.compose(c.pos, c.quat, s3))
        })
        inst.instanceMatrix.needsUpdate = true
    }

    let first = true
    const shakeFor = (p: THREE.Vector3, amount: number) => amount * clamp01(1 - ctx.camera.position.distanceTo(p) / 14)
    const startOpen = (d: DoorVis, instant: boolean) => {
        d.open = true
        d.t = 0
        if (instant) {
            d.t = 10
            if (d.pivot && d.swing !== undefined) d.pivot.rotation.y = d.swing
            if (d.chunks) d.group.visible = false
            return
        }
        d.animating = true
        const p = d.centre
        if (d.chunks) {
            kit.play(DF_WORLD_SOUNDS.debrisCrash, p, 1)
            for (const c of d.chunks) {
                const dx = c.pos.x - p.x
                const dz = c.pos.z - p.z
                const len = Math.hypot(dx, dz) || 1
                const out = 1.4 + Math.random() * 2.6
                c.vel.set(dx / len * out + (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 3, dz / len * out + (Math.random() - 0.5) * 1.5)
                c.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10)
            }
            for (let k = 0; k < 4; k++) ctx.fx.burst('dust', { x: p.x + (Math.random() - 0.5) * 2, y: p.y - 0.6 + Math.random(), z: p.z + (Math.random() - 0.5) * 2 }, { count: 12, scale: 2 })
            ctx.fx.burst('smoke', p, { scale: 1.6 })
            ctx.fx.shake(shakeFor(p, 0.35))
        } else {
            kit.play(DF_WORLD_SOUNDS.doorOpen, p, 1)
            ctx.fx.burst('dust', { x: p.x, y: p.y - 0.6, z: p.z }, { count: 16, scale: 1.4 })
            ctx.fx.burst('splinters', p, { count: 10 })
            ctx.fx.shake(shakeFor(p, 0.15))
        }
    }

    const e = new THREE.Euler()
    const dq = new THREE.Quaternion()
    return {
        update(dt, world) {
            for (const d of doors) {
                const isOpen = world.doors.includes(d.door.id)
                if (isOpen && !d.open) startOpen(d, first)
                if (!d.animating) continue
                d.t += dt
                if (d.pivot && d.swing !== undefined) {
                    d.pivot.rotation.y = d.swing * easeOutBack(clamp01(d.t / 0.7), 2.2)
                    if (d.t > 1) d.animating = false
                } else if (d.chunks) {
                    for (const c of d.chunks) {
                        if (c.settled) continue
                        c.vel.y -= 16 * dt
                        c.pos.addScaledVector(c.vel, dt)
                        dq.setFromEuler(e.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt))
                        c.quat.multiply(dq)
                        const rest = c.floor + Math.abs(c.size) * 0.3
                        if (c.pos.y < rest) {
                            c.pos.y = rest
                            c.vel.y *= -0.3
                            c.vel.x *= 0.5
                            c.vel.z *= 0.5
                            c.spin.multiplyScalar(0.4)
                            if (Math.abs(c.vel.y) < 0.6) c.settled = true
                        }
                    }
                    const fade = easeInCubic(clamp01((d.t - 1.5) / 1.2))
                    writeChunks(d, fade)
                    if (d.t > 2.8) {
                        d.animating = false
                        d.group.visible = false
                    }
                }
            }
            first = false
        },
        onEvent(ev) {
            if (ev.k !== 'door') return
            const d = doors.find(x => x.door.id === ev.id)
            if (d && !d.open) startOpen(d, false)
        },
        dispose() {
            for (const d of doors) {
                d.group.removeFromParent()
                d.inst?.dispose()
            }
            for (const g of geos) g.dispose()
        }
    }
}
