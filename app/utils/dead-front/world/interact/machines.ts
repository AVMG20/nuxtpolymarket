import * as THREE from 'three'
import type { DfSpot } from '#shared/utils/dead-front/map'
import { dfRaycast } from '#shared/utils/dead-front/physics'
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import { DF_MACHINE_TIMES } from '#shared/utils/dead-front/constants'
import { dfBoxPool } from '#shared/utils/dead-front/weapons'
import type { DfPerkId, DfWeaponId } from '#shared/utils/dead-front/types'
import { buildDfWeaponModel, disposeDfWeaponModel } from '~/utils/dead-front/weapons'
import { dfVoxMaterial } from '../../voxel/material'
import type { DfVoxMaterial } from '../../voxel/material'
import { DfVoxModel, mixHex, scaleHex } from '../../voxel/model'
import type { DfWorldKit, DfWorldPart } from '../kit'
import { DF_WORLD_SOUNDS, dfPerkJingleSound } from '../sound-names'
import { clamp01, damp, dfRng, easeInOutCubic, easeOutBack, easeOutCubic } from '../util'

// The machines, all voxel models: the mystery box, the Pack-a-Punch press,
// six perk cabinets in their perk colours, the power lever, the Tesla fuses,
// the Arc Generator, the wonder-weapon pedestal and the chalk wall-buys.
// Glows animate through each machine's own material (`uGlow`), so a powered
// cabinet breathes and a working press throbs without new shaders.

const C = 0.0625

/** A group placed at a spot, rotated so local +z faces the spot's front. */
function spotGroup(kit: DfWorldKit, s: { pos: { x: number, y: number, z: number }, yaw: number }): THREE.Group {
    const g = new THREE.Group()
    g.position.set(s.pos.x, s.pos.y, s.pos.z)
    g.rotation.y = s.yaw
    kit.root.add(g)
    return g
}

/** Weapon models built once per (weapon, tier) and reused. */
class WeaponCache {
    private cache = new Map<string, THREE.Group>()
    get(id: DfWeaponId, pap = 0): THREE.Group {
        const k = `${id}:${pap}`
        let g = this.cache.get(k)
        if (!g) {
            try {
                g = buildDfWeaponModel(id, pap)
            } catch {
                g = new THREE.Group()
            }
            this.cache.set(k, g)
        }
        return g
    }

    dispose(): void {
        for (const g of this.cache.values()) {
            g.removeFromParent()
            disposeDfWeaponModel(g)
        }
        this.cache.clear()
    }
}

/** Shows one model at a time under `holder`. */
function showModel(holder: THREE.Object3D, model: THREE.Object3D | null): void {
    for (const c of [...holder.children]) if (c !== model) holder.remove(c)
    if (model && model.parent !== holder) holder.add(model)
}

const BEAM_VERT = /* glsl */`
    varying float vY;
    void main() {
        vY = position.y + 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`
const BEAM_FRAG = /* glsl */`
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vY;
    void main() {
        float y = clamp(vY, 0.0, 1.0);
        float a = (1.0 - y) * (1.0 - y) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
    }
`

export function createDfMachines(kit: DfWorldKit): DfWorldPart {
    const { map, ctx } = kit
    const rnd = dfRng(5)
    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const weapons = new WeaponCache()
    const parts: DfWorldPart[] = []
    const shadow = kit.shadows
    const own = (glow = 1): DfVoxMaterial => {
        const m = dfVoxMaterial({ glow })
        mats.push(m)
        return m
    }
    const mesh = (m: DfVoxModel, pivot: [number, number, number], parent: THREE.Object3D, mat: THREE.Material = kit.mat, cell = C): THREE.Mesh => {
        const geo = m.mesh(cell, pivot) ?? new THREE.BufferGeometry()
        geos.push(geo)
        const me = new THREE.Mesh(geo, mat)
        me.castShadow = shadow
        me.receiveShadow = shadow
        parent.add(me)
        return me
    }
    const BRASS = 0xa58236
    const IRON = 0x2a2b2e
    const CAST = 0x45474b

    // ---------------------------------------------------------------- mystery box
    {
        const g = new THREE.Group()
        kit.root.add(g)
        const body = new THREE.Group()
        g.add(body)
        // Trestle stand (the 0.55 m 'boxstand' proxy), box on top. Local +z is the front.
        const stand = new DfVoxModel(27, 9, 13)
        const sw = stand.shade(0x5e4329, 0.07, 3)
        stand.box(0, 7, 0, 27, 9, 13, sw)
        for (const x of [1, 24]) for (const z of [1, 10]) stand.box(x, 0, z, x + 2, 7, z + 2, sw)
        stand.box(2, 3, 2, 25, 4, 3, sw).box(2, 3, 10, 25, 4, 11, sw)
        mesh(stand, [13.5, 0, 6.5], body)
        const box = new DfVoxModel(24, 8, 10)
        const wood = box.shade(0x7a5532, 0.06, 4)
        const brass = box.c(BRASS)
        box.box(0, 0, 0, 24, 8, 10, wood)
        box.vox.map((_v, i, j, k) => ((i === 0 || i === 23 ? 1 : 0) + (k === 0 || k === 9 ? 1 : 0) >= 2 || ((i === 0 || i === 23) && (j === 0 || j === 7)) ? brass : -1))
        // Painted eye sigil on the front and the back.
        const paint = box.c(0xe2d6ae, 0.35)
        const pupil = box.c(0x111111)
        for (const k of [0, 9]) {
            box.box(8, 3, k, 16, 5, k + 1, paint).box(10, 2, k, 14, 6, k + 1, paint).box(11, 3, k, 13, 5, k + 1, pupil)
        }
        box.box(10, 0, 0, 14, 8, 10, (i, j, k) => (j === 7 ? box.c(0x5c3f25) : wood(i, j, k)))
        box.box(1, 7, 1, 23, 8, 9, 0)
        box.box(1, 6, 1, 23, 7, 9, box.c(0xffd890, 1))
        const top = 0.55
        const boxMesh = mesh(box, [12, 0, 5], body)
        boxMesh.position.y = top
        const lidM = new DfVoxModel(24, 2, 10)
        lidM.box(0, 0, 0, 24, 2, 10, lidM.shade(0x7f5934, 0.06, 6))
        lidM.box(0, 0, 0, 24, 2, 1, lidM.c(BRASS)).box(0, 0, 9, 24, 2, 10, lidM.c(BRASS)).box(8, 1, 3, 16, 2, 7, lidM.c(BRASS))
        const lid = new THREE.Group()
        lid.position.set(0, top + 0.5, -0.3125)
        body.add(lid)
        mesh(lidM, [12, 0, 0], lid)
        const holder = new THREE.Group()
        body.add(holder)
        // A faint additive shaft of light that fades upward (square, like everything else).
        const beamMat = new THREE.ShaderMaterial({
            uniforms: { uColor: { value: new THREE.Color().setRGB(1.0, 0.85, 0.5) }, uOpacity: { value: 0.06 } },
            vertexShader: BEAM_VERT,
            fragmentShader: BEAM_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        mats.push(beamMat)
        const beamGeo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1)
        geos.push(beamGeo)
        const beam = new THREE.Mesh(beamGeo, beamMat)
        beam.renderOrder = 3
        kit.root.add(beam)
        const heights = map.boxSpots.map((s) => {
            const hit = dfRaycast(kit.collision, { x: s.pos.x, y: s.pos.y + 1.2, z: s.pos.z }, { x: 0, y: 1, z: 0 }, 40)
            return hit ? hit.dist + 1.1 : 30
        })
        const pool = dfBoxPool()
        let spot = -1
        let shownState = ''
        let lidT = 0
        let cycle = 0
        let cycleIdx = 0
        let rollT = 0
        let moveT = -1
        let landT = -1
        const place = (i: number) => {
            const s = map.boxSpots[i]!
            g.position.set(s.pos.x, s.pos.y, s.pos.z)
            g.rotation.y = s.yaw
            beam.position.set(s.pos.x, s.pos.y + heights[i]! / 2 + 0.6, s.pos.z)
            beam.scale.set(0.8, heights[i]!, 0.8)
            beam.rotation.y = s.yaw
        }
        parts.push({
            update(dt, world, time) {
                const b = world.box
                if (b.spot !== spot && b.state !== 'moving') {
                    const firstPlace = spot < 0
                    spot = b.spot
                    place(spot)
                    if (!firstPlace) {
                        landT = 0
                        kit.play(DF_WORLD_SOUNDS.boxLand, g.position, 1)
                        ctx.fx.burst('dust', g.position, { count: 22, scale: 1.6 })
                    }
                }
                if (b.state !== shownState) {
                    if (b.state === 'rolling') {
                        rollT = 0
                        cycle = 0
                    }
                    if (b.state === 'moving') moveT = 0
                    shownState = b.state
                }
                const open = b.state === 'rolling' || b.state === 'ready'
                lidT = damp(lidT, open ? 1 : 0, open ? 6 : 9, dt)
                lid.rotation.x = -lidT * 1.9
                if (b.state === 'rolling') {
                    rollT += dt
                    cycle -= dt
                    const prog = clamp01(rollT / DF_MACHINE_TIMES.boxRoll)
                    if (cycle <= 0 && pool.length) {
                        cycleIdx = (cycleIdx + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length
                        cycle = 0.06 + prog * prog * 0.35
                    }
                    const id = b.timer < 0.35 && b.weapon ? b.weapon : pool[cycleIdx]
                    showModel(holder, id ? weapons.get(id) : null)
                    holder.position.set(0, top + 0.3 + easeOutCubic(prog) * 0.75, 0)
                } else if (b.state === 'ready' && b.weapon) {
                    showModel(holder, weapons.get(b.weapon))
                    const sink = 1 - clamp01(b.timer / DF_MACHINE_TIMES.boxOffer)
                    holder.position.set(0, top + 1.05 - sink * 0.7 + Math.sin(time * 2) * 0.03, 0)
                } else {
                    holder.position.y = damp(holder.position.y, top, 10, dt)
                    if (holder.position.y < top + 0.1) showModel(holder, null)
                }
                holder.rotation.set(0, Math.PI / 2 + Math.sin(time * 0.8) * 0.15, 0)
                if (b.state === 'moving' && moveT >= 0) {
                    moveT += dt
                    const shake = moveT < 1.2 ? Math.sin(moveT * 40) * 0.04 * moveT : 0
                    body.position.set(shake, moveT > 1.2 ? easeOutCubic((moveT - 1.2) / 1.6) * 6 : 0, 0)
                    body.rotation.z = shake * 2
                    body.scale.setScalar(1 - clamp01((moveT - 2.4) / 0.4))
                    beam.visible = moveT < 2
                    if (moveT > 2.4 && moveT - dt <= 2.4) ctx.fx.burst('smoke', { x: g.position.x, y: g.position.y + 6, z: g.position.z }, { scale: 2 })
                } else {
                    beam.visible = true
                    body.rotation.z = 0
                    if (landT >= 0) {
                        landT += dt
                        const t = clamp01(landT / 0.5)
                        body.position.set(0, (1 - t * t) * 4, 0)
                        body.scale.setScalar(1)
                        if (t >= 1) landT = -1
                    } else {
                        body.position.set(0, 0, 0)
                        body.scale.setScalar(1)
                    }
                }
                beamMat.uniforms.uOpacity!.value = 0.05 + Math.sin(time * 1.7) * 0.01 + lidT * 0.04
            },
            onEvent(ev) {
                if (ev.k !== 'box') return
                if (ev.what === 'open') {
                    kit.play(DF_WORLD_SOUNDS.boxOpen, g.position, 1)
                    kit.play(DF_WORLD_SOUNDS.boxJingle, g.position, 0.9)
                    kit.play(DF_WORLD_SOUNDS.boxRoll, g.position, 0.7)
                } else if (ev.what === 'take') {
                    kit.play(DF_WORLD_SOUNDS.boxClose, g.position, 0.9)
                } else if (ev.what === 'move') {
                    kit.play(DF_WORLD_SOUNDS.boxMove, g.position, 1)
                }
            },
            dispose() {
                g.removeFromParent()
                beam.removeFromParent()
            }
        })
    }

    // ---------------------------------------------------------------- Pack-a-Punch: a mechanical press with a flywheel dynamo
    {
        const s = map.pap
        const g = spotGroup(kit, s)
        const glowMat = own(0.05)
        const cast = (m: DfVoxModel) => m.shade(CAST, 0.06, 7)
        const base = new DfVoxModel(24, 34, 18)
        const ci = cast(base)
        const brass = base.c(BRASS)
        const violet = base.c(0xb064ff, 1)
        base.box(0, 0, 0, 24, 14, 18, ci)
        base.box(1, 14, 2, 23, 15, 16, brass)
        base.box(5, 15, 2, 19, 33, 9, ci)
        base.box(4, 30, 2, 20, 34, 12, ci)
        // Window into the press chamber, rivets, and the violet tubes.
        base.box(7, 22, 8, 17, 29, 9, base.c(0x150a1f))
        for (const x of [5, 18]) for (let y = 16; y < 32; y += 4) base.set(x, y, 9, brass)
        for (const x of [6, 16]) {
            base.box(x, 34 - 4, 0, x + 2, 34, 2, base.c(0x8a4a24))
            base.box(x, 26, 0, x + 2, 30, 2, violet)
        }
        base.box(2, 4, 18 - 1, 22, 6, 18, violet)
        base.box(8, 10, 17, 16, 12, 18, base.c(0xffd890, 0.6))
        mesh(base, [12, 0, 9], g, glowMat)
        const ramM = new DfVoxModel(4, 10, 4)
        ramM.box(0, 0, 0, 4, 10, 4, ramM.c(0x5a5d62)).box(0, 0, 0, 4, 1, 4, ramM.c(BRASS))
        const ram = mesh(ramM, [2, 0, 2], g)
        ram.position.set(0, 1.0, 0.25)
        const flyM = new DfVoxModel(2, 18, 18)
        const fr = flyM.c(IRON)
        for (let j = 0; j < 18; j++) {
            for (let k = 0; k < 18; k++) {
                const d = Math.hypot(j + 0.5 - 9, k + 0.5 - 9)
                if ((d <= 9 && d > 7.5) || (d < 7.5 && (Math.abs(j + 0.5 - 9) < 0.8 || Math.abs(k + 0.5 - 9) < 0.8)) || d < 1.6) flyM.box(0, j, k, 2, j + 1, k + 1, fr)
            }
        }
        const fly = new THREE.Group()
        fly.position.set(-0.82, 0.6, -0.1)
        g.add(fly)
        mesh(flyM, [1, 9, 9], fly)
        const holder = new THREE.Group()
        g.add(holder)
        let flyV = 0
        let lastState = 'idle'
        let stamp = 0
        parts.push({
            update(dt, world, time) {
                const p = world.pap
                const powered = world.power
                const working = p.state === 'working'
                flyV = damp(flyV, working ? 18 : powered ? 1.2 : 0, 2, dt)
                fly.rotation.x += flyV * dt
                glowMat.userData.uGlow.value = powered ? (working ? 1.8 + Math.sin(time * 20) * 0.6 : 1 + Math.sin(time * 2) * 0.25) : 0.05
                if (working) {
                    const st = (time * 2.4) % 1
                    ram.position.y = 1.0 - (st < 0.15 ? easeOutCubic(st / 0.15) : 1 - easeInOutCubic((st - 0.15) / 0.85)) * 0.12
                    if (st < stamp) ctx.fx.burst('pap', g.localToWorld(new THREE.Vector3(0, 0.95, 0.3)), { count: 10 })
                    stamp = st
                } else {
                    ram.position.y = damp(ram.position.y, 1.0, 6, dt)
                }
                if (p.state !== lastState) {
                    if (p.state === 'ready') kit.play(DF_WORLD_SOUNDS.papReady, g.position, 1)
                    lastState = p.state
                }
                if (p.weapon && p.state !== 'idle') {
                    const tier = working ? Math.max(0, (p.tier ?? 1) - 1) : (p.tier ?? 1)
                    showModel(holder, weapons.get(p.weapon, tier))
                    const k = working ? clamp01(1 - p.timer / DF_MACHINE_TIMES.papWork) : clamp01(p.timer / DF_MACHINE_TIMES.papOffer)
                    const z = working ? 0.75 - easeInOutCubic(Math.min(1, k * 3)) * 0.6 : 0.75
                    holder.position.set(0, 1.05 + (p.state === 'ready' ? Math.sin(time * 2) * 0.02 : 0), z - (p.state === 'ready' ? (1 - k) * 0.4 : 0))
                    holder.rotation.set(0, Math.PI / 2, 0)
                } else {
                    showModel(holder, null)
                }
            },
            onEvent(ev) {
                if (ev.k === 'pap') kit.play(DF_WORLD_SOUNDS.papWork, g.position, 1)
            },
            dispose() {
                g.removeFromParent()
            }
        })
    }

    // ---------------------------------------------------------------- perk machines
    {
        const machines: { perk: DfPerkId, g: THREE.Group, mat: DfVoxMaterial, bottle: THREE.Object3D, buzz: number, seed: number }[] = []
        for (const pm of map.perks) {
            const fx = Math.sin(pm.yaw)
            const fz = Math.cos(pm.yaw)
            const g = new THREE.Group()
            g.position.set(pm.pos.x - fx * 0.95, pm.pos.y, pm.pos.z - fz * 0.95)
            g.rotation.y = pm.yaw
            kit.root.add(g)
            const hex = Number.parseInt((DF_PERKS[pm.perk]?.color ?? '#ffffff').slice(1), 16)
            const mat = own(0.05)
            const m = new DfVoxModel(16, 40, 15)
            const body = m.shade(scaleHex(hex, 0.62), 0.05, pm.perk.length)
            const trim = m.c(scaleHex(hex, 0.35))
            const brass = m.c(BRASS)
            const panel = m.c(mixHex(hex, 0xffffff, 0.25), 1)
            const bulb = m.c(0xffe0a0, 0.9)
            m.box(0, 0, 0, 16, 2, 15, brass)
            m.box(1, 2, 0, 15, 31, 14, body)
            m.box(1, 2, 13, 15, 31, 14, trim)
            // Front: glowing glass panel with the perk colour, coin slot, dispenser tray.
            m.box(3, 15, 13, 13, 27, 15, panel)
            m.box(4, 16, 14, 12, 26, 15, m.c(mixHex(hex, 0xffffff, 0.55), 1))
            m.box(5, 8, 13, 11, 11, 15, m.c(IRON))
            m.box(4, 12, 13, 12, 13, 15, brass)
            // Round marquee on top ringed with bulbs.
            for (let j = 0; j < 9; j++) {
                for (let i = 0; i < 16; i++) {
                    const d = Math.hypot(i + 0.5 - 8, j + 0.5)
                    if (d < 8) m.box(i, 31 + j, 3, i + 1, 32 + j, 11, d > 6.6 ? bulb : body)
                }
            }
            m.box(4, 32, 11, 12, 37, 12, panel)
            mesh(m, [8, 0, 7.5], g, mat)
            const bm = new DfVoxModel(4, 9, 4)
            const glass = bm.c(mixHex(hex, 0xffffff, 0.3), 0.8)
            bm.box(0, 0, 0, 4, 6, 4, glass).box(1, 6, 1, 3, 9, 3, glass).box(1, 8, 1, 3, 9, 3, bm.c(BRASS))
            const bottle = new THREE.Group()
            bottle.position.set(0, 2.5, -0.03)
            g.add(bottle)
            mesh(bm, [2, 0, 2], bottle, mat)
            machines.push({ perk: pm.perk, g, mat, bottle, buzz: 0, seed: rnd() * 10 })
        }
        let wasPowered = false
        parts.push({
            update(dt, world, time) {
                const on = world.power
                if (on && !wasPowered) for (const m of machines) kit.play(DF_WORLD_SOUNDS.perkHum, m.g.position, 0.6)
                wasPowered = on
                for (const m of machines) {
                    m.buzz = Math.max(0, m.buzz - dt)
                    const surge = kit.state.powerAge < 1.5 && on ? (Math.sin(time * 37 + m.seed) > 0 ? 1 : 0.2) : 1
                    m.mat.userData.uGlow.value = on ? (1.05 + Math.sin(time * 2 + m.seed) * 0.15) * surge + m.buzz * 1.4 : 0.05
                    m.bottle.rotation.y += dt * (on ? 0.9 : 0)
                    m.bottle.position.y = 2.5 + (on ? Math.sin(time * 1.6 + m.seed) * 0.04 : 0)
                }
            },
            onEvent(ev) {
                if (ev.k !== 'perk') return
                const m = machines.find(x => x.perk === ev.perk)
                if (!m) return
                m.buzz = 1.5
                kit.play(DF_WORLD_SOUNDS.perkBuy, m.g.position, 1)
                kit.play(dfPerkJingleSound(ev.perk), m.g.position, 0.8)
            },
            dispose() {
                for (const m of machines) m.g.removeFromParent()
            }
        })
    }

    // ---------------------------------------------------------------- power lever
    {
        const s = map.power
        const g = spotGroup(kit, s)
        const m = new DfVoxModel(18, 46, 4)
        const cast = m.shade(CAST, 0.06, 2)
        m.box(0, 6, 0, 18, 36, 3, cast).box(1, 7, 2, 17, 35, 4, m.c(IRON))
        for (const x of [3, 12]) {
            m.box(x, 28, 3, x + 3, 31, 4, m.c(BRASS))
            m.box(x + 1, 29, 3, x + 2, 30, 4, m.c(0xe8e0c0, 0.4))
        }
        for (const x of [2, 15]) m.box(x, 36, 0, x + 1, 46, 1, m.c(IRON))
        m.box(6, 12, 3, 12, 14, 4, m.c(0x6b2a1a))
        mesh(m, [9, 0, 4], g)
        const lampOff = new DfVoxModel(2, 2, 1)
        lampOff.box(0, 0, 0, 2, 2, 1, lampOff.c(0xc0301a, 0.6))
        const lampOn = new DfVoxModel(2, 2, 1)
        lampOn.box(0, 0, 0, 2, 2, 1, lampOn.c(0x40ff70, 1))
        const red = mesh(lampOff, [1, 0, 0], g)
        const green = mesh(lampOn, [1, 0, 0], g)
        red.position.set(0, 2.05, 0)
        green.position.set(0, 2.05, 0)
        green.visible = false
        const leverM = new DfVoxModel(2, 10, 2)
        leverM.box(0, 0, 0, 2, 7, 2, leverM.c(IRON)).box(0, 7, 0, 2, 10, 2, leverM.c(0x3a1a10))
        const lever = new THREE.Group()
        lever.position.set(0, 1.25, 0.06)
        g.add(lever)
        mesh(leverM, [1, 0, 1], lever)
        lever.rotation.x = -0.6
        let t = -1
        let first = true
        parts.push({
            update(dt, world) {
                if (world.power && t < 0) t = first ? 10 : 0
                first = false
                if (t >= 0) {
                    t += dt
                    lever.rotation.x = -0.6 + easeOutBack(clamp01(t / 0.35), 2) * 2.0
                }
                red.visible = !world.power
                green.visible = world.power
            },
            onEvent(ev) {
                if (ev.k !== 'power') return
                if (t < 0) t = 0
                const p = g.localToWorld(new THREE.Vector3(0, 1.4, 0.1))
                kit.play(DF_WORLD_SOUNDS.lever, p, 1)
                kit.play(DF_WORLD_SOUNDS.power, p, 1)
                ctx.fx.burst('sparks', p, { count: 30 })
                ctx.fx.burst('electric', p, { count: 12 })
                ctx.fx.flash(p, 0x9fc4ff, 6, 0.3)
            },
            dispose() {
                g.removeFromParent()
            }
        })
    }

    // ---------------------------------------------------------------- easter egg: fuses, Arc Generator, pedestal
    {
        const fuseMat = own(1)
        const fuseModel = () => {
            const f = new DfVoxModel(4, 8, 4)
            f.box(0, 1, 0, 4, 7, 4, f.c(0xd8d2c0)).box(0, 0, 0, 4, 1, 4, f.c(BRASS)).box(0, 7, 0, 4, 8, 4, f.c(BRASS))
            f.box(0, 3, 0, 4, 5, 4, f.c(0x7fb8ff, 1))
            return f
        }
        const fuseGeo = fuseModel().mesh(0.04, [2, 4, 2])!
        geos.push(fuseGeo)
        const fuses = map.egg.fuses.map((s: DfSpot) => {
            const g = new THREE.Group()
            g.position.set(s.pos.x, s.pos.y + 0.18, s.pos.z)
            kit.root.add(g)
            const f = new THREE.Mesh(fuseGeo, fuseMat)
            f.rotation.z = Math.PI / 2
            g.add(f)
            g.visible = false
            return { s, g, f, taken: false, vanish: -1 }
        })
        // Generator: a cast cabinet with fuse sockets and two copper coils capped with rings.
        const gs = map.egg.generator
        const gen = spotGroup(kit, gs)
        const coilMat = own(0.05)
        const gm = new DfVoxModel(22, 38, 22)
        const cast = gm.shade(CAST, 0.06, 3)
        gm.box(0, 0, 0, 22, 16, 22, cast).box(0, 16, 0, 22, 17, 22, gm.c(BRASS))
        for (let k = 0; k < 3; k++) gm.box(4 + k * 5, 8, 21, 7 + k * 5, 11, 22, gm.c(IRON))
        const copper = gm.shade(0x8a4a24, 0.08, 5)
        const ring = gm.c(0x8fd0ff, 1)
        for (const cx of [5, 15]) {
            gm.box(cx - 2, 17, 9, cx + 2, 33, 13, copper)
            for (let j = 18; j < 33; j += 3) gm.box(cx - 2, j, 9, cx + 2, j + 1, 13, gm.c(0x6a3518))
            for (let k = 0; k < 10; k++) {
                for (let i = 0; i < 10; i++) {
                    const d = Math.hypot(i + 0.5 - 5, k + 0.5 - 5)
                    if (d < 5 && d > 2.6) gm.box(cx - 5 + i, 33, 6 + k, cx - 4 + i, 35, 7 + k, ring)
                }
            }
        }
        mesh(gm, [11, 0, 11], gen, coilMat)
        const coilTops = [new THREE.Vector3(-0.375, 2.15, 0), new THREE.Vector3(0.25, 2.15, 0)]
        const sockets: THREE.Mesh[] = []
        for (let k = 0; k < 3; k++) {
            const f = new THREE.Mesh(fuseGeo, fuseMat)
            f.position.set(-0.375 + k * 0.3125 + 0.03, 0.6, 0.72)
            f.rotation.x = Math.PI / 2
            f.visible = false
            gen.add(f)
            sockets.push(f)
        }
        const gaugeM = new DfVoxModel(1, 1, 1)
        gaugeM.box(0, 0, 0, 1, 1, 1, gaugeM.c(0x7fb8ff, 1))
        const gauge = mesh(gaugeM, [0, 0.5, 0.5], gen, fuseMat, 1)
        gauge.position.set(-0.45, 0.3, 0.7)
        gauge.scale.set(0.9, 0.06, 0.04)
        // Pedestal and the wonder weapon above it.
        const ps = map.egg.pedestal
        const ped = spotGroup(kit, ps)
        const pedMat = own(0.2)
        const pm = new DfVoxModel(12, 17, 12)
        const stone = pm.shade(0x9a9488, 0.07, 9)
        pm.box(0, 0, 0, 12, 2, 12, stone).box(2, 2, 2, 10, 14, 10, stone).box(1, 14, 1, 11, 16, 11, stone).box(0, 16, 0, 12, 17, 12, pm.c(BRASS))
        for (const [x, z] of [[2, 11], [9, 11], [5, 11]] as const) pm.box(x, 6, z - 1, x + 1, 11, z, pm.c(0x8fd0ff, 1))
        pm.box(5, 4, 1, 7, 12, 2, pm.c(0x8fd0ff, 1))
        mesh(pm, [6, 0, 6], ped, pedMat)
        const pedHolder = new THREE.Group()
        pedHolder.position.set(0, 1.45, 0)
        ped.add(pedHolder)
        // Souls: small glowing cubes flying into the generator.
        const wispM = new DfVoxModel(1, 1, 1)
        wispM.box(0, 0, 0, 1, 1, 1, wispM.c(0x9fd8ff, 1))
        const wispGeo = wispM.mesh(1, [0.5, 0.5, 0.5])!
        geos.push(wispGeo)
        const WISPS = 12
        const wispInst = new THREE.InstancedMesh(wispGeo, fuseMat, WISPS * 3)
        wispInst.frustumCulled = false
        wispInst.count = 0
        kit.root.add(wispInst)
        const wisps: { from: THREE.Vector3, t: number }[] = []
        let arcT = 0
        let humT = 0
        let lastStep = ''
        const genTop = new THREE.Vector3()
        const tmpA = new THREE.Vector3()
        const tmpB = new THREE.Vector3()
        const m4 = new THREE.Matrix4()
        const q = new THREE.Quaternion()
        const sc = new THREE.Vector3()
        parts.push({
            update(dt, world, time) {
                const egg = world.egg
                const installed = egg.step === 'charge' || egg.step === 'claim' || egg.step === 'done'
                fuseMat.userData.uGlow.value = 1 + Math.sin(time * 4) * 0.3
                for (const f of fuses) {
                    const found = egg.fusesFound.includes(f.s.id)
                    if (found && !f.taken) {
                        f.taken = true
                        if (f.g.visible) f.vanish = 0
                    }
                    const show = world.power && (!f.taken || f.vanish >= 0)
                    f.g.visible = show
                    if (!show) continue
                    f.f.position.y = Math.sin(time * 2 + f.s.pos.x) * 0.04
                    f.f.rotation.y += dt * 1.2
                    if (f.vanish >= 0) {
                        f.vanish += dt
                        f.g.scale.setScalar(Math.max(0.001, 1 - f.vanish * 3))
                        if (f.vanish > 0.35) f.vanish = -1
                    } else if (Math.random() < dt * 0.4) {
                        ctx.fx.burst('electric', f.g.position, { count: 4, scale: 0.4 })
                    }
                }
                for (const sock of sockets) sock.visible = installed && egg.step !== 'done'
                const charge = egg.chargeNeeded > 0 ? clamp01(egg.charge / egg.chargeNeeded) : 0
                const active = egg.step === 'charge'
                coilMat.userData.uGlow.value = active ? 0.3 + charge * 1.7 : egg.step === 'claim' ? 2.2 : installed ? 0.15 : 0.04
                gauge.scale.x = 0.9 * (active ? Math.max(0.02, charge) : egg.step === 'claim' ? 1 : 0.02)
                pedMat.userData.uGlow.value = egg.step === 'claim' ? 1.4 + Math.sin(time * 3) * 0.4 : 0.15
                if (active || egg.step === 'claim') {
                    arcT -= dt
                    if (arcT <= 0) {
                        gen.localToWorld(tmpA.copy(coilTops[0]!))
                        gen.localToWorld(tmpB.copy(coilTops[1]!))
                        ctx.fx.lightning(tmpA, tmpB, 0x9fd0ff)
                        if (Math.random() < 0.5) kit.play(DF_WORLD_SOUNDS.zap, tmpA, 0.4 + charge * 0.4)
                        arcT = egg.step === 'claim' ? 0.3 : 1.6 - charge * 1.3 + Math.random() * 0.4
                    }
                    humT -= dt
                    if (humT <= 0) {
                        kit.play(DF_WORLD_SOUNDS.genHum, gen.position, 0.5 + charge * 0.4, 0.9 + charge * 0.3)
                        humT = 2.0
                    }
                }
                if (egg.step === 'claim') {
                    showModel(pedHolder, weapons.get('wunder'))
                    pedHolder.position.y = 1.45 + Math.sin(time * 1.6) * 0.06
                    pedHolder.rotation.y += dt * 0.6
                    if (Math.random() < dt * 1.5) ctx.fx.burst('electric', ped.localToWorld(tmpA.set(0, 1.45, 0)), { count: 5, scale: 0.5 })
                } else {
                    showModel(pedHolder, null)
                }
                if (egg.step !== lastStep) {
                    if (lastStep && egg.step === 'claim') {
                        gen.localToWorld(genTop.set(0, 2.2, 0))
                        ctx.fx.lightning(genTop, ped.localToWorld(tmpB.set(0, 1.5, 0)), 0xbfe0ff)
                        ctx.fx.flash(genTop, 0x9fd0ff, 8, 0.4)
                    }
                    lastStep = egg.step
                }
                gen.localToWorld(genTop.set(0, 1.8, 0))
                let n = 0
                for (let i = wisps.length - 1; i >= 0; i--) {
                    const w = wisps[i]!
                    w.t += dt / 0.9
                    if (w.t >= 1) {
                        ctx.fx.burst('electric', genTop, { count: 10 })
                        kit.play(DF_WORLD_SOUNDS.zap, genTop, 0.6)
                        wisps.splice(i, 1)
                        continue
                    }
                    const t = easeInOutCubic(w.t)
                    for (let k = 0; k < 3; k++) {
                        const tt = Math.max(0, t - k * 0.04)
                        tmpA.lerpVectors(w.from, genTop, tt)
                        tmpA.y += Math.sin(tt * Math.PI) * 2.0
                        const s = (0.14 - k * 0.035) * (0.6 + Math.sin(tt * Math.PI) * 0.4)
                        q.setFromAxisAngle(sc.set(0.3, 1, 0.2).normalize(), time * 6 + i)
                        wispInst.setMatrixAt(n++, m4.compose(tmpA, q, sc.setScalar(s)))
                    }
                }
                wispInst.count = n
                if (n) wispInst.instanceMatrix.needsUpdate = true
            },
            onEvent(ev) {
                if (ev.k === 'fuse') {
                    const f = fuses.find(x => x.s.id === ev.id)
                    if (f) {
                        kit.play(DF_WORLD_SOUNDS.fuse, f.g.position, 1)
                        ctx.fx.burst('electric', f.g.position, { count: 14 })
                    }
                } else if (ev.k === 'egg') {
                    kit.play(DF_WORLD_SOUNDS.eggStep, undefined, 0.8)
                    if (ev.step === 'charge') kit.play(DF_WORLD_SOUNDS.fuseInstall, gen.position, 1)
                } else if (ev.k === 'soul') {
                    ctx.fx.burst('soul', ev.from, { count: 8 })
                    kit.play(DF_WORLD_SOUNDS.soul, ev.from, 0.8)
                    if (wisps.length < WISPS) wisps.push({ from: new THREE.Vector3(ev.from.x, ev.from.y + 1, ev.from.z), t: 0 })
                }
            },
            dispose() {
                for (const f of fuses) f.g.removeFromParent()
                gen.removeFromParent()
                ped.removeFromParent()
                wispInst.removeFromParent()
                wispInst.dispose()
            }
        })
    }

    // ---------------------------------------------------------------- wall-buy chalk outlines
    {
        const chalk = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.62, 0.62, 0.56), transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
        mats.push(chalk)
        const cube = new DfVoxModel(1, 1, 1)
        cube.box(0, 0, 0, 1, 1, 1, cube.c(0xffffff))
        const cubeGeo = cube.mesh(1, [0.5, 0.5, 0.5])!
        geos.push(cubeGeo)
        const groups: THREE.Group[] = []
        for (const w of map.wallBuys) {
            const g = new THREE.Group()
            g.position.set(w.pos.x + w.normal.x * 0.01, w.pos.y, w.pos.z + w.normal.z * 0.01)
            g.rotation.y = Math.atan2(-w.normal.z, w.normal.x)
            kit.root.add(g)
            groups.push(g)
            const model = weapons.get(w.weapon).clone(true)
            const bb = new THREE.Box3().setFromObject(model)
            const size = bb.getSize(new THREE.Vector3())
            if (size.z > 0.01) {
                const s = 1.0 / Math.max(size.z, 0.4)
                model.traverse((o) => {
                    const me = o as THREE.Mesh
                    if (me.isMesh) {
                        me.material = chalk
                        me.castShadow = false
                    }
                })
                const centre = bb.getCenter(new THREE.Vector3())
                model.position.set(-centre.x * s * 0.02, -centre.y * s, -centre.z * s)
                model.scale.set(s * 0.02, s, s)
                g.add(model)
            }
            // A chalk frame of square strokes.
            for (const [y, h, z, l] of [[0.34, 0.03, 0, 1.25], [-0.34, 0.03, 0, 1.25], [0, 0.71, 0.61, 0.03], [0, 0.71, -0.61, 0.03]] as [number, number, number, number][]) {
                const bar = new THREE.Mesh(cubeGeo, chalk)
                bar.position.set(0, y, z)
                bar.scale.set(0.004, h, l)
                g.add(bar)
            }
        }
        parts.push({
            update() {},
            dispose() {
                for (const g of groups) g.removeFromParent()
            }
        })
    }

    return {
        update(dt, world, time) {
            for (const p of parts) p.update(dt, world, time)
        },
        onEvent(ev) {
            for (const p of parts) p.onEvent?.(ev)
        },
        dispose() {
            for (const p of parts) p.dispose()
            weapons.dispose()
            for (const g of geos) g.dispose()
            for (const m of mats) m.dispose()
        }
    }
}
