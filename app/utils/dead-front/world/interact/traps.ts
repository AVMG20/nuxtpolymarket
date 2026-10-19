import * as THREE from 'three'
import type { DfTrapSnap } from '#shared/utils/dead-front/protocol'
import { dfRaycast } from '#shared/utils/dead-front/physics'
import { dfInTrap } from '#shared/utils/dead-front/specials'
import type { DfTrap, DfTrapPhase } from '#shared/utils/dead-front/specials'
import { DF_SPECIAL_SND } from '../../engine/specials-sounds'
import { dfVoxMaterial } from '../../voxel/material'
import type { DfVoxMaterial } from '../../voxel/material'
import { DfVoxModel } from '../../voxel/model'
import type { DfWorldKit, DfWorldPart } from '../kit'
import { DF_WORLD_SOUNDS } from '../sound-names'
import { DfSpring, damp } from '../util'

// The electric traps across the two gateways (map.traps). Beside each passage
// a slate switch panel hangs on the wall under a hazard plate, with a knife
// switch and a status lamp on top (dark without power, green when ready, red
// while it cools down, flashing white-blue while it runs). Porcelain-and-copper
// coils sit on the wall faces either side of the opening, joined by a live wire
// strung over the passage. Bought, the switch slams up, the wire glows and arcs
// leap between the coils for the whole run; a zombie caught in it is struck by
// a bolt from the nearest coil.

const C = 0.0625
const BLUE = 0x9fd0ff
/** Height of the wire strung over the passage. */
const WIRE_Y = 2.6
/** Switch angles: blade up in the jaws (live) and hanging out and down (off). */
const LEVER_ON = 0.05
const LEVER_OFF = 2.45

interface Coil {
    /** The arc terminal (centre of the winding). */
    at: THREE.Vector3
}

interface Trap {
    def: DfTrap
    lever: THREE.Group
    spring: DfSpring
    jaws: THREE.Vector3
    lamp: DfVoxMaterial
    wire: DfVoxMaterial
    coils: Coil[][]
    centre: THREE.Vector3
    /** What is shown (follows events first, the snapshot after a moment). */
    state: DfTrapPhase
    mismatch: number
    /** 0..1 how live the coils look (eases to the state). */
    live: number
    nextArc: number
    nextHum: number
    /** Seconds of the green "ready" blink after a cooldown ends. */
    ready: number
}

function panelModel(): DfVoxModel {
    // A slate board in an iron frame, a striped hazard plate on top, porcelain jaws and a brass hinge.
    const m = new DfVoxModel(10, 16, 3)
    const iron = m.shade(0x2b2c2f, 0.06, 51)
    const slate = m.shade(0x30343a, 0.05, 52)
    const porcelain = m.c(0xe6e0d2, 0.15)
    const brass = m.c(0xa58236)
    const yellow = m.c(0xc9a227)
    const black = m.c(0x1b1b1d)
    m.box(0, 0, 0, 10, 16, 1, iron)
    m.box(1, 1, 1, 9, 13, 2, slate)
    m.box(0, 0, 1, 10, 1, 2, iron).box(0, 0, 1, 1, 13, 2, iron).box(9, 0, 1, 10, 13, 2, iron)
    m.box(0, 13, 1, 10, 16, 2, (i, j) => ((i + j) % 4 < 2 ? yellow : black))
    m.box(3, 10, 2, 4, 13, 3, porcelain).box(6, 10, 2, 7, 13, 3, porcelain)
    m.box(3, 2, 2, 7, 3, 3, brass)
    // A brass name plate and the rivets of the frame.
    m.box(3, 5, 2, 7, 6, 3, brass)
    for (const [i, j] of [[0, 0], [9, 0], [0, 12], [9, 12]] as const) m.set(i, j, 2, iron(i, j, 2))
    return m
}

function bladeModel(): DfVoxModel {
    // The copper knife blade and a red insulated crossbar grip, pivoting at the bottom.
    const m = new DfVoxModel(6, 11, 2)
    m.box(2, 0, 0, 4, 9, 1, m.c(0x9a5a2c))
    m.box(1, 9, 0, 5, 11, 2, m.c(0x6a1a12))
    m.box(0, 9, 0, 1, 11, 2, m.c(0x1d1d1f)).box(5, 9, 0, 6, 11, 2, m.c(0x1d1d1f))
    return m
}

function lampModel(): DfVoxModel {
    // A caged signal lamp: white glass (tinted by its material) in an iron cage.
    const m = new DfVoxModel(4, 4, 4)
    const iron = m.c(0x26262a)
    m.box(0, 0, 0, 4, 1, 4, iron)
    m.box(1, 1, 1, 3, 4, 3, m.c(0xffffff, 1))
    for (const [i, k] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) m.box(i, 1, k, i + 1, 4, k + 1, iron)
    return m
}

function coilModel(): DfVoxModel {
    // A wall bracket holding a porcelain insulator stack, copper windings and a glass terminal.
    const m = new DfVoxModel(7, 16, 7)
    const iron = m.c(0x2c2d30)
    const porcelain = m.c(0xe6e0d2, 0.15)
    const porcelainDark = m.c(0xbdb6a6)
    const copper = m.c(0xb06a32)
    const copperDark = m.c(0x7a4520)
    m.box(2, 0, 0, 5, 16, 1, iron)
    m.box(3, 1, 1, 4, 2, 4, iron)
    m.box(2, 2, 2, 5, 5, 5, porcelainDark)
    m.box(1, 2, 1, 6, 3, 6, porcelain).box(1, 4, 1, 6, 5, 6, porcelain)
    for (let j = 5; j < 12; j++) {
        if (j % 2 === 1) m.box(1, j, 1, 6, j + 1, 6, copper)
        else m.box(2, j, 2, 5, j + 1, 5, copperDark)
    }
    return m
}

function terminalModel(): DfVoxModel {
    // The glass ball on top of a coil (glows with the wire's material).
    const m = new DfVoxModel(3, 3, 3)
    m.box(0, 0, 0, 3, 3, 3, m.c(0xffffff, 1))
    m.set(0, 0, 0, 0).set(2, 0, 0, 0).set(0, 0, 2, 0).set(2, 0, 2, 0).set(0, 2, 0, 0).set(2, 2, 0, 0).set(0, 2, 2, 0).set(2, 2, 2, 0)
    return m
}

function unitModel(color: number, glow: number): DfVoxModel {
    const m = new DfVoxModel(1, 1, 1)
    m.box(0, 0, 0, 1, 1, 1, m.c(color, glow))
    return m
}

/** Snapshot state of a trap ('idle' when the snapshot has none). */
function snapOf(list: DfTrapSnap[] | undefined, id: string): DfTrapSnap | null {
    if (!list) return null
    for (const t of list) if (t.id === id) return t
    return null
}

export function createDfTraps(kit: DfWorldKit): DfWorldPart {
    const { map, ctx } = kit
    const defs = map.traps ?? []
    const shadow = kit.shadows
    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const objs: THREE.Object3D[] = []
    const panelGeo = panelModel().mesh(C, [5, 0, 0])!
    const bladeGeo = bladeModel().mesh(C, [3, 0.5, 0])!
    const lampGeo = lampModel().mesh(C, [2, 0, 2])!
    const coilGeo = coilModel().mesh(C, [3.5, 8.5, 0])!
    const termGeo = terminalModel().mesh(C, [1.5, 0, 1.5])!
    const wireGeo = unitModel(0xffffff, 1).mesh(1, [0.5, 0.5, 0.5])!
    const pipeGeo = unitModel(0x2a2a2d, 0).mesh(1, [0.5, 0.5, 0.5])!
    geos.push(panelGeo, bladeGeo, lampGeo, coilGeo, termGeo, wireGeo, pipeGeo)

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, castShadow = shadow) => {
        const o = new THREE.Mesh(geo, mat)
        o.castShadow = castShadow
        o.receiveShadow = shadow
        return o
    }
    /** A straight bar between two points (wire or conduit), `t` thick. */
    const bar = (geo: THREE.BufferGeometry, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, t: number) => {
        const o = mesh(geo, mat, false)
        o.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
        o.scale.set(Math.max(t, Math.abs(b.x - a.x) + t), Math.max(t, Math.abs(b.y - a.y) + t), Math.max(t, Math.abs(b.z - a.z) + t))
        kit.root.add(o)
        objs.push(o)
        return o
    }

    const traps: Trap[] = defs.map((def) => {
        const fx = Math.sin(def.lever.yaw)
        const fz = Math.cos(def.lever.yaw)
        const lamp = dfVoxMaterial({ glow: 0 })
        const wire = dfVoxMaterial({ glow: 0 })
        mats.push(lamp, wire)

        // The switch panel on the wall.
        const g = new THREE.Group()
        g.position.set(def.lever.pos.x, def.lever.pos.y, def.lever.pos.z)
        g.rotation.y = def.lever.yaw
        kit.root.add(g)
        objs.push(g)
        const panelY = 0.9
        const panel = mesh(panelGeo, kit.mat)
        panel.position.y = panelY
        g.add(panel)
        const lever = new THREE.Group()
        lever.position.set(0, panelY + 2.5 * C, 2.5 * C)
        lever.rotation.x = LEVER_OFF
        g.add(lever)
        lever.add(mesh(bladeGeo, kit.mat))
        const lampMesh = mesh(lampGeo, lamp, false)
        lampMesh.position.set(0, panelY + 16 * C, 2 * C)
        g.add(lampMesh)
        g.updateMatrixWorld(true)
        const jaws = g.localToWorld(new THREE.Vector3(0, panelY + 11.5 * C, 3 * C))

        // Coils on the wall faces either side of the opening, each with a wire riser.
        const coils: Coil[][] = def.coils.map(pair => pair.map((p) => {
            // Mount on the closest wall face (fallback: face across the passage).
            let best: { x: number, z: number, d: number } | null = null
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const hit = dfRaycast(kit.collision, { x: p.x, y: p.y, z: p.z }, { x: dx, y: 0, z: dz }, 0.6)
                if (hit && (!best || hit.dist < best.d)) best = { x: dx, z: dz, d: hit.dist }
            }
            const nx = best ? -best.x : 0
            const nz = best ? -best.z : 1
            const wallX = p.x - nx * (best?.d ?? 0)
            const wallZ = p.z - nz * (best?.d ?? 0)
            const cg = new THREE.Group()
            cg.position.set(wallX, p.y, wallZ)
            cg.rotation.y = Math.atan2(nx, nz)
            kit.root.add(cg)
            objs.push(cg)
            cg.add(mesh(coilGeo, kit.mat))
            const term = mesh(termGeo, wire, false)
            term.position.set(0, 3.5 * C, 3.5 * C)
            cg.add(term)
            cg.updateMatrixWorld(true)
            const at = cg.localToWorld(new THREE.Vector3(0, 0, 3.5 * C))
            // The riser: from the terminal up the wall to the span over the passage.
            const top = cg.localToWorld(new THREE.Vector3(0, 6.5 * C, 3.5 * C))
            bar(wireGeo, wire, top, new THREE.Vector3(top.x, WIRE_Y, top.z), 0.045)
            return { at }
        }))
        // The span over the passage, one per coil pair.
        for (const pair of coils) {
            if (pair.length < 2) continue
            const a = pair[0]!.at
            const b = pair[1]!.at
            bar(wireGeo, wire, new THREE.Vector3(a.x, WIRE_Y, a.z), new THREE.Vector3(b.x, WIRE_Y, b.z), 0.045)
        }
        // Iron conduit from the panel up the wall and along to the nearest coil's riser.
        const near = coils.flat().sort((a, b) => Math.hypot(a.at.x - def.lever.pos.x, a.at.z - def.lever.pos.z) - Math.hypot(b.at.x - def.lever.pos.x, b.at.z - def.lever.pos.z))[0]
        if (near) {
            // Out of the panel's top corner on the coil's side (clear of the lamp), up, then along the wall.
            const alongX = Math.abs(fz) > Math.abs(fx)
            const side = alongX ? Math.sign(near.at.x - def.lever.pos.x) || 1 : Math.sign(near.at.z - def.lever.pos.z) || 1
            const off = 0.05
            const p0 = new THREE.Vector3(def.lever.pos.x + fx * off + (alongX ? side * 0.22 : 0), panelY + 16 * C, def.lever.pos.z + fz * off + (alongX ? 0 : side * 0.22))
            const p1 = new THREE.Vector3(p0.x, WIRE_Y, p0.z)
            const p2 = alongX ? new THREE.Vector3(near.at.x, WIRE_Y, p0.z) : new THREE.Vector3(p0.x, WIRE_Y, near.at.z)
            const p3 = new THREE.Vector3(near.at.x, WIRE_Y, near.at.z)
            bar(pipeGeo, kit.mat, p0, p1, 0.06)
            bar(pipeGeo, kit.mat, p1, p2, 0.06)
            if (p2.distanceTo(p3) > 0.05) bar(pipeGeo, kit.mat, p2, p3, 0.06)
        }
        const a = def.area
        return {
            def, lever, spring: new DfSpring(150, 12), jaws, lamp, wire, coils,
            centre: new THREE.Vector3((a.min.x + a.max.x) / 2, 1.2, (a.min.z + a.max.z) / 2),
            state: 'idle', mismatch: 0, live: 0, nextArc: 0, nextHum: 0, ready: 0
        }
    })

    const tmpA = new THREE.Vector3()
    const tmpB = new THREE.Vector3()

    /** Switches the shown state; `loud` plays the transition (events and live snapshot changes). */
    const show = (t: Trap, state: DfTrapPhase, loud: boolean) => {
        if (t.state === state) return
        const was = t.state
        t.state = state
        if (state === 'active') {
            t.spring.kick(-16)
            t.nextArc = 0.15
            t.nextHum = 0.6
            if (!loud) return
            kit.play(DF_SPECIAL_SND.trapStart, t.jaws, 1)
            ctx.fx.burst('sparks', t.jaws, { count: 20 })
            ctx.fx.burst('electric', t.jaws, { count: 10 })
            ctx.fx.flash(t.jaws, BLUE, 8, 0.3)
            for (const pair of t.coils) for (const c of pair) ctx.fx.burst('electric', c.at, { count: 8 })
        } else if (was === 'active') {
            t.spring.kick(12)
            if (!loud) return
            kit.play(DF_SPECIAL_SND.trapOff, t.centre, 1)
            for (const pair of t.coils) {
                for (const c of pair) {
                    ctx.fx.burst('electric', c.at, { count: 5, scale: 0.6 })
                    ctx.fx.burst('smoke', c.at, { count: 2, scale: 0.4 })
                }
            }
        } else if (state === 'idle' && was === 'cooldown') {
            t.ready = 1.2
            if (loud) kit.play(DF_SPECIAL_SND.trapReady, t.jaws, 1)
        }
    }

    const nearestCoil = (t: Trap, p: THREE.Vector3): THREE.Vector3 | null => {
        let best: THREE.Vector3 | null = null
        let bd = Infinity
        for (const pair of t.coils) {
            for (const c of pair) {
                const d = c.at.distanceToSquared(p)
                if (d < bd) {
                    bd = d
                    best = c.at
                }
            }
        }
        return best
    }

    return {
        update(dt, world, time) {
            const power = world.power
            for (const t of traps) {
                const snap = snapOf(world.traps, t.def.id)
                const want: DfTrapPhase = snap?.state ?? 'idle'
                // The buy event leads (the snapshot runs a little behind); run-out and
                // cooled-down only come from the snapshot, and anything else it says
                // (joining mid-run, a missed event) is taken quietly after a moment.
                if (want !== t.state) {
                    t.mismatch += dt
                    const next = (t.state === 'active' && want === 'cooldown') || (t.state === 'cooldown' && want === 'idle')
                    if (next) show(t, want, true)
                    else if (t.mismatch > 0.6) show(t, want, false)
                } else {
                    t.mismatch = 0
                }
                const on = t.state === 'active'
                t.live = damp(t.live, on ? 1 : 0, on ? 8 : 2.5, dt)
                t.ready = Math.max(0, t.ready - dt)
                t.lever.rotation.x = (on ? LEVER_ON : LEVER_OFF) + t.spring.update(dt, 0) * 0.08

                // The wire: dull copper, glowing blue-white and stuttering while live.
                const stutter = on ? 0.75 + 0.25 * Math.sin(time * 53 + t.centre.x) * Math.sin(time * 31) : 1
                const lv = t.live * stutter
                t.wire.color.setRGB(0.55 + lv * 0.2, 0.36 + lv * 0.5, 0.22 + lv * 0.78)
                t.wire.userData.uGlow.value = lv * 2.6

                // The lamp: dark without power, green ready, red cooling down, flashing while live.
                if (!power && !on) {
                    t.lamp.color.setRGB(0.25, 0.25, 0.25)
                    t.lamp.userData.uGlow.value = 0
                } else if (on) {
                    const blink = Math.sin(time * 14) > 0 ? 1 : 0.25
                    t.lamp.color.setRGB(0.75, 0.9, 1)
                    t.lamp.userData.uGlow.value = 2.4 * blink
                } else if (t.state === 'cooldown') {
                    t.lamp.color.setRGB(1, 0.12, 0.08)
                    t.lamp.userData.uGlow.value = 1.3 + 0.3 * Math.sin(time * 2)
                } else {
                    const blink = t.ready > 0 ? (Math.sin(time * 20) > 0 ? 2.6 : 0.6) : 1.4 + 0.25 * Math.sin(time * 2.4 + t.centre.x)
                    t.lamp.color.setRGB(0.25, 1, 0.3)
                    t.lamp.userData.uGlow.value = blink
                }

                if (!on) continue
                // Arcs leap between the coils across the passage, now and then one to the floor.
                t.nextArc -= dt
                if (t.nextArc <= 0) {
                    t.nextArc = 0.18 + Math.random() * 0.22
                    const pair = t.coils[Math.floor(Math.random() * t.coils.length)]
                    if (pair && pair.length >= 2) {
                        const a = pair[0]!.at
                        const b = pair[1]!.at
                        if (Math.random() < 0.75) {
                            ctx.fx.lightning(tmpA.set(a.x, a.y + (Math.random() - 0.5) * 0.2, a.z), tmpB.set(b.x, b.y + (Math.random() - 0.5) * 0.2, b.z), BLUE)
                        } else {
                            const k = 0.2 + Math.random() * 0.6
                            tmpA.set(a.x + (b.x - a.x) * k, WIRE_Y, a.z + (b.z - a.z) * k)
                            const ar = t.def.area
                            tmpB.set(ar.min.x + Math.random() * (ar.max.x - ar.min.x), ar.min.y + 0.05, ar.min.z + Math.random() * (ar.max.z - ar.min.z))
                            ctx.fx.lightning(tmpA, tmpB, 0xcfe8ff)
                            ctx.fx.burst('sparks', tmpB, { count: 6 })
                        }
                        if (Math.random() < 0.3) kit.play(DF_WORLD_SOUNDS.zap, a, 0.45, 0.9 + Math.random() * 0.3)
                    }
                }
                t.nextHum -= dt
                if (t.nextHum <= 0) {
                    t.nextHum = 1
                    kit.play(DF_SPECIAL_SND.trapHum, t.centre, 0.85)
                }
            }
        },
        onEvent(ev) {
            if (ev.k === 'buy' && ev.what.startsWith('trap:')) {
                const t = traps.find(x => x.def.id === ev.what.slice(5))
                if (t) show(t, 'active', true)
                return
            }
            if (ev.k === 'kill' && ev.weapon === 'trap') {
                // The trap that got it: the one whose area holds the body, else the nearest live one.
                const p = ev.pos
                const t = traps.find(x => dfInTrap(x.def.area, p))
                    ?? traps.filter(x => x.state === 'active').sort((a, b) => a.centre.distanceToSquared(tmpA.set(p.x, p.y, p.z)) - b.centre.distanceToSquared(tmpA))[0]
                tmpB.set(p.x, p.y + 1, p.z)
                const from = t ? nearestCoil(t, tmpB) : null
                if (from) ctx.fx.lightning(from, tmpB, 0xe8f4ff)
                ctx.fx.burst('electric', tmpB, { count: 14 })
                ctx.fx.burst('sparks', tmpB, { count: 10 })
                ctx.fx.burst('smoke', tmpB, { count: 2, scale: 0.5 })
                kit.play(DF_SPECIAL_SND.trapFry, tmpB, 1, 0.9 + Math.random() * 0.2)
            }
        },
        dispose() {
            for (const o of objs) o.removeFromParent()
            for (const g of geos) g.dispose()
            for (const m of mats) m.dispose()
        }
    }
}
