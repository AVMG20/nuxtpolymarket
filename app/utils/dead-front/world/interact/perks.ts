import * as THREE from 'three'
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import type { DfPerkId } from '#shared/utils/dead-front/types'
import { dfVoxMaterial } from '../../voxel/material'
import type { DfVoxMaterial } from '../../voxel/material'
import { DfVoxModel, mixHex, scaleHex } from '../../voxel/model'
import type { DfWorldKit, DfWorldPart } from '../kit'
import { DF_BOTTLES, DF_BOTTLE_H, DF_BOTTLE_W, dfBottlePixel } from '../perk-bottles'
import type { DfBottlePixel } from '../perk-bottles'
import { DF_WORLD_SOUNDS, dfPerkJingleSound } from '../sound-names'
import { clamp01, dfPowerLevel, dfRng, easeOutBack } from '../util'

// The six perk cabinets: a cast plinth, fluted pilasters, a lit glass sign
// showing that perk's bottle (the same silhouette as the HUD sprite), an arched
// marquee ringed with chasing bulbs, a coin slot and a dispenser tray. The
// power reaches each cabinet in turn: the sign stutters on, the bulbs start to
// chase and the machine hums. Buying a perk drops a bottle into the tray, the
// bulbs flash and a relief valve vents steam.

const C = 0.0625
/** Model voxels: 16 wide, 40 tall, 15 deep; the front face is +z. */
const MW = 16
const MD = 15
/** Bottle voxel size for the bottle on top and the one that drops. */
const BOTTLE_CELL = 0.028
const BRASS = 0xa58236
const IRON = 0x2a2b2e

/** Liquid / glass / label colours of a perk bottle pixel. */
function bottleColor(k: DfBottlePixel, hex: number): [number, number] | null {
    switch (k) {
        case 'none': return null
        case 'cork': return [0x8a5d30, 0]
        case 'corkHi': return [0xb9844a, 0]
        case 'outline': return [0x0b0906, 0]
        case 'label': return [0xefe2bf, 0.35]
        case 'labelBand': return [scaleHex(hex, 0.8), 0.5]
        case 'ink': return [0x5a4632, 0.2]
        case 'liquid': return [scaleHex(hex, 0.8), 1]
        case 'liquidHi': return [mixHex(hex, 0xfffaeb, 0.4), 1]
        case 'liquidLo': return [scaleHex(hex, 0.55), 1]
        case 'glass': return [scaleHex(hex, 0.25), 0.3]
        case 'glassHi': return [mixHex(hex, 0xffffff, 0.2), 0.6]
    }
}

/** A round 3D bottle: each sprite row lathed into a disc of that row's width. */
export function dfPerkBottleModel(perk: DfPerkId): DfVoxModel {
    const sp = DF_BOTTLES[perk]
    const hex = Number.parseInt((DF_PERKS[perk]?.color ?? '#ffffff').slice(1), 16)
    const W = DF_BOTTLE_W
    const m = new DfVoxModel(W, DF_BOTTLE_H, W)
    const c = (W - 1) / 2
    for (let y = 0; y < DF_BOTTLE_H; y++) {
        const s = sp.spans[y]
        if (!s) continue
        const r = (s[1] - s[0] + 1) / 2
        const j = DF_BOTTLE_H - 1 - y
        for (let k = 0; k < W; k++) {
            for (let i = 0; i < W; i++) {
                const d = Math.hypot(i - c, k - c)
                if (d > r - 0.15) continue
                // Colour from the sprite column at the same distance from the axis (front view).
                const x = Math.round(c + (i - c))
                const kind = dfBottlePixel(sp, Math.min(s[1], Math.max(s[0], x)), y)
                // The silhouette outline only reads on the rim; inside the disc use the body colour.
                const inner = d < r - 1.1
                const col = bottleColor(kind === 'outline' && inner ? 'liquid' : kind, hex)
                if (col) m.set(i, j, k, m.c(col[0], col[1]))
            }
        }
    }
    return m
}

interface Machine {
    perk: DfPerkId
    g: THREE.Group
    mat: DfVoxMaterial
    bottle: THREE.Object3D
    drop: THREE.Object3D
    dropT: number
    buzz: number
    seed: number
    delay: number
    /** Local power came on (hum played). */
    lit: boolean
    steamAt: number
    bulb0: number
}

/** Bulb slots around the marquee arch, in model voxel coordinates. */
function archBulbs(): [number, number][] {
    const out: [number, number][] = []
    const n = 13
    for (let i = 0; i < n; i++) {
        const a = Math.PI * (i / (n - 1))
        out.push([8 + Math.cos(a) * 7.2, 31 + Math.sin(a) * 7.2])
    }
    return out
}

export function createDfPerkMachines(kit: DfWorldKit): DfWorldPart {
    const { map, ctx } = kit
    const rnd = dfRng(23)
    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const shadow = kit.shadows
    const mesh = (m: DfVoxModel, pivot: [number, number, number], parent: THREE.Object3D, mat: THREE.Material, cell = C): THREE.Mesh => {
        const geo = m.mesh(cell, pivot) ?? new THREE.BufferGeometry()
        geos.push(geo)
        const me = new THREE.Mesh(geo, mat)
        me.castShadow = shadow
        me.receiveShadow = shadow
        parent.add(me)
        return me
    }

    const bulbsAt = archBulbs()
    const bulbModel = new DfVoxModel(1, 1, 1)
    bulbModel.box(0, 0, 0, 1, 1, 1, bulbModel.c(0xffe2a8, 1))
    const bulbGeo = bulbModel.mesh(1, [0.5, 0.5, 0.5])!
    geos.push(bulbGeo)
    const bulbs = new THREE.InstancedMesh(bulbGeo, kit.mat, Math.max(1, map.perks.length * bulbsAt.length))
    bulbs.name = 'df-perk-bulbs'
    bulbs.frustumCulled = false
    kit.root.add(bulbs)

    const bottleGeos = new Map<DfPerkId, THREE.BufferGeometry>()
    const machines: Machine[] = []
    const m4 = new THREE.Matrix4()
    const v3 = new THREE.Vector3()
    const tint = new THREE.Color()
    const bulbScale = new THREE.Vector3(C * 0.9, C * 0.9, C * 0.9)

    for (const pm of map.perks) {
        const fx = Math.sin(pm.yaw)
        const fz = Math.cos(pm.yaw)
        const g = new THREE.Group()
        g.position.set(pm.pos.x - fx * 0.95, pm.pos.y, pm.pos.z - fz * 0.95)
        g.rotation.y = pm.yaw
        kit.root.add(g)
        const hex = Number.parseInt((DF_PERKS[pm.perk]?.color ?? '#ffffff').slice(1), 16)
        const mat = dfVoxMaterial({ glow: 0.05 })
        mats.push(mat)

        const m = new DfVoxModel(MW, 40, MD)
        const body = m.shade(scaleHex(hex, 0.6), 0.05, pm.perk.length)
        const trim = m.shade(scaleHex(hex, 0.32), 0.05, 3)
        const brass = m.c(BRASS)
        const brassD = m.c(scaleHex(BRASS, 0.7))
        const dark = m.c(0x0d0b0a)
        // Plinth and body.
        m.box(0, 0, 0, MW, 2, MD, brassD).box(0, 1, 0, MW, 2, MD, brass)
        m.box(1, 2, 0, MW - 1, 31, 13, body)
        // Fluted pilasters either side of the front with brass caps and bases.
        for (const x of [1, MW - 3]) {
            m.box(x, 2, 12, x + 2, 31, 15, trim)
            for (let y = 5; y < 29; y++) m.set(x + (x < 8 ? 1 : 0), y, 14, (y % 3) === 0 ? trim(0, y, 0) : m.c(scaleHex(hex, 0.22)))
            m.box(x, 2, 12, x + 2, 4, 15, brass).box(x, 29, 12, x + 2, 31, 15, brass)
        }
        // The sign: the perk's bottle in lit glass on a dark ground, framed in brass.
        m.box(3, 8, 13, MW - 3, 9, 14, brass).box(3, 30, 13, MW - 3, 31, 14, brass)
        m.box(3, 9, 12, MW - 3, 30, 13, dark)
        const sp = DF_BOTTLES[pm.perk]
        for (let y = 0; y < DF_BOTTLE_H; y++) {
            for (let x = 0; x < DF_BOTTLE_W; x++) {
                const col = bottleColor(dfBottlePixel(sp, x, y), hex)
                // The sign is 10 voxels wide: trim one sprite column each side (always empty or outline).
                const i = 3 + x - 1
                if (!col || i < 3 || i >= MW - 3) continue
                m.set(i, 29 - y, 12, m.c(col[0], col[1]))
            }
        }
        // Rays behind the bottle in the perk colour, faintly lit.
        const ray = m.c(scaleHex(hex, 0.45), 0.35)
        for (let y = 10; y < 29; y += 3) {
            m.set(4, y, 12, ray).set(MW - 5, y + 1, 12, ray)
        }
        // Coin slot and the dispenser tray (an open mouth the bottle drops into).
        m.box(10, 5, 13, 12, 8, 14, brass).set(10, 6, 13, dark).set(10, 7, 13, dark)
        m.box(4, 2, 13, 10, 8, 14, m.c(IRON))
        m.box(5, 3, 11, 9, 7, 14, 0)
        m.box(5, 3, 10, 9, 7, 11, dark)
        m.box(4, 2, 13, 10, 3, 15, brass)
        // The arched marquee, a lit panel in the perk colour inside a dark rim.
        for (let j = 0; j < 9; j++) {
            for (let i = 0; i < MW; i++) {
                const d = Math.hypot(i + 0.5 - 8, j + 0.5)
                if (d < 8) m.box(i, 31 + j, 3, i + 1, 32 + j, 12, d > 6.2 ? trim(i, j, 0) : d > 5.2 ? brass : body(i, j, 0))
                if (d < 5.2 && j < 5) m.set(i, 31 + j, 12, m.c(mixHex(hex, 0xffffff, 0.25), 0.45))
            }
        }
        // A steam valve on the roof.
        m.box(11, 31, 4, 13, 34, 6, m.c(IRON)).box(10, 34, 3, 14, 35, 7, brass)
        mesh(m, [8, 0, 7.5], g, mat)

        // The perk's bottle on top, turning slowly while powered.
        let bgeo = bottleGeos.get(pm.perk)
        if (!bgeo) {
            bgeo = dfPerkBottleModel(pm.perk).mesh(BOTTLE_CELL, [DF_BOTTLE_W / 2, 0, DF_BOTTLE_W / 2]) ?? new THREE.BufferGeometry()
            bottleGeos.set(pm.perk, bgeo)
            geos.push(bgeo)
        }
        const bottle = new THREE.Group()
        bottle.position.set(0, 40 * C, 0)
        g.add(bottle)
        const bm = new THREE.Mesh(bgeo, mat)
        bm.castShadow = shadow
        bottle.add(bm)
        // The bottle that drops into the tray when bought.
        const drop = new THREE.Group()
        drop.visible = false
        g.add(drop)
        const dm = new THREE.Mesh(bgeo, mat)
        dm.scale.setScalar(0.38)
        drop.add(dm)
        machines.push({
            perk: pm.perk, g, mat, bottle, drop, dropT: -1, buzz: 0, seed: rnd() * 10,
            delay: kit.powerDelay(g.position.x, g.position.z), lit: false, steamAt: 2 + rnd() * 6,
            bulb0: machines.length * bulbsAt.length
        })
        // Bulb positions in world space.
        g.updateMatrixWorld(true)
        bulbsAt.forEach(([bx, by], n) => {
            v3.set((bx + 0.5 - 8) * C, (by + 0.5) * C, (12.5 - 7.5) * C).applyMatrix4(g.matrixWorld)
            const idx = machines[machines.length - 1]!.bulb0 + n
            bulbs.setMatrixAt(idx, m4.compose(v3, g.quaternion, bulbScale))
            bulbs.setColorAt(idx, tint.setRGB(0.2, 0.2, 0.2))
        })
    }
    bulbs.instanceMatrix.needsUpdate = true

    const steamPos = new THREE.Vector3()
    const up = { x: 0, y: 1, z: 0 }
    const vent = (mc: Machine, k: number) => {
        steamPos.set((12 - 8) * C, 35.5 * C, (5 - 7.5) * C)
        mc.g.localToWorld(steamPos)
        ctx.fx.burst('muzzle-smoke', steamPos, { normal: up, count: Math.round(2 + k * 4), scale: 1.2 + k, color: 0xd8d4cc })
    }

    return {
        update(dt, world, time) {
            const st = kit.state
            for (const mc of machines) {
                const age = world.power && st.powerOn ? st.powerAge - mc.delay : -1
                const lvl = dfPowerLevel(age, time, mc.seed)
                if (age >= 0 && !mc.lit) {
                    mc.lit = true
                    kit.play(DF_WORLD_SOUNDS.perkHum, mc.g.position, 0.6)
                    vent(mc, 0.6)
                }
                mc.buzz = Math.max(0, mc.buzz - dt)
                const on = lvl > 0.5
                mc.mat.userData.uGlow.value = lvl > 0
                    ? (1.6 + Math.sin(time * 2 + mc.seed) * 0.2) * lvl + mc.buzz * 1.4
                    : 0.04
                // The top bottle turns and bobs while powered.
                mc.bottle.rotation.y += dt * (lvl > 0 ? 0.9 : 0)
                mc.bottle.position.y = 40 * C + (lvl > 0 ? 0.02 + Math.sin(time * 1.6 + mc.seed) * 0.03 : 0)
                // Chasing marquee bulbs (all flash together after a purchase).
                for (let n = 0; n < bulbsAt.length; n++) {
                    let k = 0.18
                    if (lvl > 0) {
                        const chase = ((n - time * 9 + mc.seed * 3) % 3 + 3) % 3 < 1 ? 1 : 0.35
                        k = mc.buzz > 0 ? (Math.sin(time * 28) > 0 ? 1.6 : 0.3) : 0.3 + chase * 0.95
                        k *= lvl
                    }
                    bulbs.setColorAt(mc.bulb0 + n, tint.setRGB(Math.max(0.18, k), Math.max(0.18, k), Math.max(0.18, k)))
                }
                // Steam now and then while powered.
                if (on) {
                    mc.steamAt -= dt
                    if (mc.steamAt <= 0) {
                        mc.steamAt = 5 + Math.random() * 9
                        vent(mc, 0.2)
                    }
                }
                // The dispensed bottle: drops in at the clunk, bounces on the clinks, then is taken.
                if (mc.dropT >= 0) {
                    mc.dropT += dt
                    const t = mc.dropT - 0.16
                    if (t < 0) {
                        mc.drop.visible = false
                    } else {
                        mc.drop.visible = true
                        const fall = clamp01(t / 0.32)
                        let y = 0.42 - fall * fall * 0.23
                        if (t > 0.32) y = 0.19 + Math.abs(Math.sin((t - 0.32) * 11)) * 0.04 * Math.exp(-(t - 0.32) * 7)
                        const out = clamp01((t - 0.3) / 0.25)
                        mc.drop.position.set(0, y, 0.26 + out * 0.1)
                        mc.drop.rotation.set(Math.sin(t * 9) * 0.25 * (1 - out), t * 2, 0)
                        const gone = clamp01((t - 1.8) / 0.3)
                        mc.drop.scale.setScalar(Math.max(0.001, (t < 0.1 ? easeOutBack(t / 0.1) : 1) * (1 - gone)))
                        if (gone >= 1) {
                            mc.drop.visible = false
                            mc.dropT = -1
                        }
                    }
                }
            }
            if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true
        },
        onEvent(ev) {
            if (ev.k !== 'perk') return
            const mc = machines.find(x => x.perk === ev.perk)
            if (!mc) return
            mc.buzz = 1.5
            mc.dropT = 0
            kit.play(DF_WORLD_SOUNDS.perkBuy, mc.g.position, 1)
            kit.play(dfPerkJingleSound(ev.perk), mc.g.position, 0.8)
            vent(mc, 1)
            const glow = mc.g.localToWorld(v3.set(0, 1.2, 0.6))
            ctx.fx.flash(glow, DF_PERKS[ev.perk]?.color ?? '#ffffff', 3, 0.5)
            ctx.fx.burst('powerup', glow, { color: DF_PERKS[ev.perk]?.color, scale: 1.3 })
        },
        dispose() {
            for (const mc of machines) mc.g.removeFromParent()
            bulbs.removeFromParent()
            bulbs.dispose()
            for (const g of geos) g.dispose()
            for (const m of mats) m.dispose()
        }
    }
}
