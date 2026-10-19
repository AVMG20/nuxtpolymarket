import * as THREE from 'three'
import type { DfLight } from '#shared/utils/dead-front/map'
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import { dfRaycast } from '#shared/utils/dead-front/physics'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'
import { damp, dfFlicker, dfPowerLevel, dfRng } from './util'

// Lanterns, candles, braziers, bulbs and arc lamps. Every map light gets a
// voxel fixture (instanced per kind, flicker through the instance colour) and
// flames made of glowing cubes; a fixed pool of real point lights (never added
// or removed at runtime, so no shader recompiles) follows the fixtures that
// matter most around the camera, with crossfades.

const CANDLE = '#ff9a45'
const FIRE = '#ff7a2e'
const ARC = '#cfe0ff'
/**
 * Map intensity -> candela. The pool lights fall off linearly (decay 1) so a
 * lantern throws a wide warm pool on the ground instead of a hot spot on the
 * nearest wall: about 2.5x the moonlit floor right under it, matching the
 * night 4 m out.
 */
const K = 6
const DECAY = 1

type FixtureKind = 'candle' | 'lantern' | 'fire' | 'bulb' | 'arc'

function kindOf(l: DfLight): FixtureKind {
    if (l.color === FIRE) return 'fire'
    if (l.color === CANDLE) return 'candle'
    if (l.color === ARC) return 'arc'
    if (l.power) return 'bulb'
    return 'lantern'
}

interface Fixture {
    light: DfLight
    kind: FixtureKind
    color: THREE.Color
    seed: number
    level: number
    /** Seconds after the switch before the surge reaches this fixture. */
    delay: number
    score: number
    inst: number
    flames: number[]
    flameBase: THREE.Vector3[]
    /** Electric trap id: lit only while that trap runs. */
    trap?: string
}

interface Slot {
    light: THREE.PointLight
    fixture: number
    weight: number
    wanted: boolean
}

const C = 0.0625

function lanternModel(): DfVoxModel {
    const m = new DfVoxModel(4, 6, 4)
    const iron = m.c(0x26262a)
    const glass = m.c(0xffc27a, 1)
    m.box(0, 0, 0, 4, 1, 4, iron).box(0, 1, 0, 4, 5, 4, glass).box(0, 5, 0, 4, 6, 4, iron)
    m.vox.map((_v, i, j, k) => (j > 0 && j < 5 && (i === 0 || i === 3) && (k === 0 || k === 3) ? iron : -1))
    return m
}

function candleModel(): DfVoxModel {
    const m = new DfVoxModel(5, 5, 5)
    const wax = m.c(0xd8cfb4)
    m.box(0, 0, 1, 1, 3, 2, wax).box(2, 0, 2, 3, 5, 3, wax).box(4, 0, 0, 5, 2, 1, wax).box(1, 0, 4, 2, 4, 5, wax)
    return m
}

function brazierModel(): DfVoxModel {
    const m = new DfVoxModel(8, 6, 8)
    const iron = m.c(0x2a2724)
    const ember = m.c(0xff6a20, 1)
    m.vox.cylinder(4, 4, 4, 2, 6, iron)
    m.vox.cylinder(4, 4, 3, 3, 6, 0)
    m.vox.cylinder(4, 4, 3, 3, 4, ember)
    m.box(1, 0, 1, 2, 2, 2, iron).box(6, 0, 1, 7, 2, 2, iron).box(1, 0, 6, 2, 2, 7, iron).box(6, 0, 6, 7, 2, 7, iron)
    return m
}

function bulbModel(): DfVoxModel {
    const m = new DfVoxModel(6, 4, 6)
    const shade = m.c(0x2a3a2c)
    const bulb = m.c(0xffe2b0, 1)
    m.box(0, 2, 0, 6, 3, 6, shade).box(1, 3, 1, 5, 4, 5, shade)
    m.box(2, 0, 2, 4, 2, 4, bulb)
    return m
}

function arcModel(): DfVoxModel {
    const m = new DfVoxModel(8, 7, 8)
    const steel = m.c(0x2b2e33)
    const lens = m.c(0xdbe8ff, 1)
    m.box(0, 1, 0, 8, 7, 8, steel).box(1, 0, 1, 7, 1, 7, lens)
    m.box(1, 1, 1, 7, 2, 7, lens)
    m.box(3, 7 - 1, 3, 5, 7, 5, steel)
    return m
}

export function createDfLights(kit: DfWorldKit): DfWorldPart {
    const { root, ctx } = kit
    const high = kit.quality === 'high'
    const rnd = dfRng(4)
    const geos: THREE.BufferGeometry[] = []
    const meshes: THREE.InstancedMesh[] = []
    const lampposts = kit.world.props.filter(p => p.kind === 'lamppost')

    const models: Record<FixtureKind, { geo: THREE.BufferGeometry, y: number }> = {
        lantern: { geo: lanternModel().mesh(C, [2, 3, 2])!, y: 0 },
        candle: { geo: candleModel().mesh(C, [2.5, 0, 2.5])!, y: -0.12 },
        fire: { geo: brazierModel().mesh(C, [4, 6, 4])!, y: -0.15 },
        bulb: { geo: bulbModel().mesh(C, [3, 1, 3])!, y: 0 },
        arc: { geo: arcModel().mesh(C, [4, 3, 4])!, y: 0 }
    }
    for (const m of Object.values(models)) geos.push(m.geo)
    const unit = new DfVoxModel(1, 1, 1)
    unit.box(0, 0, 0, 1, 1, 1, unit.c(0x2a2a2d))
    const barGeo = unit.mesh(1, [0.5, 0.5, 0.5])!
    geos.push(barGeo)
    const flameModel = new DfVoxModel(1, 1, 1)
    flameModel.box(0, 0, 0, 1, 1, 1, flameModel.c(0xffa64d, 1))
    const flameGeo = flameModel.mesh(1, [0.5, 0, 0.5])!
    geos.push(flameGeo)

    const fixtures: Fixture[] = []
    const bars: THREE.Matrix4[] = []
    const byKind: Record<FixtureKind, Fixture[]> = { lantern: [], candle: [], fire: [], bulb: [], arc: [] }
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const v3 = new THREE.Vector3()
    const s3 = new THREE.Vector3()
    const bar = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
        bars.push(new THREE.Matrix4().compose(v3.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q.identity(), s3.set(Math.max(0.05, Math.abs(x1 - x0)), Math.max(0.05, Math.abs(y1 - y0)), Math.max(0.05, Math.abs(z1 - z0)))))
    }
    let flameCount = 0
    // Machine glows join the pool as virtual fixtures (no lamp model): each perk
    // cabinet throws a pool of its colour on the floor, the press a violet one.
    const virtual: DfLight[] = []
    for (const pm of kit.map.perks) {
        const fx = Math.sin(pm.yaw)
        const fz = Math.cos(pm.yaw)
        virtual.push({ pos: { x: pm.pos.x - fx * 0.2, y: pm.pos.y + 1.5, z: pm.pos.z - fz * 0.2 }, color: DF_PERKS[pm.perk]?.color ?? '#ffffff', intensity: 0.45, distance: 5, power: true })
    }
    {
        const s = kit.map.pap
        virtual.push({ pos: { x: s.pos.x + Math.sin(s.yaw) * 0.9, y: s.pos.y + 1.6, z: s.pos.z + Math.cos(s.yaw) * 0.9 }, color: '#a45cff', intensity: 0.42, distance: 5.5, power: true })
    }
    // Electric traps: a cold blue pool over the passage, only while the trap runs.
    const trapOf = new Map<DfLight, string>()
    for (const t of kit.map.traps ?? []) {
        const a = t.area
        const l: DfLight = { pos: { x: (a.min.x + a.max.x) / 2, y: a.min.y + 2.1, z: (a.min.z + a.max.z) / 2 }, color: '#9fd0ff', intensity: 0.9, distance: 8 }
        virtual.push(l)
        trapOf.set(l, t.id)
    }
    const trapLive = new Set<string>()
    const virtualSet = new Set(virtual)
    for (const l of [...kit.map.lights, ...virtual]) {
        const kind = kindOf(l)
        const onPost = virtualSet.has(l) || lampposts.some(p => Math.hypot(p.x - l.pos.x, p.z - l.pos.z) < 0.7)
        const trap = trapOf.get(l)
        const f: Fixture = { light: l, kind, color: new THREE.Color(l.color), seed: rnd() * 100, level: l.power || trap ? 0 : 1, delay: kit.powerDelay(l.pos.x, l.pos.z), score: 0, inst: onPost ? -1 : byKind[kind].length, flames: [], flameBase: [], trap }
        if (!onPost) {
            byKind[kind].push(f)
            const o = l.pos
            // Mounting: an iron bracket to a close wall, a cord to a low ceiling, or a pole to the floor.
            let wall: { x: number, z: number, d: number } | null = null
            if (kind === 'lantern' || kind === 'arc') {
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                    const hit = dfRaycast(kit.collision, { x: o.x, y: o.y + 0.25, z: o.z }, { x: dx, y: 0, z: dz }, 1.2)
                    if (hit && (!wall || hit.dist < wall.d)) wall = { x: dx, z: dz, d: hit.dist }
                }
            }
            const upHit = dfRaycast(kit.collision, o, { x: 0, y: 1, z: 0 }, 6)
            const downHit = dfRaycast(kit.collision, o, { x: 0, y: -1, z: 0 }, 6)
            if (kind === 'lantern' && wall) {
                bar(o.x, o.y + 0.25, o.z, o.x + wall.x * wall.d, o.y + 0.3, o.z + wall.z * wall.d)
                bar(o.x - 0.03, o.y + 0.18, o.z - 0.03, o.x + 0.03, o.y + 0.3, o.z + 0.03)
            } else if ((kind === 'lantern' || kind === 'bulb') && upHit && upHit.dist < 3) {
                bar(o.x - 0.025, o.y + 0.2, o.z - 0.025, o.x + 0.025, o.y + upHit.dist, o.z + 0.025)
            } else if ((kind === 'candle' || kind === 'lantern') && downHit && downHit.dist > 0.3 && downHit.dist < 3) {
                bar(o.x - 0.04, o.y - downHit.dist, o.z - 0.04, o.x + 0.04, o.y - (kind === 'candle' ? 0.12 : 0.2), o.z + 0.04)
                bar(o.x - 0.15, o.y - downHit.dist, o.z - 0.15, o.x + 0.15, o.y - downHit.dist + 0.06, o.z + 0.15)
            }
            // Flames: glowing cubes that dance.
            const flamePts: [number, number, number][] = kind === 'candle'
                ? [[-0.09, 0.07, -0.03], [0.03, 0.2, 0.03], [0.16, 0.0, -0.09], [-0.03, 0.13, 0.16]]
                : kind === 'fire' ? [[0, 0, 0], [0.12, 0, 0.06], [-0.1, 0, -0.08], [0.04, 0.12, -0.1], [-0.06, 0.18, 0.06]] : []
            for (const p of flamePts) {
                f.flames.push(flameCount++)
                f.flameBase.push(new THREE.Vector3(o.x + p[0], o.y + models[kind].y + p[1] + (kind === 'candle' ? 0.02 : 0), o.z + p[2]))
            }
        }
        fixtures.push(f)
    }
    const add = (inst: THREE.InstancedMesh) => {
        inst.frustumCulled = false
        inst.castShadow = false
        inst.receiveShadow = false
        root.add(inst)
        meshes.push(inst)
    }
    const kindMeshes: Partial<Record<FixtureKind, THREE.InstancedMesh>> = {}
    for (const kind of Object.keys(byKind) as FixtureKind[]) {
        const list = byKind[kind]
        if (!list.length) continue
        const inst = new THREE.InstancedMesh(models[kind].geo, kit.mat, list.length)
        list.forEach((f, i) => {
            inst.setMatrixAt(i, m4.makeTranslation(f.light.pos.x, f.light.pos.y + models[kind].y, f.light.pos.z))
            inst.setColorAt(i, new THREE.Color(1, 1, 1))
        })
        inst.name = `df-fixtures-${kind}`
        add(inst)
        kindMeshes[kind] = inst
    }
    if (bars.length) {
        const inst = new THREE.InstancedMesh(barGeo, kit.mat, bars.length)
        bars.forEach((b, i) => inst.setMatrixAt(i, b))
        add(inst)
    }
    const flames = flameCount ? new THREE.InstancedMesh(flameGeo, kit.mat, flameCount) : null
    if (flames) {
        flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        for (let i = 0; i < flameCount; i++) flames.setColorAt(i, new THREE.Color(1, 1, 1))
        add(flames)
    }

    // Pool of real lights. Each costs every lit fragment, so keep it small.
    const poolSize = high ? 8 : 4
    const slots: Slot[] = []
    for (let i = 0; i < poolSize; i++) {
        const pl = new THREE.PointLight(0xffffff, 0, 10, DECAY)
        pl.castShadow = false
        pl.position.set(0, -50, 0)
        root.add(pl)
        slots.push({ light: pl, fixture: -1, weight: 0, wanted: false })
    }
    let reassign = 0
    const camPos = new THREE.Vector3()
    const assign = () => {
        camPos.copy(ctx.camera.position)
        for (const f of fixtures) {
            const p = f.light.pos
            const d2 = (p.x - camPos.x) ** 2 + (p.y - camPos.y) ** 2 + (p.z - camPos.z) ** 2
            const reach = f.light.distance
            const strength = f.trap
                ? (trapLive.has(f.trap) ? f.light.intensity : 0)
                : f.light.intensity * (f.light.power ? (kit.state.powerOn && kit.state.powerAge >= f.delay ? 1 : 0) : 1)
            f.score = strength <= 0.01 ? 0 : strength * reach * reach / (d2 + 9)
            if (d2 > (reach + 22) ** 2) f.score *= 0.05
        }
        const order = fixtures.map((_, i) => i).filter(i => fixtures[i]!.score > 0.02).sort((a, b) => fixtures[b]!.score - fixtures[a]!.score)
        const wanted = new Set(order.slice(0, poolSize))
        for (const s of slots) s.wanted = s.fixture >= 0 && wanted.has(s.fixture)
        for (const fi of wanted) {
            if (slots.some(s => s.fixture === fi)) continue
            const free = slots.find(s => s.fixture < 0) ?? slots.find(s => !s.wanted && s.weight < 0.05)
            if (!free) continue
            const l = fixtures[fi]!.light
            free.fixture = fi
            free.weight = 0
            free.wanted = true
            free.light.position.set(l.pos.x, l.pos.y - (fixtures[fi]!.kind === 'arc' ? 0.4 : 0), l.pos.z)
            free.light.color.copy(fixtures[fi]!.color)
            free.light.distance = l.distance
        }
    }

    const tint = new THREE.Color()
    return {
        update(dt, world, time) {
            trapLive.clear()
            for (const t of world.traps ?? []) if (t.state === 'active') trapLive.add(t.id)
            reassign -= dt
            if (reassign <= 0) {
                assign()
                reassign = 0.2
            }
            const st = kit.state
            for (const f of fixtures) {
                let level: number
                if (f.trap) {
                    // Live current: a hard, fast stutter.
                    level = trapLive.has(f.trap) ? 0.6 + 0.4 * Math.abs(Math.sin(time * 37 + f.seed) * Math.sin(time * 23)) : 0
                } else if (f.light.power) {
                    // The surge spreads out from the switch: each lamp stutters on as it arrives.
                    level = dfPowerLevel(st.powerOn ? st.powerAge - f.delay : -1, time, f.seed)
                } else {
                    level = f.light.flicker ? dfFlicker(time * (f.kind === 'candle' ? 1.4 : 1), f.seed) : 1
                }
                f.level = level
                const inst = kindMeshes[f.kind]
                if (inst && f.inst >= 0) {
                    const k = 0.25 + Math.max(0.05, level) * 0.85
                    inst.setColorAt(f.inst, tint.setRGB(k, k, k))
                }
                if (flames) {
                    for (let i = 0; i < f.flames.length; i++) {
                        const b = f.flameBase[i]!
                        const w = Math.sin(time * (8 + i) + i * 1.7 + f.seed) * 0.5 + 0.5
                        const big = f.kind === 'fire' ? 0.13 : 0.035
                        const h = big * (1.2 + w * 0.8 * level)
                        m4.compose(v3.set(b.x + Math.sin(time * 5 + i) * 0.01, b.y + (f.kind === 'fire' ? w * 0.05 : 0), b.z), q.setFromAxisAngle(s3.set(0, 1, 0), time * (1 + i * 0.3) + i), s3.set(big * (0.7 + 0.3 * w), h, big * (0.7 + 0.3 * w)))
                        flames.setMatrixAt(f.flames[i]!, m4)
                        tint.setRGB(0.6 + level * 0.6, 0.6 + level * 0.5, 0.6 + level * 0.4)
                        flames.setColorAt(f.flames[i]!, tint)
                    }
                }
            }
            for (const inst of Object.values(kindMeshes)) if (inst.instanceColor) inst.instanceColor.needsUpdate = true
            if (flames) {
                flames.instanceMatrix.needsUpdate = true
                if (flames.instanceColor) flames.instanceColor.needsUpdate = true
            }
            for (const s of slots) {
                s.weight = damp(s.weight, s.wanted ? 1 : 0, s.wanted ? 3 : 5, dt)
                if (!s.wanted && s.weight < 0.01 && s.fixture >= 0) s.fixture = -1
                if (s.fixture < 0) {
                    s.light.intensity = 0
                    continue
                }
                const f = fixtures[s.fixture]!
                s.light.intensity = f.light.intensity * K * f.level * s.weight
            }
        },
        dispose() {
            for (const m of meshes) {
                m.removeFromParent()
                m.dispose()
            }
            for (const g of geos) g.dispose()
            for (const s of slots) s.light.removeFromParent()
        }
    }
}
