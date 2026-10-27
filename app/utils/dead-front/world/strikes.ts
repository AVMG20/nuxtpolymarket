import * as THREE from 'three'
import { dfPlanStrike, dfStrikeFlightStart, dfStrikeFlyer } from '#shared/utils/dead-front/support'
import type { DfStrikeId, DfStrikePlan } from '#shared/utils/dead-front/support'
import type { DfStrikeHit } from '#shared/utils/dead-front/salvage'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from '../engine/arsenal-sounds'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'

// Support, staged from the `strike` event's plan (the server
// resolves the damage; its `explode` events draw the blasts). The barrage: a
// red smoke flare on the mark and a whistle ahead of every shell. The
// Zeppelin raid: a grey airship droning over along the caller's line, its
// bombs dropping from the gondola. The bomber run: a great Gotha biplane with
// two pusher engines roars over low, its bombs whistle down in rows across
// the mark and the whole circle goes up in one rolling carpet.

const GRAVITY = 10
const WHISTLE = 1.3
const BOMBER_SPAN = 0.55
const UP = new THREE.Vector3(0, 1, 0)

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

function bomberModel(): DfVoxModel {
    // a Gotha G.V along +z (nose forward): a long slab-sided fuselage, two great wings
    // (upper and lower) with the engine nacelles and pusher props between them, a box tail,
    // iron crosses on the wings
    const m = new DfVoxModel(41, 11, 26)
    const canvas = m.shade(0x5d6150, 0.06, 104)
    const wing = m.shade(0x6c705c, 0.05, 105)
    const dark = m.c(0x2f3132)
    const metal = m.c(0x55585e)
    const cross = m.c(0x141414)
    const white = m.c(0xe8e4d6)
    // fuselage, the nose glazed gunner's pit, the tail
    m.box(18, 3, 0, 23, 7, 24, canvas)
    m.box(19, 4, 24, 22, 7, 26, dark)
    m.box(19, 7, 20, 22, 8, 23, metal)
    // wings: lower and upper, struts between them
    m.box(0, 2, 13, 41, 3, 19, wing)
    m.box(0, 8, 13, 41, 9, 19, wing)
    for (const i of [2, 10, 30, 38]) m.box(i, 3, 15, i + 1, 8, 16, metal)
    // engine nacelles and the pusher props behind them
    for (const ci of [11, 29]) {
        m.box(ci - 2, 4, 13, ci + 2, 7, 21, dark)
        m.box(ci - 3, 5, 12, ci + 3, 6, 13, metal)
        m.box(ci, 2, 12, ci + 1, 9, 13, metal)
    }
    // the tail: a tailplane and twin fins
    m.box(13, 5, 0, 28, 6, 4, wing)
    for (const i of [16, 24]) m.box(i, 6, 0, i + 1, 10, 3, wing)
    // iron crosses on the upper wing and the fins
    for (const ci of [5, 35]) {
        m.box(ci - 2, 9, 15, ci + 3, 10, 17, white)
        m.box(ci - 1, 9, 14, ci + 2, 10, 18, cross)
        m.box(ci - 2, 9, 15, ci + 3, 10, 17, cross)
        m.set(ci - 2, 9, 14, white).set(ci + 2, 9, 14, white).set(ci - 2, 9, 17, white).set(ci + 2, 9, 17, white)
    }
    // nav lamps
    m.set(0, 8, 16, m.c(0xff3020, 1.4)).set(40, 8, 16, m.c(0x30ff60, 1.4))
    return m
}

function bombModel(): DfVoxModel {
    const m = new DfVoxModel(3, 6, 3)
    m.box(0, 1, 0, 3, 5, 3, m.c(0x3b3d40))
    m.box(1, 0, 1, 2, 1, 2, m.c(0x6f7276))
    m.box(1, 5, 0, 2, 6, 3, m.c(0x6f7276))
    return m
}

interface Bomb {
    obj: THREE.Object3D
    from: THREE.Vector3
    to: THREE.Vector3
    t0: number
    t1: number
}

interface Strike {
    reward: DfStrikeId
    plan: DfStrikePlan
    hits: (DfStrikeHit & { cued?: boolean, struck?: boolean, boomed?: boolean })[]
    at: THREE.Vector3
    age: number
    flyer: THREE.Object3D | null
    bombs: Bomb[]
    smokeIn: number
    engine: boolean
}

export function createDfStrikes(kit: DfWorldKit): DfWorldPart {
    const { ctx } = kit
    registerDfArsenalSounds(ctx.audio)
    const zepGeo = zeppelinModel().mesh(0.42, [5, 0, 22])!
    const bomberGeo = bomberModel().mesh(BOMBER_SPAN, [20.5, 5, 13])!
    const bombGeo = bombModel().mesh(0.1, [1.5, 3, 1.5])!
    const strikes: Strike[] = []
    /** Falling bombs are pooled: a carpet drops a dozen at once. */
    const bombPool: Bomb[] = []
    const takeBomb = (): Bomb => bombPool.pop() ?? { obj: new THREE.Mesh(bombGeo, kit.mat), from: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, t1: 0 }
    const releaseBomb = (b: Bomb) => {
        b.obj.removeFromParent()
        bombPool.push(b)
    }
    const tmp = new THREE.Vector3()
    const tmp2 = new THREE.Vector3()

    /** Seconds a bomb falls from the flyer. */
    const fallTime = (id: 'zeppelin' | 'bomber') => Math.sqrt((2 * (dfStrikeFlyer(id).altitude - 2)) / GRAVITY)

    /** Where the flyer is `t` seconds after the call-in: over each bomb's mark as it lets go (they fall straight down). */
    const flyerAt = (s: Strike, t: number, out: THREE.Vector3): THREE.Vector3 => {
        const p = s.plan
        const id = s.reward === 'bomber' ? 'bomber' : 'zeppelin'
        const total = Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z)
        const lead = fallTime(id)
        const u = ((t - dfStrikeFlightStart(p) + lead) * dfStrikeFlyer(id).speed) / Math.max(1, total)
        out.set(p.from.x + (p.to.x - p.from.x) * u, p.from.y, p.from.z + (p.to.z - p.from.z) * u)
        return out
    }

    const dropFlyer = (s: Strike) => {
        if (s.flyer) s.flyer.removeFromParent()
        s.flyer = null
        for (const b of s.bombs) releaseBomb(b)
        s.bombs.length = 0
    }

    /** The bomber's carpet: the whole circle goes up at once. */
    const carpet = (s: Strike, h: DfStrikeHit) => {
        ctx.fx.shake(0.75)
        kit.play(DF_ARSENAL_SND.carpet, tmp.set(h.x, h.y + 1, h.z), 1)
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4
            const r = h.r * (0.35 + Math.random() * 0.6)
            tmp.set(h.x + Math.cos(a) * r, h.y + 0.4, h.z + Math.sin(a) * r)
            ctx.fx.burst('explosion', tmp, { scale: 1.4 + Math.random() * 0.6 })
            ctx.fx.burst('dust', tmp, { scale: 1.6 })
            ctx.fx.decal(tmp.set(tmp.x, h.y + 0.02, tmp.z), UP, 'scorch', 1.4)
        }
        ctx.fx.burst('explosion', tmp.set(h.x, h.y + 0.5, h.z), { scale: 3 })
        ctx.fx.burst('smoke', tmp, { count: 10, scale: 2.4 })
        ctx.fx.flash(tmp.set(h.x, h.y + 3, h.z), 0xffc070, 70, 0.7)
    }

    return {
        update(dt) {
            for (let si = strikes.length - 1; si >= 0; si--) {
                const s = strikes[si]!
                s.age += dt
                const t = s.age
                // the marker flare: red smoke curling up from the mark
                if (s.reward !== 'zeppelin' && t < s.plan.duration) {
                    s.smokeIn -= dt
                    if (s.smokeIn <= 0) {
                        s.smokeIn = 0.12
                        ctx.fx.burst('smoke', tmp.set(s.at.x, s.at.y + 0.3, s.at.z), { count: 1, color: 0xc0302a, scale: 0.7 })
                        if (Math.random() < 0.3) ctx.fx.flash(tmp, 0xff3020, 2.5, 0.12)
                    }
                }
                for (const h of s.hits) {
                    // whistles lead each shell and bomb down
                    if (!h.cued && !h.all && t >= h.t - WHISTLE) {
                        h.cued = true
                        kit.play(DF_ARSENAL_SND.whistle, tmp.set(h.x, h.y + 6, h.z), s.reward === 'barrage' ? 1 : 0.7, 0.92 + Math.random() * 0.16)
                    }
                    if (h.all && !h.boomed && t >= h.t) {
                        h.boomed = true
                        carpet(s, h)
                    }
                }
                if (s.flyer) {
                    const pos = flyerAt(s, t, tmp)
                    const ahead = flyerAt(s, t + 0.1, tmp2)
                    s.flyer.position.copy(pos)
                    s.flyer.lookAt(ahead)
                    if (s.reward === 'bomber') s.flyer.rotateZ(Math.sin(t * 0.9) * 0.05)
                    // bombs leave the flyer above their mark and fall
                    const id = s.reward === 'bomber' ? 'bomber' : 'zeppelin'
                    const fall = fallTime(id)
                    for (const h of s.hits) {
                        if (h.struck || h.all || t < h.t - fall) continue
                        h.struck = true
                        const b = takeBomb()
                        b.obj.scale.setScalar(s.reward === 'bomber' ? 1.6 : 1)
                        b.from.set(h.x, s.plan.from.y - 2, h.z)
                        b.to.set(h.x, h.y, h.z)
                        b.t0 = t
                        b.t1 = h.t
                        b.obj.position.copy(b.from)
                        kit.root.add(b.obj)
                        s.bombs.push(b)
                    }
                    for (let bi = s.bombs.length - 1; bi >= 0; bi--) {
                        const b = s.bombs[bi]!
                        const k = Math.min(1, (t - b.t0) / Math.max(0.05, b.t1 - b.t0))
                        b.obj.position.lerpVectors(b.from, b.to, k * k)
                        b.obj.rotation.x = Math.sin(t * 9 + b.from.x) * 0.15
                        if (k >= 1) {
                            releaseBomb(b)
                            s.bombs.splice(bi, 1)
                        }
                    }
                    if (!s.engine && t >= dfStrikeFlightStart(s.plan) - 1) {
                        s.engine = true
                        kit.play(s.reward === 'zeppelin' ? DF_ARSENAL_SND.zeppelin : DF_ARSENAL_SND.bomber, s.at, 1)
                    }
                }
                if (t > s.plan.duration + 1) {
                    dropFlyer(s)
                    strikes.splice(si, 1)
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
            if (ev.reward !== 'barrage') {
                const o = new THREE.Mesh(ev.reward === 'zeppelin' ? zepGeo : bomberGeo, kit.mat)
                o.castShadow = false
                kit.root.add(o)
                s.flyer = o
                flyerAt(s, 0, o.position)
            }
            if (ev.reward !== 'zeppelin') ctx.fx.burst('embers', s.at, { count: 10, color: 0xff4020 })
            strikes.push(s)
        },
        dispose() {
            for (const s of strikes) dropFlyer(s)
            strikes.length = 0
            zepGeo.dispose()
            bomberGeo.dispose()
            bombGeo.dispose()
        }
    }
}
