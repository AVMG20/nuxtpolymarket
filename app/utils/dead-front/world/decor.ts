import * as THREE from 'three'
import { DF_MAP_P, DF_VOX_CELL, DF_VOX_ORIGIN } from '#shared/utils/dead-front/map-world'
import { dfGroundHeight } from '#shared/utils/dead-front/physics'
import { dfHash3 } from '#shared/utils/dead-front/voxel'
import { dfMergeVoxGeometries } from '../voxel/mesher'
import { dfBuildDecorModel } from './decor-models'
import type { DfDecorKind } from './decor-models'
import type { DfWorldKit, DfWorldPart } from './kit'

// Set dressing that makes each zone its own place: hand-placed furnishings
// (the chapel's rood and banners, the barn's bench and tools, the farmhouse's
// woodpile, café signs and posters in the square, trench stores on the
// ramparts, ossuary niches in the crypt, offerings on the graves), bunting
// over the square, and procedural ground scatter: grass tufts, wild flowers,
// pebbles, brick chips and rain puddles that catch the lantern light.
//
// None of it collides: everything tall stands against a wall or in a corner,
// out of the walking lanes (test/dead-front/world-decor.spec.ts checks it
// against the nav graph). All static, merged into a few chunked meshes.

export interface DfDecorPlacement {
    kind: DfDecorKind
    x: number
    y: number
    z: number
    /** Rotation about +y: local +z (the front) faces (sin yaw, 0, cos yaw). */
    yaw: number
    /** Lean about the local x axis (ladders). */
    tilt?: number
    scale?: number
}

const PI = Math.PI
const N = 0 // wall normal +z
const S = PI // -z
const E = PI / 2 // +x
const W = -PI / 2 // -x

function p(kind: DfDecorKind, x: number, y: number, z: number, yaw = 0, tilt = 0): DfDecorPlacement {
    return { kind, x, y, z, yaw, tilt }
}

/** The hand-placed pieces (pure data, shared with the placement test). */
export function dfDecorPlacements(): DfDecorPlacement[] {
    return [
        // ---------------------------------------------------- chapel
        p('banner', -31.25, 2.0, -40, N),
        p('banner', -27.25, 2.0, -40, N),
        p('banner', -34.75, 2.0, -27, S),
        p('banner', -26.75, 2.0, -27, S),
        p('rood', -39.75, 0.5, -33, E),
        p('altar-cloth', -39, 1.25, -33, N),
        p('candelabra', -35.6, 0.5, -39.55, N),
        p('candelabra', -39.55, 0.5, -27.6, E),
        p('beam', -29.6, 0, -33.2, 0.55),
        p('beam', -27.3, 0, -35.1, 2.1),
        p('wreath', -2, 0.55, -32, N),
        // ---------------------------------------------------- farm: barn, farmhouse, well, field
        p('workbench', -40, 0, 14.3, E),
        p('tool-rack', -33.5, 0.7, 25, S),
        p('sacks', -30.3, 0, 23.75, 0.3),
        p('ladder', -39.4, 0, 21.0, E, -0.2),
        p('bench', -39.0, 0, 29.6, S),
        p('flower-box', -37.5, 2.15, 30, S),
        p('flower-box', -33.5, 2.15, 30, S),
        p('woodpile', -31.65, 0, 30, S),
        p('chop-block', -29.9, 0, 31.4, 0.7),
        p('bucket', -17.4, 1, 17.6, 0.4),
        p('bucket', -29.4, 0, 30.4, 1.1),
        p('trough', -13, 0, 26.6, W),
        p('scarecrow', -38, 0, 10, 1.25),
        // ---------------------------------------------------- the square
        p('poster-a', -12, 1.3, 12.5, E),
        p('poster-b', -12, 1.3, 33, E),
        p('poster-b', 20, 1.3, 12, W),
        p('poster-a', 20, 1.35, 34.6, W),
        p('poster-a', -10, 1.4, 2, N),
        p('poster-b', 16.3, 1.4, 2, N),
        p('sign', -6.6, 2.7, 37, S),
        p('sign', 8.4, 2.7, 37, S),
        p('bench', -11.8, 0, 22.6, E),
        p('ammo-a', -5.3, 0, 26.5, 0.15),
        p('shells', -6.6, 0, 26.35, 0),
        // ---------------------------------------------------- cemetery and crypt
        p('grave-mound', 29.6, 0, -13.6, 0.3),
        p('niches', 23, 0, -34, E),
        p('niches', 29, 0, -34, W),
        p('coffin', 28.2, 0, -33, 0.05),
        // ---------------------------------------------------- ramparts
        p('flag', 40.25, 6.5, -8.6, -0.5),
        p('flag', 40.25, 6.5, 37.6, -0.5),
        p('ammo-a', 39.55, 3, 9.2, W),
        p('ammo-b', 39.55, 3, 10.1, W),
        p('shells', 39.5, 3, 21.2, W),
        p('field-desk', 21, 0, 20, E),
        p('shells', 29.3, 0, 31.7, 0.2),
        p('ammo-b', 30.3, 0, 30.6, 0.9)
    ]
}

/** Bunting strung between the square's lampposts: [from, to, sag]. */
const BUNTING: [[number, number, number], [number, number, number], number][] = [
    [[-8.8, 3.05, 9], [16.8, 3.05, 9], 0.55],
    [[-8.8, 3.05, 34], [16.8, 3.05, 34], 0.55]
]

/** Floor height at a point (props and raised floors count). */
function floorAt(kit: DfWorldKit, x: number, z: number): number {
    return dfGroundHeight(kit.collision, x, z, 2.2)
}

export function createDfDecor(kit: DfWorldKit): DfWorldPart {
    const geoCache = new Map<DfDecorKind, { geo: THREE.BufferGeometry, shadow: boolean } | null>()
    const geoOf = (kind: DfDecorKind) => {
        if (!geoCache.has(kind)) {
            const d = dfBuildDecorModel(kind)
            const geo = d.model.mesh(d.cell, d.pivot, d.opts)
            geoCache.set(kind, geo ? { geo, shadow: d.shadow } : null)
        }
        return geoCache.get(kind)!
    }
    // Chunked buckets so frustum culling still works: [shadowed, scatter] per 24 m cell.
    const CH = 24
    const buckets = new Map<string, { geo: THREE.BufferGeometry, matrix: THREE.Matrix4 }[]>()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const add = (kind: DfDecorKind, x: number, y: number, z: number, yaw: number, tilt = 0, sx = 1, sy = 1, sz = 1, scatter = false) => {
        const g = geoOf(kind)
        if (!g) return
        e.set(tilt, yaw, 0, 'YXZ')
        q.setFromEuler(e)
        const m = new THREE.Matrix4().compose(pos.set(x, y, z), q, scl.set(sx, sy, sz))
        const key = `${scatter || !g.shadow ? 's' : 'd'}:${Math.floor(x / CH)}:${Math.floor(z / CH)}`
        let b = buckets.get(key)
        if (!b) buckets.set(key, b = [])
        b.push({ geo: g.geo, matrix: m })
    }

    // ------------------------------------------------------------ hand-placed
    for (const d of dfDecorPlacements()) add(d.kind, d.x, d.y, d.z, d.yaw, d.tilt ?? 0, d.scale ?? 1, d.scale ?? 1, d.scale ?? 1)

    // Offerings on some of the graves.
    for (const pr of kit.world.props) {
        if (pr.kind !== 'cross' && pr.kind !== 'gravestone') continue
        const h = dfHash3(Math.round(pr.x * 2), 7, Math.round(pr.z * 2), 41)
        const fz = pr.z + 0.42
        if (h < 0.3) add('grave-flowers', pr.x + (h - 0.15), 0, fz, h * 9)
        else if (h < 0.42) add('grave-lantern', pr.x + 0.25, 0, fz - 0.05, h * 7)
        else if (h < 0.52) add('grave-wreath', pr.x, 0, fz, 0)
    }

    // Bunting: pennants every 0.42 m along a sagging cord.
    for (const [a, b, sag] of BUNTING) {
        const dx = b[0] - a[0]
        const dz = b[2] - a[2]
        const len = Math.hypot(dx, dz)
        const yaw = Math.atan2(dx, dz) + PI / 2
        const n = Math.floor(len / 0.42)
        let px = a[0]
        let py = a[1]
        let pz = a[2]
        for (let i = 1; i <= n; i++) {
            const t = i / n
            const x = a[0] + dx * t
            const z = a[2] + dz * t
            const y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t)
            // Cord segment from the previous point.
            const sx = x - px
            const sy = y - py
            const sz = z - pz
            const sl = Math.hypot(sx, sy, sz)
            const g = geoOf('cord')
            if (g) {
                const m = new THREE.Matrix4().lookAt(new THREE.Vector3(px, py, pz), new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0))
                m.multiply(new THREE.Matrix4().makeScale(0.025, 0.025, sl))
                m.setPosition((px + x) / 2, (py + y) / 2, (pz + z) / 2)
                const key = `s:${Math.floor(x / CH)}:${Math.floor(z / CH)}`
                let bk = buckets.get(key)
                if (!bk) buckets.set(key, bk = [])
                bk.push({ geo: g.geo, matrix: m })
            }
            if (i < n) add(`pennant-${i % 3}` as DfDecorKind, x, y - 0.01, z, yaw + (dfHash3(i, 3, 1, 5) - 0.5) * 0.3, (dfHash3(i, 4, 1, 5) - 0.5) * 0.3)
            px = x
            py = y
            pz = z
        }
    }

    // ------------------------------------------------------------ ground scatter
    const P = DF_MAP_P
    const vox = kit.world.vox
    const C = DF_VOX_CELL
    const O = DF_VOX_ORIGIN
    const grass = new Set([P.grass1, P.grass2, P.grass3, P.dgrass])
    const dirt = new Set([P.mud1, P.mud2, P.mud3, P.earth1, P.earth2, P.crater])
    const stones = new Set([P.cobble1, P.cobble2, P.cobble3, P.gutter, P.gravel1, P.gravel2, P.flag1, P.flag2])
    const rubble = new Set([P.rubble1, P.rubble2])
    const puddleCells: [number, number][] = []
    const yard = (x: number, z: number) => (z < -9 && x > -41 && x < 41) // churchyard + cemetery: wild flowers
    for (let k = 1; k < vox.sz - 1; k++) {
        for (let i = 1; i < vox.sx - 1; i++) {
            const v = vox.get(i, 0, k)
            if (!v || vox.get(i, 1, k)) continue
            const x = O.x + (i + 0.5) * C
            const z = O.z + (k + 0.5) * C
            const h = dfHash3(i, 0, k, 77)
            const h2 = dfHash3(i, 1, k, 78)
            const jx = (dfHash3(i, 2, k, 79) - 0.5) * 0.3
            const jz = (dfHash3(i, 3, k, 80) - 0.5) * 0.3
            const yaw = h2 * PI * 2
            // Against a wall: weeds grow along the foot of it.
            const byWall = vox.get(i + 1, 1, k) || vox.get(i - 1, 1, k) || vox.get(i, 1, k + 1) || vox.get(i, 1, k - 1)
            let kind: DfDecorKind | null = null
            if (grass.has(v)) {
                if (yard(x, z) && h < 0.035) kind = h < 0.02 ? 'poppies' : 'campion'
                else if (h < (v === P.dgrass ? 0.12 : 0.18)) kind = `tuft-${Math.floor(h2 * 3)}` as DfDecorKind
            } else if (dirt.has(v)) {
                if (h < 0.06) kind = `tuft-${Math.floor(h2 * 3)}` as DfDecorKind
                else if (h < 0.1) kind = `pebbles-${Math.floor(h2 * 2)}` as DfDecorKind
                else if (h < 0.115 && Math.abs(x) < 41 && Math.abs(z) < 41) puddleCells.push([i, k])
            } else if (stones.has(v)) {
                if (byWall && h < 0.4) kind = `tuft-${Math.floor(h2 * 3)}` as DfDecorKind
                else if (h < 0.012) kind = `pebbles-${Math.floor(h2 * 2)}` as DfDecorKind
                else if (h < 0.02 && v !== P.flag1 && v !== P.flag2) puddleCells.push([i, k])
            } else if (rubble.has(v)) {
                if (h < 0.2) kind = `bricks-${Math.floor(h2 * 2)}` as DfDecorKind
            }
            if (!kind) continue
            if (floorAt(kit, x + jx, z + jz) > 0.01) continue
            const s = 0.85 + h2 * 0.35
            add(kind, x + jx, 0, z + jz, yaw, 0, s, s, s, true)
        }
    }

    // ------------------------------------------------------------ build meshes
    const meshes: THREE.Mesh[] = []
    let triangles = 0
    for (const [key, parts] of buckets) {
        const geo = dfMergeVoxGeometries(parts)
        if (!geo) continue
        const mesh = new THREE.Mesh(geo, kit.mat)
        mesh.name = `df-decor-${key}`
        mesh.matrixAutoUpdate = false
        mesh.castShadow = kit.shadows && key.startsWith('d')
        mesh.receiveShadow = kit.shadows
        kit.root.add(mesh)
        meshes.push(mesh)
        triangles += (geo.index?.count ?? 0) / 3
    }

    // ------------------------------------------------------------ puddles
    // Each seed cell grows a pixelated blob of 0.25 m squares; a glossy dark
    // surface whose specular picks up the moon and lantern highlights.
    const quads: number[] = []
    const seen = new Set<string>()
    const q4 = 0.25
    for (const [i, k] of puddleCells) {
        const cx = O.x + (i + 0.5) * C
        const cz = O.z + (k + 0.5) * C
        const r = 0.3 + dfHash3(i, 5, k, 81) * 0.45
        const n = Math.ceil(r / q4) + 1
        for (let a = -n; a <= n; a++) {
            for (let b = -n; b <= n; b++) {
                const x = Math.round(cx / q4 + a) * q4
                const z = Math.round(cz / q4 + b) * q4
                const d = Math.hypot((x - cx) / (r * 1.3), (z - cz) / r) + (dfHash3(Math.round(x * 4), 6, Math.round(z * 4), 82) - 0.5) * 0.35
                if (d > 1) continue
                const key = `${x},${z}`
                if (seen.has(key)) continue
                // Only on open ground (never under props, stairs or walls).
                const gi = Math.floor((x - O.x) / C)
                const gk = Math.floor((z - O.z) / C)
                if (vox.get(gi, 1, gk) || floorAt(kit, x, z) > 0.01) continue
                seen.add(key)
                quads.push(x - q4 / 2, z - q4 / 2)
            }
        }
    }
    let puddles: THREE.Mesh | null = null
    let puddleMat: THREE.MeshPhongMaterial | null = null
    if (quads.length) {
        const nq = quads.length / 2
        const P3 = new Float32Array(nq * 12)
        const I = new Uint32Array(nq * 6)
        for (let n = 0; n < nq; n++) {
            const x = quads[n * 2]!
            const z = quads[n * 2 + 1]!
            P3.set([x, 0.012, z, x, 0.012, z + q4, x + q4, 0.012, z + q4, x + q4, 0.012, z], n * 12)
            I.set([n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3], n * 6)
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(P3, 3))
        const nrm = new Float32Array(nq * 12)
        for (let n = 0; n < nq * 4; n++) nrm[n * 3 + 1] = 1
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
        geo.setIndex(new THREE.BufferAttribute(I, 1))
        geo.computeBoundingSphere()
        puddleMat = new THREE.MeshPhongMaterial({
            color: 0x1f2a36,
            specular: 0x8094ac,
            shininess: 90,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        })
        puddleMat.name = 'df-puddles'
        puddles = new THREE.Mesh(geo, puddleMat)
        puddles.name = 'df-puddles'
        puddles.receiveShadow = kit.shadows
        puddles.matrixAutoUpdate = false
        kit.root.add(puddles)
        triangles += nq * 2
    }

    return {
        update() {},
        dispose() {
            for (const m of meshes) {
                m.removeFromParent()
                m.geometry.dispose()
            }
            for (const g of geoCache.values()) g?.geo.dispose()
            if (puddles) {
                puddles.removeFromParent()
                puddles.geometry.dispose()
            }
            puddleMat?.dispose()
            void triangles
        }
    }
}
