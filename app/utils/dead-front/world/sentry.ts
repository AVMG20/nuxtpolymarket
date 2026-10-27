import * as THREE from 'three'
import { DF_DECOY, DF_SENTRY } from '#shared/utils/dead-front/salvage'
import type { DfDecoySnap, DfSentrySnap } from '#shared/utils/dead-front/salvage'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from '../engine/arsenal-sounds'
import { dfVoxMaterial } from '../voxel/material'
import type { DfVoxMaterial } from '../voxel/material'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'
import { damp, easeOutBack } from './util'

// Crafted gear in the world (world.arsenal.sentries / decoys). The Lewis
// sentry: an iron tripod carrying a Lewis gun with its round pan magazine and
// fat cooling shroud; it swings onto its target, flashes, rattles and draws a
// tracer per shot (the snapshot's shot counter), its pan turning as it feeds,
// a lamp on the receiver blinking red when it runs low. Clawed apart it bursts
// in sparks; spent it hisses and goes still. The gramophone: a walnut box
// with a turning record and a great brass horn, playing a scratchy waltz the
// dead can't resist until it blows.

const C = 0.05
const TRACER = 0xffd28a

function tripodModel(): DfVoxModel {
    // three splayed legs meeting under a pivot plate (a voxel tripod: legs as stepped bars)
    const m = new DfVoxModel(15, 18, 15)
    const iron = m.shade(0x34363a, 0.06, 91)
    const dark = m.c(0x232427)
    for (let j = 0; j < 16; j++) {
        const spread = Math.round((16 - j) * 0.42)
        m.set(7, j, 7 + spread, iron(7, j, 7))
        m.set(7 - spread, j, 7 - Math.round(spread * 0.5), iron(7, j, 7))
        m.set(7 + spread, j, 7 - Math.round(spread * 0.5), iron(7, j, 7))
    }
    for (const [i, k] of [[7, 14], [0, 3], [14, 3]] as const) m.box(Math.max(0, i - 1), 0, Math.max(0, k - 1), Math.min(15, i + 1), 1, Math.min(15, k + 1), dark)
    m.box(5, 16, 5, 10, 18, 10, iron)
    return m
}

function gunModel(): DfVoxModel {
    // a Lewis gun along +z (muzzle forward): stock, receiver, fat shroud, pan on top
    const m = new DfVoxModel(7, 7, 30)
    const steel = m.shade(0x3b3e43, 0.05, 92)
    const shroud = m.shade(0x2a2c30, 0.06, 93)
    const wood = m.shade(0x6b4a2f, 0.08, 94)
    m.box(2, 1, 0, 5, 3, 6, wood) // butt
    m.box(2, 1, 6, 5, 4, 12, steel) // receiver
    m.box(3, 0, 9, 4, 1, 11, steel) // grip
    m.box(1, 1, 12, 6, 5, 26, shroud) // cooling shroud
    for (let k = 13; k < 26; k += 2) m.box(1, 1, k, 6, 5, k + 1, (i, j, kk) => steel(i, j, kk))
    m.box(3, 2, 26, 4, 3, 30, steel) // muzzle
    m.box(3, 4, 7, 4, 5, 8, m.c(0xffffff, 1)) // the status lamp (tinted by material)
    return m
}

function panModel(): DfVoxModel {
    // the round pan magazine: a flat drum with radial ribs
    const m = new DfVoxModel(11, 2, 11)
    const pan = m.shade(0x3f4247, 0.05, 95)
    const rib = m.c(0x2a2c30)
    for (let i = 0; i < 11; i++) {
        for (let k = 0; k < 11; k++) {
            const d = Math.hypot(i - 5, k - 5)
            if (d > 5.4) continue
            m.set(i, 0, k, pan(i, 0, k))
            if (d < 1.3 || (i === 5 || k === 5)) m.set(i, 1, k, rib)
        }
    }
    return m
}

function gramophoneModel(): DfVoxModel {
    const m = new DfVoxModel(10, 6, 10)
    const walnut = m.shade(0x5a3a22, 0.08, 96)
    const brass = m.c(0xb08a3c)
    m.box(0, 0, 0, 10, 4, 10, walnut)
    m.box(0, 3, 0, 10, 4, 10, m.c(0x3e2716))
    m.box(9, 2, 4, 10, 3, 6, brass) // the crank
    m.box(4, 4, 4, 6, 6, 6, brass) // the tone arm's post
    return m
}

function recordModel(): DfVoxModel {
    const m = new DfVoxModel(9, 1, 9)
    for (let i = 0; i < 9; i++) {
        for (let k = 0; k < 9; k++) {
            const d = Math.hypot(i - 4, k - 4)
            if (d > 4.4) continue
            m.set(i, 0, k, d < 1.2 ? m.c(0xc8463f) : m.c((i + k) % 2 ? 0x18181a : 0x222226))
        }
    }
    return m
}

function hornModel(): DfVoxModel {
    // a flaring brass horn along +y, its bell at the top
    const m = new DfVoxModel(13, 14, 13)
    const brass = m.shade(0xc49a42, 0.06, 97)
    const inside = m.c(0x5a4318)
    for (let j = 0; j < 14; j++) {
        const r = 0.9 + Math.pow(j / 13, 2.2) * 5.6
        for (let i = 0; i < 13; i++) {
            for (let k = 0; k < 13; k++) {
                const d = Math.hypot(i - 6, k - 6)
                if (d <= r && d > r - 1.2) m.set(i, j, k, brass(i, j, k))
                else if (j === 13 && d < r - 1.2) m.set(i, j, k, inside)
            }
        }
    }
    return m
}

interface SentryView {
    id: number
    group: THREE.Group
    gun: THREE.Group
    pan: THREE.Object3D
    lamp: DfVoxMaterial
    shots: number
    yaw: number
    pitch: number
    pop: number
    seen: boolean
    gone: number
    smokeIn: number
    snap: DfSentrySnap
}

interface DecoyView {
    id: number
    group: THREE.Group
    record: THREE.Object3D
    horn: THREE.Object3D
    bar: number
    barIn: number
    pop: number
    seen: boolean
    snap: DfDecoySnap
}

export function createDfGear(kit: DfWorldKit): DfWorldPart {
    const { ctx } = kit
    registerDfArsenalSounds(ctx.audio)
    const shadow = kit.shadows
    const tripodGeo = tripodModel().mesh(C, [7.5, 0, 7.5])!
    const gunGeo = gunModel().mesh(C, [3.5, 2.5, 9])!
    const panGeo = panModel().mesh(C, [5.5, 0, 5.5])!
    const gramGeo = gramophoneModel().mesh(C, [5, 0, 5])!
    const recGeo = recordModel().mesh(C, [4.5, 0, 4.5])!
    const hornGeo = hornModel().mesh(C, [6.5, 0, 6.5])!
    const geos = [tripodGeo, gunGeo, panGeo, gramGeo, recGeo, hornGeo]
    const sentries = new Map<number, SentryView>()
    const decoys = new Map<number, DecoyView>()
    const tmp = new THREE.Vector3()
    const tmp2 = new THREE.Vector3()

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = shadow) => {
        const o = new THREE.Mesh(geo, mat)
        o.castShadow = cast
        o.receiveShadow = shadow
        return o
    }

    const makeSentry = (s: DfSentrySnap): SentryView => {
        const group = new THREE.Group()
        group.position.set(s.pos.x, s.pos.y, s.pos.z)
        group.add(mesh(tripodGeo, kit.mat))
        const gun = new THREE.Group()
        gun.position.y = 18 * C + 0.02
        group.add(gun)
        const lamp = dfVoxMaterial({ glow: 0 })
        const body = mesh(gunGeo, kit.mat)
        gun.add(body)
        // the lamp voxel draws again in its own material, just proud of the receiver
        const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(C * 1.1, C * 1.1, C * 1.1), lamp)
        lampMesh.position.set(0, 2 * C, -1.5 * C)
        gun.add(lampMesh)
        const pan = mesh(panGeo, kit.mat)
        pan.position.set(0, 2.5 * C, -0.5 * C)
        gun.add(pan)
        kit.root.add(group)
        return { id: s.id, group, gun, pan, lamp, shots: s.shots, yaw: s.yaw, pitch: 0, pop: 0, seen: true, gone: 0, smokeIn: 1, snap: s }
    }

    const makeDecoy = (d: DfDecoySnap): DecoyView => {
        const group = new THREE.Group()
        group.position.set(d.pos.x, d.pos.y, d.pos.z)
        group.rotation.y = d.yaw
        group.add(mesh(gramGeo, kit.mat))
        const record = mesh(recGeo, kit.mat, false)
        record.position.set(-0.05, 4 * C, -0.05)
        group.add(record)
        const horn = mesh(hornGeo, kit.mat)
        horn.position.set(0.12, 5 * C, 0.1)
        horn.rotation.set(0.8, 0, -0.3)
        group.add(horn)
        kit.root.add(group)
        return { id: d.id, group, record, horn, bar: 0, barIn: 0.3, pop: 0, seen: true, snap: d }
    }

    const dropSentry = (v: SentryView) => {
        v.group.removeFromParent()
        v.lamp.dispose()
        ;(v.gun.children[1] as THREE.Mesh | undefined)?.geometry.dispose()
        sentries.delete(v.id)
    }

    const muzzle = (v: SentryView, out: THREE.Vector3) => {
        v.gun.updateMatrixWorld(true)
        return v.gun.localToWorld(out.set(0, 0, 21 * C))
    }

    return {
        update(dt, world, time) {
            const ars = world.arsenal
            for (const v of sentries.values()) v.seen = false
            for (const s of ars?.sentries ?? []) {
                let v = sentries.get(s.id)
                if (!v) sentries.set(s.id, v = makeSentry(s))
                v.seen = true
                v.snap = s
            }
            for (const v of [...sentries.values()]) {
                if (!v.seen) {
                    // gone without its event (a missed snapshot): fold away
                    v.gone += dt
                    if (v.gone > 0.4) dropSentry(v)
                    continue
                }
                const s = v.snap
                v.pop = Math.min(1, v.pop + dt / 0.5)
                const k = easeOutBack(v.pop)
                v.group.scale.setScalar(Math.max(0.01, k))
                // aim: at its target's chest when it has one (smooth, ahead of the snapshot), else the server's yaw
                let wantYaw = s.yaw
                let wantPitch = 0
                if (s.tgt) {
                    const dx = s.tgt.x - s.pos.x
                    const dz = s.tgt.z - s.pos.z
                    wantYaw = Math.atan2(dx, dz)
                    wantPitch = -Math.atan2(s.tgt.y - (s.pos.y + DF_SENTRY.muzzleY), Math.hypot(dx, dz))
                } else {
                    // idle: a slow sweep around its heading
                    wantYaw = s.yaw + Math.sin(time * 0.7 + v.id) * 0.5
                }
                let dy = wantYaw - v.yaw
                while (dy > Math.PI) dy -= Math.PI * 2
                while (dy < -Math.PI) dy += Math.PI * 2
                v.yaw += dy * Math.min(1, dt * 14)
                v.pitch = damp(v.pitch, wantPitch, 12, dt)
                v.gun.rotation.set(v.pitch, v.yaw, 0, 'YXZ')
                // new shots: a tracer and a flash each (one sound per frame)
                const fresh = Math.min(4, s.shots - v.shots)
                if (fresh > 0 && s.tgt) {
                    const from = muzzle(v, tmp)
                    for (let i = 0; i < fresh; i++) {
                        tmp2.set(s.tgt.x + (Math.random() - 0.5) * 0.35, s.tgt.y + (Math.random() - 0.5) * 0.35, s.tgt.z + (Math.random() - 0.5) * 0.35)
                        ctx.fx.tracer(from, tmp2, TRACER)
                    }
                    ctx.fx.flash(from, 0xffb060, 8, 0.05)
                    ctx.fx.burst('muzzle-smoke', from, { count: 1, scale: 0.4 })
                    kit.play(DF_ARSENAL_SND.sentryShot, from, 0.9, 0.95 + Math.random() * 0.1)
                    v.pan.rotation.y += fresh * 0.35
                    v.gun.position.z = 0
                }
                if (s.shots > v.shots) v.shots = s.shots
                // the lamp: green while it has plenty, blinking red when it runs low
                const low = s.life < 8 || s.ammo < 0.15
                const blink = Math.sin(time * 12) > 0
                v.lamp.color.setRGB(low ? 1 : 0.3, low ? 0.15 : 1, low ? 0.1 : 0.35)
                v.lamp.userData.uGlow.value = low ? (blink ? 2.4 : 0.3) : 1.4
                // smoking when it's been clawed about
                if (s.hp < 0.5) {
                    v.smokeIn -= dt
                    if (v.smokeIn <= 0) {
                        v.smokeIn = 0.25 + s.hp * 0.6
                        ctx.fx.burst('smoke', tmp.set(s.pos.x, s.pos.y + 1, s.pos.z), { count: 1, scale: 0.35 })
                        if (s.hp < 0.25) ctx.fx.burst('sparks', tmp, { count: 3, scale: 0.5 })
                    }
                }
            }

            for (const v of decoys.values()) v.seen = false
            for (const d of ars?.decoys ?? []) {
                let v = decoys.get(d.id)
                if (!v) decoys.set(d.id, v = makeDecoy(d))
                v.seen = true
                v.snap = d
            }
            for (const v of [...decoys.values()]) {
                if (!v.seen) {
                    v.group.removeFromParent()
                    decoys.delete(v.id)
                    continue
                }
                v.pop = Math.min(1, v.pop + dt / 0.4)
                v.group.scale.setScalar(Math.max(0.01, easeOutBack(v.pop)))
                const fuse = v.snap.fuse
                const hurry = fuse < 2 ? 1.6 : 1
                v.record.rotation.y += dt * 4 * hurry
                v.horn.rotation.z = -0.3 + Math.sin(time * 7.5 * hurry) * 0.06
                v.horn.scale.setScalar(1 + Math.max(0, Math.sin(time * 15 * hurry)) * 0.04)
                v.barIn -= dt * hurry
                if (v.barIn <= 0 && fuse > 0.3) {
                    v.barIn = 1.26
                    kit.play(`${DF_ARSENAL_SND.waltz}-${v.bar % 4}`, v.group.position, 1, hurry)
                    v.bar++
                    ctx.fx.burst('powerup', tmp.set(v.snap.pos.x, v.snap.pos.y + 0.9, v.snap.pos.z), { count: 3, scale: 0.4 })
                }
                if (fuse < 2 && Math.sin(time * 18) > 0.7) ctx.fx.flash(tmp.set(v.snap.pos.x, v.snap.pos.y + 0.5, v.snap.pos.z), 0xff5030, 3, 0.05)
            }
        },
        onEvent(ev) {
            if (ev.k === 'deploy') {
                const p = tmp.set(ev.pos.x, ev.pos.y + 0.2, ev.pos.z)
                kit.play(ev.item === 'sentry' ? DF_ARSENAL_SND.deploy : DF_ARSENAL_SND.decoyWind, p, 1)
                ctx.fx.burst('dust', p, { count: 6, scale: 0.5 })
                return
            }
            if (ev.k === 'sentry') {
                const v = sentries.get(ev.id)
                const p = tmp.set(ev.pos.x, ev.pos.y + 1, ev.pos.z)
                if (ev.what === 'broken') {
                    kit.play(DF_ARSENAL_SND.sentryBroken, p, 1)
                    ctx.fx.burst('sparks', p, { count: 26 })
                    ctx.fx.burst('smoke', p, { count: 4, scale: 0.7 })
                    ctx.fx.flash(p, 0xffa040, 10, 0.2)
                } else {
                    kit.play(DF_ARSENAL_SND.sentrySpent, p, 1)
                    ctx.fx.burst('smoke', p, { count: 3, scale: 0.5 })
                }
                if (v) dropSentry(v)
                return
            }
            if (ev.k === 'decoy') {
                const v = decoys.get(ev.id)
                const p = tmp.set(ev.pos.x, ev.pos.y + 0.4, ev.pos.z)
                ctx.fx.burst('splinters', p, { count: 20 })
                ctx.fx.burst('powerup', p, { count: 10, color: 0xffd978 })
                if (v) {
                    v.group.removeFromParent()
                    decoys.delete(ev.id)
                }
            }
        },
        dispose() {
            for (const v of [...sentries.values()]) dropSentry(v)
            for (const v of decoys.values()) v.group.removeFromParent()
            decoys.clear()
            for (const g of geos) g.dispose()
        }
    }
}

/** Seconds a decoy plays (the HUD's countdown). */
export const DF_DECOY_SECONDS = DF_DECOY.fuse
