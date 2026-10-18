import * as THREE from 'three'
import { DF_BARRICADE_PLANKS } from '#shared/utils/dead-front/map'
import type { DfBarricade } from '#shared/utils/dead-front/map'
import { DfVoxModel } from '../../voxel/model'
import type { DfWorldKit, DfWorldPart } from '../kit'
import { DF_WORLD_SOUNDS } from '../sound-names'
import { clamp01, dfRng, easeOutBack } from '../util'

// Boarded windows: six voxel planks nailed across each window's inside face. A
// torn board wobbles, then flings outward with splinters; a repaired one swings
// up from below and slams into place. Driven by the plank counts in the
// snapshot, so carpenter refills and late joins animate too. One instanced
// mesh for every board and one for the window frames.

const BOARD_LEN = 2.5

function boardModel(): DfVoxModel {
    const m = new DfVoxModel(40, 3, 1)
    const grain = m.shade(0x9b7b52, 0.08, 7)
    m.box(0, 0, 0, 40, 3, 1, grain)
    m.box(0, 1, 0, 40, 2, 1, (i, j, k) => ((i >> 3) & 1 ? grain(i, j, k) : m.c(0x8a6b45)))
    const nail = m.c(0x2a2a2c)
    m.set(2, 1, 0, nail).set(37, 1, 0, nail).set(3, 2, 0, nail).set(36, 0, 0, nail)
    return m
}

interface Board {
    rest: THREE.Matrix4
    /** 'in' | 'tearing' | 'out' | 'repairing' */
    state: 'in' | 'tearing' | 'out' | 'repairing'
    t: number
    vel: THREE.Vector3
    spin: THREE.Vector3
    pos: THREE.Vector3
    quat: THREE.Quaternion
}

interface Win {
    b: DfBarricade
    boards: Board[]
    shown: number
    cooldown: number
    centre: THREE.Vector3
    out: THREE.Vector3
}

export function createDfBarricades(kit: DfWorldKit): DfWorldPart {
    const { map, ctx } = kit
    const rnd = dfRng(66)
    const geo = boardModel().mesh(0.0625, [20, 1.5, 0.5])!
    const unit = new DfVoxModel(1, 1, 1)
    unit.box(0, 0, 0, 1, 1, 1, unit.c(0x5a4028))
    const frameGeo = unit.mesh(1, [0.5, 0.5, 0.5])!
    const total = map.barricades.length * DF_BARRICADE_PLANKS
    const inst = new THREE.InstancedMesh(geo, kit.mat, total)
    inst.castShadow = kit.shadows
    inst.receiveShadow = true
    inst.frustumCulled = false
    kit.root.add(inst)
    const frameMats: THREE.Matrix4[] = []
    const wins: Win[] = []
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const one = new THREE.Vector3(1, 1, 1)
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)

    for (const b of map.barricades) {
        const n = new THREE.Vector3(b.inward.x, 0, b.inward.z)
        const t = new THREE.Vector3(n.z, 0, -n.x)
        const yaw = Math.atan2(t.x, t.z) - Math.PI / 2
        const base = new THREE.Vector3(b.pos.x, 0, b.pos.z).addScaledVector(n, 0.04)
        const boards: Board[] = []
        for (let k = 0; k < DF_BARRICADE_PLANKS; k++) {
            const y = 1.15 + k * 0.23 + (rnd() - 0.5) * 0.04
            const tilt = (k % 2 ? 1 : -1) * (0.08 + rnd() * 0.22)
            const pos = base.clone().setY(y).addScaledVector(t, (rnd() - 0.5) * 0.12).addScaledVector(n, k * 0.012)
            e.set(0, yaw, tilt, 'YXZ')
            q.setFromEuler(e)
            const rest = new THREE.Matrix4().compose(pos, q, new THREE.Vector3((b.width + 0.3 + rnd() * 0.2) / BOARD_LEN, 1, 1))
            boards.push({ rest, state: 'in', t: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), pos: new THREE.Vector3(), quat: new THREE.Quaternion() })
        }
        // Window frame on the inside face.
        const addFrame = (off: number, y: number, w: number, h: number) => {
            const p = base.clone().addScaledVector(t, off).setY(y)
            frameMats.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(w, h, 0.125)))
        }
        addFrame(b.width / 2 + 0.0625, 1.75, 0.125, 1.5)
        addFrame(-b.width / 2 - 0.0625, 1.75, 0.125, 1.5)
        addFrame(0, 2.44, b.width + 0.25, 0.125)
        wins.push({ b, boards, shown: DF_BARRICADE_PLANKS, cooldown: 0, centre: base.clone().setY(1.5), out: n.clone().negate() })
    }
    const frames = new THREE.InstancedMesh(frameGeo, kit.mat, frameMats.length)
    frameMats.forEach((f, i) => frames.setMatrixAt(i, f))
    frames.castShadow = kit.shadows
    frames.receiveShadow = kit.shadows
    kit.root.add(frames)
    let k = 0
    for (const w of wins) for (const bd of w.boards) inst.setMatrixAt(k++, bd.rest)
    inst.instanceMatrix.needsUpdate = true

    const scl = new THREE.Vector3()
    return {
        update(dt, world) {
            let idx = 0
            let dirty = false
            for (const w of wins) {
                const target = world.planks[w.b.id] ?? DF_BARRICADE_PLANKS
                w.cooldown -= dt
                if (w.cooldown <= 0 && target !== w.shown) {
                    if (target < w.shown) {
                        const bd = w.boards[w.shown - 1]!
                        bd.state = 'tearing'
                        bd.t = 0
                        w.shown--
                        w.cooldown = 0.08
                    } else {
                        const bd = w.boards[w.shown]!
                        bd.state = 'repairing'
                        bd.t = 0
                        w.shown++
                        w.cooldown = 0.14
                    }
                }
                for (const bd of w.boards) {
                    if (bd.state === 'tearing') {
                        bd.t += dt
                        if (bd.t < 0.18) {
                            // Wobble while the nails give.
                            bd.rest.decompose(bd.pos, bd.quat, scl)
                            e.set(Math.sin(bd.t * 70) * 0.06, 0, Math.sin(bd.t * 55) * 0.05)
                            q.setFromEuler(e)
                            m4.compose(bd.pos, bd.quat.clone().multiply(q), scl)
                            inst.setMatrixAt(idx, m4)
                        } else {
                            if (bd.vel.lengthSq() === 0) {
                                bd.rest.decompose(bd.pos, bd.quat, scl)
                                bd.vel.copy(w.out).multiplyScalar(2.5 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5))
                                bd.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 12)
                                ctx.fx.burst('splinters', bd.pos, { normal: w.out, count: 10 })
                                kit.play(DF_WORLD_SOUNDS.boardRip, bd.pos, 0.9, 0.9 + Math.random() * 0.2)
                            }
                            bd.vel.y -= 14 * dt
                            bd.pos.addScaledVector(bd.vel, dt)
                            e.set(bd.spin.x * dt, bd.spin.y * dt, bd.spin.z * dt)
                            bd.quat.multiply(q.setFromEuler(e))
                            const fade = clamp01(1 - (bd.t - 0.8) / 0.4)
                            m4.compose(bd.pos, bd.quat, scl.clone().multiplyScalar(fade))
                            inst.setMatrixAt(idx, bd.pos.y < -0.2 || fade <= 0 ? zero : m4)
                            if (bd.t > 1.2) {
                                bd.state = 'out'
                                bd.vel.set(0, 0, 0)
                                inst.setMatrixAt(idx, zero)
                            }
                        }
                        dirty = true
                    } else if (bd.state === 'repairing') {
                        bd.t += dt
                        const t = clamp01(bd.t / 0.28)
                        bd.rest.decompose(bd.pos, bd.quat, scl)
                        // Swing up from below the sill and slam home.
                        const p = easeOutBack(t, 2.4)
                        const from = bd.pos.clone().addScaledVector(w.out, -0.7).setY(0.6)
                        m4.compose(from.lerp(bd.pos, p), bd.quat, scl)
                        inst.setMatrixAt(idx, m4)
                        if (bd.t >= 0.28) {
                            bd.state = 'in'
                            inst.setMatrixAt(idx, bd.rest)
                            kit.play(DF_WORLD_SOUNDS.boardSlam, bd.pos, 0.9, 0.9 + Math.random() * 0.2)
                            ctx.fx.burst('dust', bd.pos, { count: 6, scale: 0.6 })
                        }
                        dirty = true
                    } else if (bd.state === 'out') {
                        inst.setMatrixAt(idx, zero)
                    }
                    idx++
                }
            }
            if (dirty) inst.instanceMatrix.needsUpdate = true
            void one
        },
        dispose() {
            inst.removeFromParent()
            inst.dispose()
            frames.removeFromParent()
            frames.dispose()
            geo.dispose()
            frameGeo.dispose()
        }
    }
}
