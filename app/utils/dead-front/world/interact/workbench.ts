import * as THREE from 'three'
import { DF_BENCH_SIZE } from '#shared/utils/dead-front/map-benches'
import { DF_CRAFT_ORDER, DF_RECIPES, dfCraftBlocked } from '#shared/utils/dead-front/salvage'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from '../../engine/arsenal-sounds'
import { dfVoxMaterial } from '../../voxel/material'
import type { DfVoxMaterial } from '../../voxel/material'
import { DfVoxModel } from '../../voxel/model'
import type { DfWorldKit, DfWorldPart } from '../kit'
import { DfSpring, damp } from '../util'

// The workbenches (map.benches): a heavy trestle bench against the wall with a
// vice, a hand drill and a scatter of tools and scrap, a shaded oil lamp, and
// a slate board above it chalked with what the bench can make (a sentry, a
// gramophone, a field kit, a bomber, a grenade launcher). A brass signal lamp
// on the board burns green while your salvage pays for something, amber when it
// doesn't. Crafting swings the hammer, throws sparks and rings the bench.

const C = 0.0625
/** The chalk board's finer cell (its five drawings span the bench). */
const CB = 0.034
const GREEN = new THREE.Color(0.35, 1, 0.4)
const AMBER = new THREE.Color(1, 0.62, 0.18)

/** Chalk drawings, 9 x 7 each (`#` = chalk), in craft-list order. */
const ICONS: Record<string, readonly string[]> = {
    sentry: ['.........', '..####...', '#######..', '..####.##', '...#.....', '..#.#....', '.#...#...'],
    decoy: ['......###', '.....##.#', '....##...', '...##....', '.###.....', '#####....', '#####....'],
    kit: ['.........', '..#####..', '..##.##..', '..#...#..', '..##.##..', '..#####..', '.........'],
    bomber: ['#########', '....#....', '#########', '..#.#.#..', '.........', '..#.#.#..', '.........'],
    launcher: ['.........', '.##......', '#######..', '#########', '..###..##', '..#......', '.........']
}

function benchModel(): DfVoxModel {
    // 30 x 15 x 12: top at j 13..15, legs, a stretcher shelf, a vice at the right end.
    const m = new DfVoxModel(30, 18, 12)
    const top = m.shade(0x7b5737, 0.08, 71)
    const dark = m.shade(0x4b3521, 0.06, 72)
    const iron = m.shade(0x3a3c40, 0.05, 73)
    const rust = m.shade(0x7b4b2b, 0.12, 74)
    const brass = m.c(0xa58236)
    // the worktop, scarred planks with dark seams
    m.box(0, 13, 0, 30, 15, 12, (i, j, k) => (k % 4 === 3 ? dark(i, j, k) : top(i, j, k)))
    // legs and stretchers
    for (const i of [1, 27]) for (const k of [1, 9]) m.box(i, 0, k, i + 2, 13, k + 2, dark)
    m.box(1, 3, 1, 29, 4, 11, top)
    m.box(3, 10, 0, 27, 13, 1, dark)
    // under the shelf: a crate and a coil of wire
    m.box(4, 4, 2, 11, 9, 9, m.shade(0x9a7a52, 0.1, 75))
    m.box(4, 6, 2, 11, 7, 9, dark)
    m.box(18, 4, 3, 24, 6, 9, rust)
    // the vice on the right front corner
    m.box(25, 15, 7, 29, 17, 12, iron)
    m.box(26, 17, 9, 28, 18, 12, iron)
    m.box(27, 15, 11, 28, 16, 12, brass)
    // tools on the top: a wrench, a saw, nuts and plates of scrap
    m.box(4, 15, 7, 11, 16, 8, iron)
    m.box(3, 15, 6, 5, 16, 9, iron)
    m.box(13, 15, 2, 22, 16, 5, m.c(0x8d9096))
    m.box(13, 15, 5, 15, 16, 6, dark)
    for (const [i, k] of [[16, 8], [18, 9], [20, 7], [17, 10]] as const) m.box(i, 15, k, i + 1, 16, k + 1, rust)
    m.box(6, 15, 2, 9, 16, 4, rust)
    return m
}

function hammerModel(): DfVoxModel {
    // handle along +y, the head at the top; pivots at the bottom of the handle
    const m = new DfVoxModel(4, 9, 2)
    m.box(1, 0, 0, 2, 7, 1, m.c(0x6b4a2f))
    m.box(0, 7, 0, 4, 9, 2, m.c(0x34363a))
    return m
}

function lampModel(): DfVoxModel {
    // a brass oil lamp with a glowing chimney
    const m = new DfVoxModel(4, 7, 4)
    m.box(0, 0, 0, 4, 2, 4, m.c(0xa58236))
    m.box(1, 2, 1, 3, 6, 3, m.c(0xffc66a, 1.1))
    m.box(1, 6, 1, 3, 7, 3, m.c(0x2b2c2f))
    return m
}

function boardModel(): DfVoxModel {
    // a slate board in a wooden frame with the five chalk drawings
    const W = 5 * 10 + 2
    const H = 12
    const m = new DfVoxModel(W, H, 2)
    const frame = m.shade(0x5a3f26, 0.08, 76)
    const slate = m.shade(0x2a2f33, 0.05, 77)
    const chalk = m.c(0xe9e4d6, 0.35)
    m.box(0, 0, 0, W, H, 1, frame)
    m.box(1, 1, 1, W - 1, H - 1, 2, slate)
    m.box(0, 0, 1, W, 1, 2, frame).box(0, H - 1, 1, W, H, 2, frame)
    m.box(0, 0, 1, 1, H, 2, frame).box(W - 1, 0, 1, W, H, 2, frame)
    DF_CRAFT_ORDER.forEach((id, n) => {
        const rows = ICONS[id] ?? []
        rows.forEach((row, r) => {
            for (let c = 0; c < row.length; c++) if (row[c] === '#') m.set(1 + n * 10 + c, H - 3 - r, 1, chalk)
        })
        // a tally of the cost underneath
        for (let t = 0; t < Math.min(8, Math.ceil(DF_RECIPES[id].scrap / 2)); t++) m.set(2 + n * 10 + t, 1 + (t % 2), 1, chalk)
    })
    return m
}

function signalModel(): DfVoxModel {
    const m = new DfVoxModel(3, 3, 3)
    m.box(0, 0, 0, 3, 1, 3, m.c(0xa58236))
    m.box(1, 1, 1, 2, 3, 2, m.c(0xffffff, 1))
    return m
}

interface Bench {
    id: string
    group: THREE.Group
    hammer: THREE.Group
    spring: DfSpring
    swing: number
    top: THREE.Vector3
    baseY: number
    lamp: DfVoxMaterial
    ok: number
    /** Seconds into the swing at which the next blows throw sparks. */
    sparks: number[]
}

export function createDfWorkbenches(kit: DfWorldKit): DfWorldPart {
    const { map, ctx } = kit
    registerDfArsenalSounds(ctx.audio)
    const shadow = kit.shadows
    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const objs: THREE.Object3D[] = []
    const benchGeo = benchModel().mesh(C, [15, 0, 6])!
    const hammerGeo = hammerModel().mesh(C, [2, 0, 1])!
    const lampGeo = lampModel().mesh(C, [2, 0, 2])!
    const boardGeo = boardModel().mesh(CB, [26, 0, 0])!
    const sigGeo = signalModel().mesh(C, [1.5, 0, 1.5])!
    geos.push(benchGeo, hammerGeo, lampGeo, boardGeo, sigGeo)
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = shadow) => {
        const o = new THREE.Mesh(geo, mat)
        o.castShadow = cast
        o.receiveShadow = shadow
        return o
    }

    const benches: Bench[] = (map.benches ?? []).map((b) => {
        const g = new THREE.Group()
        g.position.set(b.pos.x, b.pos.y, b.pos.z)
        g.rotation.y = b.yaw
        kit.root.add(g)
        objs.push(g)
        const halfD = DF_BENCH_SIZE.depth / 2
        const body = mesh(benchGeo, kit.mat)
        g.add(body)
        const lampM = mesh(lampGeo, kit.mat, false)
        lampM.position.set(-0.7, 15 * C, -0.15)
        g.add(lampM)
        const board = mesh(boardGeo, kit.mat, false)
        board.position.set(0, 1.12, -halfD)
        g.add(board)
        const sig = dfVoxMaterial({ glow: 0 })
        mats.push(sig)
        const sigM = mesh(sigGeo, sig, false)
        sigM.position.set(0.8, 1.12 + 12 * CB, -halfD + 0.04)
        g.add(sigM)
        // the hammer lies on the top; crafting picks it up and swings it
        const hammer = new THREE.Group()
        hammer.position.set(0.3, 15 * C, 0.18)
        hammer.rotation.set(-Math.PI / 2, 0, 0.4)
        hammer.add(mesh(hammerGeo, kit.mat, false))
        g.add(hammer)
        g.updateMatrixWorld(true)
        const top = g.localToWorld(new THREE.Vector3(0.6, 15 * C + 0.05, 0.1))
        return { id: b.id, group: g, hammer, spring: new DfSpring(120, 9), swing: 0, top, baseY: b.pos.y, lamp: sig, ok: 0, sparks: [] }
    })

    return {
        update(dt, world, time) {
            const ars = world.arsenal
            const pool = { scrap: ars?.scrap ?? 0, parts: ars?.parts ?? 0 }
            // you can make something: anything your salvage pays for (full hands aside)
            const affordable = DF_CRAFT_ORDER.some((id) => {
                const b = dfCraftBlocked(DF_RECIPES[id], pool, { equip: null, kit: false, rewards: 0, rewardsMax: 1 })
                return b === null
            })
            for (const b of benches) {
                b.ok = damp(b.ok, affordable ? 1 : 0, 3, dt)
                const pulse = 0.85 + 0.15 * Math.sin(time * (affordable ? 3.2 : 1.4) + b.top.x)
                b.lamp.color.copy(AMBER).lerp(GREEN, b.ok)
                b.lamp.userData.uGlow.value = (0.9 + b.ok * 1.3) * pulse
                // the hammer: up, three blows, back down
                if (b.swing > 0) {
                    b.swing = Math.max(0, b.swing - dt)
                    const u = 1 - b.swing / 1.1
                    if (b.sparks.length && 1.1 - b.swing >= b.sparks[0]!) {
                        b.sparks.shift()
                        ctx.fx.burst('sparks', b.top, { count: 10 })
                    }
                    const blow = Math.abs(Math.sin(u * Math.PI * 3))
                    b.hammer.rotation.set(-Math.PI / 2 + 0.9 + blow * 0.9, 0, 0.4)
                    b.hammer.position.y = 15 * C + 0.12 + blow * 0.1
                } else {
                    b.hammer.rotation.set(-Math.PI / 2, 0, 0.4)
                    b.hammer.position.y = 15 * C
                }
                b.group.position.y = b.baseY + b.spring.update(dt, 0) * 0.004
            }
        },
        onEvent(ev) {
            if (ev.k !== 'craft') return
            const b = benches.find(x => x.id === ev.bench)
            if (!b) return
            b.swing = 1.1
            b.spring.kick(-6)
            kit.play(DF_ARSENAL_SND.craft, b.top, 1)
            ctx.fx.burst('sparks', b.top, { count: 18 })
            ctx.fx.flash(b.top, 0xffb060, 4, 0.25)
            b.sparks = [0.22, 0.42]
        },
        dispose() {
            for (const o of objs) o.removeFromParent()
            for (const g of geos) g.dispose()
            for (const m of mats) m.dispose()
        }
    }
}
