import * as THREE from 'three'
import { DF_STRIKE, dfPlanStrike, dfStrikeFlightStart } from '#shared/utils/dead-front/killstreaks'
import type { DfRewardId, DfStrikePlan } from '#shared/utils/dead-front/killstreaks'
import type { DfStrikeHit } from '#shared/utils/dead-front/salvage'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from '../engine/arsenal-sounds'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'

// Killstreak support, staged from the `strike` event's plan (the server
// resolves the damage; its `explode` events draw the blasts). The barrage: a
// red smoke flare on the mark and a whistle ahead of every shell. The
// Zeppelin raid: a grey airship droning over along the caller's line, its
// bombs dropping from the gondola. The strafing run: a Sopwith diving along
// the line, its Vickers raking the ground with tracers and dust.

const GRAVITY = 10
const WHISTLE = 1.3

function zeppelinModel(): DfVoxModel {
    // 44 x 10 x 10: a cigar hull with ribs, cruciform tail fins, a gondola under the front
    const m = new DfVoxModel(10, 12, 44)
    const hull = m.shade(0x8a8d90, 0.05, 101)
    const rib = m.c(0x6f7276)
    const dark = m.c(0x3b3d40)
    for (let k = 0; k < 44; k++) {
        const u = k / 43
        const r = 4.6 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.45) / 0.56, 2)))
        for (let i = 0; i < 10; i++) {
            for (let j = 2; j < 12; j++) {
                const d = Math.hypot(i - 4.5, j - 6.5)
                if (d <= r) m.set(i, j, k, k % 6 === 0 ? rib : hull(i, j, k))
            }
        }
    }
    // tail fins (at the back, k small)
    m.box(4, 0, 0, 6, 12, 5, dark)
    m.box(0, 6, 0, 10, 7, 5, dark)
    // the gondola and its struts, under the front third
    m.box(3, 0, 26, 7, 2, 33, dark)
    m.box(4, 2, 28, 6, 3, 31, rib)
    // nav lamps: red port, green starboard
    m.set(0, 6, 22, m.c(0xff3020, 1.4)).set(9, 6, 22, m.c(0x30ff60, 1.4))
    return m
}

function planeModel(): DfVoxModel {
    // a Sopwith Camel along +z: fuselage, two wings with roundels, tail, the engine cowl
    const m = new DfVoxModel(17, 7, 14)
    const canvas = m.shade(0x6d6a3a, 0.06, 102)
    const wing = m.shade(0x7a7646, 0.05, 103)
    const metal = m.c(0x55585e)
    m.box(7, 2, 0, 10, 4, 12, canvas)
    m.box(7, 2, 12, 10, 5, 14, metal)
    m.box(0, 1, 8, 17, 2, 11, wing)
    m.box(0, 5, 8, 17, 6, 11, wing)
    for (const i of [2, 14]) m.box(i, 2, 9, i + 1, 5, 10, metal)
    m.box(5, 3, 0, 12, 4, 2, wing)
    m.box(8, 4, 0, 9, 6, 2, wing)
    // roundels: blue, white, red rings on the upper wing
    for (const ci of [3, 13]) {
        m.box(ci - 1, 6, 8, ci + 2, 7, 11, m.c(0x2a3f8f))
        m.set(ci, 6, 9, m.c(0xe8e4d6)).set(ci, 6, 10, m.c(0xc8302a))
    }
    return m
}

function bombModel(): DfVoxModel {
    const m = new DfVoxModel(3, 6, 3)
    m.box(0, 1, 0, 3, 5, 3, m.c(0x3b3d40))
    m.box(1, 0, 1, 2, 1, 2, m.c(0x6f7276))
    m.box(1, 5, 0, 2, 6, 3, m.c(0x6f7276))
    return m
}

interface Strike {
    reward: DfRewardId
    plan: DfStrikePlan
    hits: (DfStrikeHit & { cued?: boolean, struck?: boolean })[]
    at: THREE.Vector3
    age: number
    flyer: THREE.Object3D | null
    bombs: { obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, t0: number, t1: number }[]
    smokeIn: number
    engine: boolean
}

export function createDfStrikes(kit: DfWorldKit): DfWorldPart {
    const { ctx } = kit
    registerDfArsenalSounds(ctx.audio)
    const zepGeo = zeppelinModel().mesh(0.42, [5, 0, 22])!
    const planeGeo = planeModel().mesh(0.32, [8.5, 3, 7])!
    const bombGeo = bombModel().mesh(0.1, [1.5, 3, 1.5])!
    const strikes: Strike[] = []
    const tmp = new THREE.Vector3()
    const tmp2 = new THREE.Vector3()

    /** Where the flyer is `t` seconds after the call-in (a straight line, the strafe dipping over the zone). */
    const flyerAt = (s: Strike, t: number, out: THREE.Vector3): THREE.Vector3 => {
        const p = s.plan
        const total = Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z)
        const speed = s.reward === 'zeppelin' ? DF_STRIKE.zeppelin.speed : DF_STRIKE.strafe.speed
        // the Zeppelin is over each bomb's mark as it lets go (they fall straight down)
        const lead = s.reward === 'zeppelin' ? Math.sqrt((2 * DF_STRIKE.zeppelin.altitude) / GRAVITY) : 0
        const u = ((t - dfStrikeFlightStart(p) + lead) * speed) / Math.max(1, total)
        out.set(p.from.x + (p.to.x - p.from.x) * u, p.from.y, p.from.z + (p.to.z - p.from.z) * u)
        if (s.reward === 'strafe') {
            // dive in over the zone, climb away after
            const mid = Math.abs(u - 0.5) * 2
            out.y = s.at.y + 7 + Math.pow(Math.min(1, mid), 1.6) * (DF_STRIKE.strafe.altitude + 10)
        }
        return out
    }

    const dropFlyer = (s: Strike) => {
        if (s.flyer) s.flyer.removeFromParent()
        s.flyer = null
        for (const b of s.bombs) b.obj.removeFromParent()
        s.bombs.length = 0
    }

    return {
        update(dt) {
            for (const s of [...strikes]) {
                s.age += dt
                const t = s.age
                // the barrage's marker flare: red smoke curling up from the mark
                if (s.reward === 'barrage' && t < s.plan.duration) {
                    s.smokeIn -= dt
                    if (s.smokeIn <= 0) {
                        s.smokeIn = 0.12
                        ctx.fx.burst('smoke', tmp.set(s.at.x, s.at.y + 0.3, s.at.z), { count: 1, color: 0xc0302a, scale: 0.7 })
                        if (Math.random() < 0.3) ctx.fx.flash(tmp, 0xff3020, 2.5, 0.12)
                    }
                }
                for (const h of s.hits) {
                    // whistles lead each shell and bomb down
                    if (!h.cued && s.reward !== 'strafe' && t >= h.t - WHISTLE) {
                        h.cued = true
                        kit.play(DF_ARSENAL_SND.whistle, tmp.set(h.x, h.y + 6, h.z), s.reward === 'zeppelin' ? 0.7 : 1, 0.92 + Math.random() * 0.16)
                    }
                    if (s.reward === 'strafe' && !h.struck && t >= h.t) {
                        // the Vickers: tracers from the plane, dust and sparks where they land
                        h.struck = true
                        const from = flyerAt(s, t, tmp)
                        tmp2.set(h.x + (Math.random() - 0.5) * 1.2, h.y + 0.05, h.z + (Math.random() - 0.5) * 1.2)
                        ctx.fx.tracer(from, tmp2, 0xffd28a)
                        tmp2.set(h.x + (Math.random() - 0.5) * 1.2, h.y + 0.05, h.z + (Math.random() - 0.5) * 1.2)
                        ctx.fx.tracer(from, tmp2, 0xffd28a)
                        ctx.fx.burst('dust', tmp2, { count: 4, scale: 0.6 })
                        if (Math.random() < 0.4) ctx.fx.burst('sparks', tmp2, { count: 4 })
                    }
                }
                if (s.flyer) {
                    const pos = flyerAt(s, t, tmp)
                    const ahead = flyerAt(s, t + 0.1, tmp2)
                    s.flyer.position.copy(pos)
                    s.flyer.lookAt(ahead)
                    if (s.reward === 'strafe') s.flyer.rotateZ(Math.sin(t * 2) * 0.25)
                    // bombs leave the gondola above their mark and fall
                    if (s.reward === 'zeppelin') {
                        const fall = Math.sqrt((2 * (DF_STRIKE.zeppelin.altitude - 2)) / GRAVITY)
                        for (const h of s.hits) {
                            if (h.struck || t < h.t - fall) continue
                            h.struck = true
                            const obj = new THREE.Mesh(bombGeo, kit.mat)
                            const from = new THREE.Vector3(h.x, s.plan.from.y - 2, h.z)
                            obj.position.copy(from)
                            kit.root.add(obj)
                            s.bombs.push({ obj, from, to: new THREE.Vector3(h.x, h.y, h.z), t0: t, t1: h.t })
                        }
                        for (const b of [...s.bombs]) {
                            const k = Math.min(1, (t - b.t0) / Math.max(0.05, b.t1 - b.t0))
                            b.obj.position.lerpVectors(b.from, b.to, k * k)
                            b.obj.rotation.x = Math.sin(t * 9 + b.from.x) * 0.15
                            if (k >= 1) {
                                b.obj.removeFromParent()
                                s.bombs.splice(s.bombs.indexOf(b), 1)
                            }
                        }
                    }
                    if (!s.engine && t >= dfStrikeFlightStart(s.plan) - 0.8) {
                        s.engine = true
                        kit.play(s.reward === 'zeppelin' ? DF_ARSENAL_SND.zeppelin : DF_ARSENAL_SND.plane, s.at, 1)
                    }
                    if (s.reward === 'strafe' && s.hits.some(h => Math.abs(h.t - t) < dt * 0.5 + 0.001) && Math.random() < 0.35) kit.play(DF_ARSENAL_SND.planeGuns, s.at, 0.9)
                }
                if (t > s.plan.duration + 1) {
                    dropFlyer(s)
                    strikes.splice(strikes.indexOf(s), 1)
                }
            }
        },
        onEvent(ev) {
            if (ev.k !== 'strike') return
            const plan = dfPlanStrike(ev.reward, ev.at, ev.dir, () => 0.5)
            const s: Strike = {
                reward: ev.reward,
                plan,
                hits: ev.hits.map(h => ({ ...h })),
                at: new THREE.Vector3(ev.at.x, ev.at.y, ev.at.z),
                age: 0,
                flyer: null,
                bombs: [],
                smokeIn: 0,
                engine: false
            }
            if (ev.reward === 'zeppelin' || ev.reward === 'strafe') {
                const o = new THREE.Mesh(ev.reward === 'zeppelin' ? zepGeo : planeGeo, kit.mat)
                o.castShadow = false
                kit.root.add(o)
                s.flyer = o
                flyerAt(s, 0, o.position)
            }
            if (ev.reward === 'barrage') ctx.fx.burst('embers', s.at, { count: 10, color: 0xff4020 })
            strikes.push(s)
        },
        dispose() {
            for (const s of strikes) dropFlyer(s)
            strikes.length = 0
            zepGeo.dispose()
            planeGeo.dispose()
            bombGeo.dispose()
        }
    }
}
