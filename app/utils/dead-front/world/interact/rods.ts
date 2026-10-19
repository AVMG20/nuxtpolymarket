import * as THREE from 'three'
import type { DfSpot } from '#shared/utils/dead-front/map'
import { dfVoxMaterial } from '../../voxel/material'
import type { DfVoxMaterial } from '../../voxel/material'
import { DfVoxModel } from '../../voxel/model'
import type { DfWorldKit, DfWorldPart } from '../kit'
import { DF_WORLD_SOUNDS } from '../sound-names'
import { DfSpring, damp } from '../util'

// The egg's lightning rods: tall iron masts banded with porcelain insulators
// and crowned with copper prongs round a glass ball, each with a knife switch
// on a post at its foot. Inert until the 'rods' step; then the glass glows and
// the masts tick with sparks. A thrown switch slams home and the mast crackles
// with bolts reaching up into the sky; when all three are live, arcs leap from
// every mast to the Arc Generator and on to the pedestal.

const C = 0.0625
/** Mast height in voxels (to the tip of the prongs). */
const MAST_H = 92
const BLUE = 0x9fd0ff

interface Rod {
    s: DfSpot
    g: THREE.Group
    lever: THREE.Group
    mat: DfVoxMaterial
    spring: DfSpring
    on: boolean
    /** 0..1 how charged the mast looks (eases to `on`). */
    charge: number
    /** Seconds until the next idle spark / live crackle. */
    nextT: number
    top: THREE.Vector3
    base: THREE.Vector3
    sputter: number
    /** Seconds the snapshot has disagreed with what is shown (events normally lead). */
    mismatch: number
}

function mastModel(): DfVoxModel {
    const m = new DfVoxModel(11, MAST_H, 11)
    const stone = m.shade(0x7d776e, 0.07, 41)
    const iron = m.shade(0x34363a, 0.06, 42)
    const porcelain = m.c(0xe6e0d2, 0.25)
    const copper = m.shade(0x9a5a2c, 0.08, 43)
    const glass = m.c(0xbfe6ff, 1)
    // Stone footing with an iron collar.
    m.box(0, 0, 0, 11, 4, 11, stone).box(1, 4, 1, 10, 6, 10, iron)
    // The mast: a 3-voxel iron pole with porcelain insulator bands.
    m.box(4, 6, 4, 7, 80, 7, iron)
    for (let j = 14; j < 78; j += 13) m.box(3, j, 3, 8, j + 2, 8, porcelain)
    // Guy-wire lugs.
    for (const [i, k] of [[2, 5], [8, 5], [5, 2], [5, 8]] as const) m.set(i, 70, k, iron(i, 70, k))
    // Copper crown: a ring, three prongs, and the glass ball that lights up.
    m.box(3, 80, 3, 8, 81, 8, copper)
    m.box(4, 81, 4, 7, 84, 7, glass)
    m.box(5, 84, 5, 6, 92, 6, copper)
    for (const [i, k] of [[3, 3], [7, 3], [3, 7], [7, 7]] as const) m.box(i, 81, k, i + 1, 88, k + 1, copper)
    return m
}

function switchModel(): DfVoxModel {
    // A post with a slate panel, two porcelain contact jaws on top.
    const m = new DfVoxModel(6, 18, 3)
    const wood = m.shade(0x4e3a26, 0.07, 44)
    m.box(2, 0, 1, 4, 12, 2, wood)
    m.box(0, 10, 0, 6, 18, 2, m.c(0x2c2f33))
    m.box(1, 16, 2, 2, 18, 3, m.c(0xe6e0d2, 0.2)).box(4, 16, 2, 5, 18, 3, m.c(0xe6e0d2, 0.2))
    m.box(1, 11, 2, 5, 12, 3, m.c(0xa58236))
    return m
}

function leverModel(): DfVoxModel {
    // The knife blade and its insulated handle, pivoting at the bottom.
    const m = new DfVoxModel(4, 9, 2)
    m.box(1, 0, 0, 3, 6, 1, m.c(0x9a5a2c))
    m.box(0, 6, 0, 4, 9, 2, m.c(0x6a1a12))
    return m
}

export function createDfRods(kit: DfWorldKit): DfWorldPart {
    const { map, ctx } = kit
    const rodsSpots = map.egg.rods ?? []
    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const shadow = kit.shadows
    const mastGeo = mastModel().mesh(C, [5.5, 0, 5.5])!
    const switchGeo = switchModel().mesh(C, [3, 0, 1.5])!
    const leverGeo = leverModel().mesh(C, [2, 0, 1])!
    geos.push(mastGeo, switchGeo, leverGeo)

    const rods: Rod[] = rodsSpots.map((s) => {
        const g = new THREE.Group()
        g.position.set(s.pos.x, s.pos.y, s.pos.z)
        g.rotation.y = s.yaw
        kit.root.add(g)
        const mat = dfVoxMaterial({ glow: 0.04 })
        mats.push(mat)
        const mast = new THREE.Mesh(mastGeo, mat)
        mast.castShadow = shadow
        mast.receiveShadow = shadow
        g.add(mast)
        // The switch stands just in front of the footing, facing the approach.
        const sw = new THREE.Mesh(switchGeo, kit.mat)
        sw.position.set(0.25, 0, 0.55)
        sw.castShadow = shadow
        g.add(sw)
        const lever = new THREE.Group()
        lever.position.set(0.25, 11.5 * C, 0.55 + 2 * C)
        g.add(lever)
        const lm = new THREE.Mesh(leverGeo, mat)
        lm.castShadow = shadow
        lever.add(lm)
        g.updateMatrixWorld(true)
        return {
            s, g, lever, mat, spring: new DfSpring(140, 11), on: false, charge: 0, nextT: Math.random() * 2, sputter: 0, mismatch: 0,
            top: g.localToWorld(new THREE.Vector3(0, 82.5 * C, 0)),
            base: g.localToWorld(new THREE.Vector3(0.25, 0.9, 0.62))
        }
    })

    const genTop = new THREE.Vector3(map.egg.generator.pos.x, map.egg.generator.pos.y + 2.2, map.egg.generator.pos.z)
    const pedTop = new THREE.Vector3(map.egg.pedestal.pos.x, map.egg.pedestal.pos.y + 1.5, map.egg.pedestal.pos.z)
    const sky = new THREE.Vector3()
    const tmp = new THREE.Vector3()
    let allOn = false
    /** Seconds into the all-rods payoff (-1 = not running). */
    let payoff = -1
    let payoffStep = 0

    const throwRod = (r: Rod, on: boolean, loud: boolean) => {
        if (r.on === on) return
        r.on = on
        r.spring.kick(on ? -14 : 10)
        if (!loud) return
        if (on) {
            kit.play(DF_WORLD_SOUNDS.rodLever, r.base, 1)
            kit.play(DF_WORLD_SOUNDS.rodCrackle, r.top, 1.1)
            ctx.fx.burst('sparks', r.base, { count: 24 })
            ctx.fx.burst('electric', r.base, { count: 10 })
            // A bright bolt straight up into the sky.
            sky.set(r.top.x + (Math.random() - 0.5) * 6, r.top.y + 26, r.top.z + (Math.random() - 0.5) * 6)
            ctx.fx.lightning(r.top, sky, 0xcfe8ff)
            ctx.fx.flash(r.top, BLUE, 10, 0.45)
            ctx.fx.shake(0.04)
            r.nextT = 0.25
        } else {
            r.sputter = 1
            kit.play(DF_WORLD_SOUNDS.rodSputter, r.base, 1)
            ctx.fx.burst('electric', r.top, { count: 8, scale: 0.6 })
            ctx.fx.burst('smoke', r.top, { count: 2, scale: 0.4 })
        }
    }

    return {
        update(dt, world, time) {
            const egg = world.egg
            const active = egg.step === 'rods'
            const rodsOn = egg.rodsOn ?? []
            let lit = 0
            for (const r of rods) {
                // Follow the snapshot too (joining mid-step, missed events), quietly and only
                // once it has disagreed for a moment, so the event plays the loud version.
                const want = rodsOn.includes(r.s.id)
                r.mismatch = want !== r.on ? r.mismatch + dt : 0
                if (r.mismatch > 0.5) throwRod(r, want, false)
                if (r.on) lit++
                r.charge = damp(r.charge, r.on ? 1 : 0, r.on ? 6 : 2.5, dt)
                r.sputter = Math.max(0, r.sputter - dt * 1.5)
                const target = r.on ? 1.15 : -0.75
                r.lever.rotation.x = target + r.spring.update(dt, 0) * 0.08
                // Glow: dark when inert, a slow pulse while the step runs, blazing when live, flicker as it dies.
                const idle = active ? 0.35 + 0.25 * Math.sin(time * 3 + r.s.pos.x) : 0.04
                const die = r.sputter > 0 ? (Math.sin(time * 47) > 0 ? r.sputter * 2 : 0) : 0
                r.mat.userData.uGlow.value = idle * (1 - r.charge) + r.charge * (2.4 + Math.sin(time * 23) * 0.5) + die
                r.nextT -= dt
                if (r.on && r.nextT <= 0) {
                    // Live: short arcs crawling off the crown, now and then one up into the sky.
                    r.nextT = 0.35 + Math.random() * 0.6
                    if (Math.random() < 0.3) {
                        sky.set(r.top.x + (Math.random() - 0.5) * 10, r.top.y + 18 + Math.random() * 10, r.top.z + (Math.random() - 0.5) * 10)
                        ctx.fx.lightning(r.top, sky, 0xcfe8ff)
                        if (Math.random() < 0.5) kit.play(DF_WORLD_SOUNDS.rodCrackle, r.top, 0.7, 0.9 + Math.random() * 0.3)
                    } else {
                        const a = Math.random() * Math.PI * 2
                        tmp.set(r.top.x + Math.cos(a) * 1.4, r.top.y - 0.6 - Math.random() * 1.6, r.top.z + Math.sin(a) * 1.4)
                        ctx.fx.lightning(r.top, tmp, BLUE)
                        if (Math.random() < 0.35) kit.play(DF_WORLD_SOUNDS.zap, r.top, 0.5)
                    }
                } else if (!r.on && active && r.nextT <= 0) {
                    // Waiting: faint ticks of static at the crown.
                    r.nextT = 1.2 + Math.random() * 2.2
                    ctx.fx.burst('electric', r.top, { count: 3, scale: 0.35 })
                    if (Math.random() < 0.3) kit.play(DF_WORLD_SOUNDS.zap, r.top, 0.2, 1.4)
                }
            }
            // All three live: the payoff, bolts from every mast to the generator, then on to the pedestal.
            const nowAll = rods.length > 0 && lit === rods.length
            if (nowAll && !allOn) {
                payoff = 0
                payoffStep = 0
                kit.play(DF_WORLD_SOUNDS.rodThunder, undefined, 1)
                ctx.fx.shake(0.25)
            }
            allOn = nowAll
            if (payoff >= 0) {
                payoff += dt
                // Three volleys over ~1.6 s, then the generator throws one to the pedestal.
                while (payoffStep < 4 && payoff >= payoffStep * 0.45) {
                    if (payoffStep < 3) {
                        for (const r of rods) {
                            ctx.fx.lightning(r.top, genTop, payoffStep === 1 ? 0xffffff : 0xcfe8ff)
                            ctx.fx.flash(r.top, BLUE, 12, 0.35)
                        }
                        ctx.fx.flash(genTop, BLUE, 16, 0.5)
                        ctx.fx.burst('electric', genTop, { count: 24, scale: 1.4 })
                        kit.play(DF_WORLD_SOUNDS.zap, genTop, 1, 0.8)
                    } else {
                        ctx.fx.lightning(genTop, pedTop, 0xffffff)
                        ctx.fx.flash(pedTop, BLUE, 14, 0.6)
                        ctx.fx.burst('electric', pedTop, { count: 30, scale: 1.2 })
                        ctx.fx.burst('sparks', pedTop, { count: 30 })
                        kit.play(DF_WORLD_SOUNDS.rodCrackle, pedTop, 1)
                    }
                    payoffStep++
                }
                if (payoff > 2.5) payoff = -1
            }
        },
        onEvent(ev) {
            if (ev.k !== 'rod') return
            const r = rods.find(x => x.s.id === ev.id)
            if (r) throwRod(r, ev.on, true)
        },
        dispose() {
            for (const r of rods) r.g.removeFromParent()
            for (const g of geos) g.dispose()
            for (const m of mats) m.dispose()
        }
    }
}
