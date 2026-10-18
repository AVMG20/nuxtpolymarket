import * as THREE from 'three'
import type { DfPropKind } from '#shared/utils/dead-front/map-world'
import { dfHash3 } from '#shared/utils/dead-front/voxel'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'

// Small props as fine voxel models (12.5 cm voxels, trees at 25 cm), one
// instanced mesh per model so a whole cemetery of graves is one draw call.
// Sizes match DF_PROP_DEFS (their collision boxes).

interface PropModel {
    model: DfVoxModel
    cell: number
    shadow: boolean
}

const S = 0.125

function crate(seed: number, n = 8): PropModel {
    const m = new DfVoxModel(n, n, n)
    const plank = m.shade(seed ? 0x7f6340 : 0x8d6c44, 0.07, seed)
    const frame = m.c(0x5a3f26)
    const mark = m.c(0x2c2218)
    m.box(0, 0, 0, n, n, n, plank)
    const e = n - 1
    m.vox.map((_v, i, j, k) => ((i === 0 || i === e ? 1 : 0) + (j === 0 || j === e ? 1 : 0) + (k === 0 || k === e ? 1 : 0) >= 2 ? frame : -1))
    for (let t = 1; t < e; t++) {
        m.set(0, t, t, frame).set(e, t, e - t, frame).set(t, t, 0, frame).set(e - t, t, e, frame)
    }
    if (n >= 8) m.box(2, 5, e, 6, 6, n, mark).box(3, 3, e, 5, 4, n, mark)
    return { model: m, cell: S, shadow: true }
}

function sandbags(): PropModel {
    const m = new DfVoxModel(16, 8, 6)
    const seam = m.c(0x6f6448)
    for (let r = 0; r < 4; r++) {
        const off = r % 2 ? 2 : 0
        const z0 = r === 3 ? 1 : 0
        const z1 = r === 3 ? 5 : 6
        for (let b = -1; b < 5; b++) {
            const x0 = Math.max(0, off + b * 4)
            const x1 = Math.min(16, off + b * 4 + 4)
            if (x1 <= x0) continue
            const col = m.shade(dfHash3(b, r, 0, 4) < 0.5 ? 0xa5966c : 0x958760, 0.05, b * 7 + r)
            m.box(x0, r * 2, z0, x1, r * 2 + 2, z1, col)
            // Rounded bag ends and a seam between bags.
            m.set(x0, r * 2 + 1, z0, 0).set(x0, r * 2 + 1, z1 - 1, 0)
            if (x0 > 0) m.box(x0, r * 2, z0, x0 + 1, r * 2 + 2, z0 + 1, seam).box(x0, r * 2, z1 - 1, x0 + 1, r * 2 + 2, z1, seam)
        }
    }
    return { model: m, cell: S, shadow: true }
}

function wheel(m: DfVoxModel, ci: number, cj: number, k0: number, k1: number, r: number, rim: number, wood: number): void {
    for (let j = cj - r - 1; j <= cj + r + 1; j++) {
        for (let i = ci - r - 1; i <= ci + r + 1; i++) {
            const d = Math.hypot(i + 0.5 - ci, j + 0.5 - cj)
            const spoke = Math.abs(i + 0.5 - ci) < 0.6 || Math.abs(j + 0.5 - cj) < 0.6 || Math.abs(Math.abs(i + 0.5 - ci) - Math.abs(j + 0.5 - cj)) < 0.6
            if (d <= r && d > r - 1.1) m.box(i, j, k0, i + 1, j + 1, k1, rim)
            else if (d < r - 1 && (spoke || d < 1.2)) m.box(i, j, k0, i + 1, j + 1, k1, wood)
        }
    }
}

function cart(): PropModel {
    const m = new DfVoxModel(24, 13, 14)
    const plank = m.shade(0x7a5735, 0.08, 3)
    const dark = m.c(0x4a331f)
    const iron = m.c(0x34353a)
    m.box(4, 5, 2, 24, 6, 12, plank)
    m.box(4, 6, 2, 24, 9, 3, plank).box(4, 6, 11, 24, 9, 12, plank).box(23, 6, 2, 24, 9, 12, plank)
    for (const x of [8, 14, 20]) m.box(x, 6, 2, x + 1, 9, 3, dark).box(x, 6, 11, x + 1, 9, 12, dark)
    // A broken side board and a sack left in the bed.
    m.box(15, 7, 11, 19, 9, 12, 0)
    m.box(17, 6, 5, 21, 8, 9, m.shade(0xa08f66, 0.06, 5))
    // Shafts resting on the ground.
    for (let x = 0; x < 6; x++) {
        const y = Math.floor(x * 0.8)
        m.box(x, y, 4, x + 1, y + 1, 5, dark).box(x, y, 9, x + 1, y + 1, 10, dark)
    }
    m.box(6, 4, 4, 22, 5, 5, dark).box(6, 4, 9, 22, 5, 10, dark)
    wheel(m, 15, 5, 0, 1, 5, iron, dark)
    wheel(m, 15, 5, 13, 14, 5, iron, dark)
    m.box(14, 4, 1, 16, 6, 13, dark)
    return { model: m, cell: S, shadow: true }
}

function cross(seed: number): PropModel {
    const m = new DfVoxModel(6, 11, 2)
    const paint = m.shade(seed ? 0xcfc8b6 : 0xd9d2c2, 0.05, seed)
    m.box(2, 0, 0, 4, 11, 2, paint).box(0, 7, 0, 6, 9, 2, paint)
    m.box(2, 7, 1, 4, 9, 2, m.c(0x3b3a37))
    m.box(2, 0, 0, 4, 1, 2, m.c(0x5d6a45))
    return { model: m, cell: S, shadow: true }
}

function gravestone(seed: number): PropModel {
    const m = new DfVoxModel(6, 8, 2)
    const stone = m.shade(seed ? 0x8d8a82 : 0x7f7c75, 0.06, seed + 1)
    const moss = m.c(0x56653d)
    m.box(0, 0, 0, 6, 6, 2, stone).box(0, 6, 0, 6, 7, 2, stone).box(1, 7, 0, 5, 8, 2, stone)
    m.set(0, 6, 0, 0).set(0, 6, 1, 0).set(5, 6, 0, 0).set(5, 6, 1, 0)
    if (seed) m.box(2, 3, 1, 4, 4, 2, m.c(0x55534e)).box(2.5 | 0, 2, 1, 3 + 1, 6, 2, m.c(0x55534e))
    else m.box(1, 4, 1, 5, 5, 2, m.c(0x55534e))
    m.box(0, 0, 0, 6, 1, 2, (i, _j, k) => (dfHash3(i, 0, k, seed) < 0.6 ? moss : stone(i, 0, k)))
    return { model: m, cell: S, shadow: true }
}

function tree(): PropModel {
    const m = new DfVoxModel(18, 26, 18)
    const bark = m.shade(0x4a3a2a, 0.1, 9)
    const leaves = [m.c(0x3a5a2d), m.c(0x46693a), m.c(0x2f4b25), m.c(0x52763f)]
    m.box(8, 0, 8, 10, 14, 10, bark).box(7, 0, 8, 11, 1, 10, bark).box(8, 0, 7, 10, 1, 11, bark)
    for (let t = 0; t < 4; t++) m.box(10 + t, 10 + t, 9, 11 + t, 11 + t, 10, bark).box(7 - t, 11 + t, 8, 8 - t, 12 + t, 9, bark)
    const blobs: [number, number, number, number, number, number][] = [[9, 18, 9, 7, 5, 7], [5, 15, 7, 4, 3.5, 4.5], [13, 16, 11, 4.5, 4, 4.5], [9, 21.5, 9, 4.5, 3.5, 4.5]]
    for (const [cx, cy, cz, rx, ry, rz] of blobs) {
        m.vox.ellipsoid(cx, cy, cz, rx, ry, rz, (i, j, k) => {
            const h = dfHash3(i, j, k, 17)
            return leaves[Math.floor(h * 4)]!
        })
    }
    // Ragged canopy edge.
    m.vox.map((v, i, j, k) => (j > 12 && v !== bark(i, j, k) && dfHash3(i, j, k, 23) < 0.12 && !m.get(i, j + 1, k) ? 0 : -1))
    return { model: m, cell: 0.25, shadow: true }
}

function deadTree(): PropModel {
    const m = new DfVoxModel(14, 22, 14)
    const bark = m.shade(0x4f453b, 0.1, 13)
    m.box(6, 0, 6, 8, 16, 8, bark).box(5, 0, 6, 9, 1, 8, bark)
    const branch = (x: number, y: number, z: number, dx: number, dz: number, n: number) => {
        for (let t = 0; t < n; t++) m.box(x + dx * t, y + t, z + dz * t, x + dx * t + 1, y + t + 1, z + dz * t + 1, bark)
    }
    branch(8, 9, 7, 1, 0, 5)
    branch(5, 11, 6, -1, -1, 4)
    branch(7, 13, 8, 0, 1, 5)
    branch(6, 15, 6, -1, 0, 4)
    branch(7, 16, 7, 1, -1, 4)
    m.box(6, 16, 7, 7, 20, 8, bark)
    return { model: m, cell: 0.25, shadow: true }
}

function wire(): PropModel {
    const m = new DfVoxModel(32, 11, 11)
    const iron = m.c(0x26272a)
    const rust = m.c(0x4c3426)
    for (let x = 1; x < 31; x++) {
        // A helix of wire along x: a loop every 4 voxels.
        const a = (x / 4) * Math.PI * 2
        const y = Math.round(5 + Math.sin(a) * 4.4)
        const z = Math.round(5 + Math.cos(a) * 4.4)
        m.set(x, y, z, iron)
        if (x % 3 === 0) m.set(x, Math.min(10, y + 1), z, rust)
    }
    for (const x of [0, 31]) {
        for (let y = 0; y < 11; y++) {
            m.set(x, y, Math.max(0, Math.min(10, 5 + Math.round((y - 5) * 0.6))), m.c(0x4a3b2a))
            m.set(x, y, Math.max(0, Math.min(10, 5 - Math.round((y - 5) * 0.6))), m.c(0x4a3b2a))
        }
    }
    return { model: m, cell: 0.0625, shadow: false }
}

function pew(): PropModel {
    const m = new DfVoxModel(6, 8, 24)
    const wood = m.shade(0x5f412a, 0.06, 2)
    const end = m.c(0x4a3220)
    m.box(0, 3, 0, 5, 4, 24, wood).box(5, 3, 0, 6, 8, 24, wood)
    m.box(0, 0, 0, 6, 7, 1, end).box(0, 0, 23, 6, 7, 24, end)
    m.box(1, 0, 11, 2, 3, 13, end)
    m.box(5, 7, 0, 6, 8, 24, end)
    return { model: m, cell: S, shadow: true }
}

function barrel(): PropModel {
    const m = new DfVoxModel(5, 7, 5)
    const body = m.shade(0x6d3a24, 0.08, 6)
    const band = m.c(0x2e2c2b)
    m.vox.cylinder(2.5, 2.5, 2.6, 0, 7, body)
    m.vox.cylinder(2.5, 2.5, 2.6, 1, 2, band)
    m.vox.cylinder(2.5, 2.5, 2.6, 5, 6, band)
    m.vox.cylinder(2.5, 2.5, 1.6, 6, 7, m.c(0x1c1612))
    return { model: m, cell: S, shadow: true }
}

function hay(): PropModel {
    const m = new DfVoxModel(10, 6, 6)
    m.box(0, 0, 0, 10, 6, 6, m.shade(0xc4a258, 0.1, 8))
    m.box(2, 0, 0, 3, 6, 6, m.c(0x7a5d2c)).box(7, 0, 0, 8, 6, 6, m.c(0x7a5d2c))
    m.box(3, 1, 1, 7, 5, 5, m.shade(0xb8964d, 0.1, 9))
    return { model: m, cell: S, shadow: true }
}

function rubble(): PropModel {
    const m = new DfVoxModel(12, 4, 12)
    const stones = [m.c(0x7c766a), m.c(0x6b655b), m.c(0x8a8478), m.c(0x8f4c37)]
    for (let k = 0; k < 12; k++) {
        for (let i = 0; i < 12; i++) {
            const r = Math.hypot(i - 5.5, k - 5.5)
            const h = Math.round(4 * (1 - r / 6.5) + (dfHash3(i >> 1, 0, k >> 1, 3) - 0.5) * 2)
            for (let j = 0; j < h; j++) m.set(i, j, k, stones[Math.floor(dfHash3(i >> 1, j, k >> 1, 5) * 4)]!)
        }
    }
    return { model: m, cell: S, shadow: true }
}

function lamppost(): PropModel {
    const m = new DfVoxModel(3, 27, 3)
    const iron = m.c(0x2d2e31)
    const glass = m.c(0xffbf73, 1)
    m.box(0, 0, 0, 3, 2, 3, iron).box(1, 2, 1, 2, 22, 2, iron)
    m.box(0, 22, 0, 3, 26, 3, glass)
    m.vox.map((_v, i, j, k) => (j >= 22 && j < 26 && (i === 0 || i === 2) && (k === 0 || k === 2) ? iron : -1))
    m.box(0, 22, 0, 3, 23, 3, iron).box(0, 25, 0, 3, 26, 3, iron).box(1, 26, 1, 2, 27, 2, iron)
    return { model: m, cell: S, shadow: true }
}

function fieldgun(): PropModel {
    const m = new DfVoxModel(19, 13, 27)
    const olive = m.shade(0x4e5236, 0.06, 4)
    const dark = m.c(0x2b2d22)
    const steel = m.c(0x3a3c3f)
    // Wheels are in the x = const planes: author them with the wheel helper in a scratch model.
    for (const x of [0, 17]) {
        for (let j = 0; j <= 11; j++) {
            for (let k = 3; k <= 15; k++) {
                const d = Math.hypot(k + 0.5 - 9, j + 0.5 - 5.5)
                const spoke = Math.abs(k + 0.5 - 9) < 0.6 || Math.abs(j + 0.5 - 5.5) < 0.6
                if (d <= 5.5 && d > 4.4) m.box(x, j, k, x + 2, j + 1, k + 1, steel)
                else if (d < 4.4 && (spoke || d < 1.2)) m.box(x, j, k, x + 2, j + 1, k + 1, dark)
            }
        }
    }
    m.box(2, 5, 8, 17, 6, 10, dark)
    m.box(3, 5, 10, 16, 12, 11, olive)
    m.box(7, 6, 11, 12, 9, 16, olive)
    m.box(8, 8, 0, 11, 10, 16, olive).box(8, 8, 0, 11, 10, 1, dark)
    for (let k = 16; k < 27; k++) {
        const y = Math.max(0, 6 - Math.floor((k - 16) * 0.55))
        m.box(8, y, k, 11, y + 1, k + 1, olive)
    }
    m.box(7, 0, 25, 12, 1, 27, dark)
    return { model: m, cell: S, shadow: true }
}

function fence(): PropModel {
    const m = new DfVoxModel(16, 9, 1)
    const wood = m.shade(0x6b5640, 0.1, 5)
    for (const x of [0, 7, 15]) m.box(x, 0, 0, x + 1, 9, 1, wood)
    m.box(0, 3, 0, 16, 4, 1, wood).box(0, 6, 0, 10, 7, 1, wood)
    m.box(11, 5, 0, 15, 6, 1, wood)
    return { model: m, cell: S, shadow: false }
}

function build(kind: DfPropKind, variant: number): PropModel {
    switch (kind) {
        case 'crate':
            return crate(variant)
        case 'crate-small':
            return crate(variant, 6)
        case 'sandbags':
            return sandbags()
        case 'cart':
            return cart()
        case 'cross':
            return cross(variant)
        case 'gravestone':
            return gravestone(variant)
        case 'tree':
            return tree()
        case 'dead-tree':
            return deadTree()
        case 'wire':
            return wire()
        case 'pew':
            return pew()
        case 'barrel':
            return barrel()
        case 'hay':
            return hay()
        case 'rubble':
            return rubble()
        case 'lamppost':
            return lamppost()
        case 'fieldgun':
            return fieldgun()
        case 'fence':
            return fence()
    }
}

const VARIANTS: Partial<Record<DfPropKind, number>> = { 'crate': 2, 'crate-small': 2, 'cross': 2, 'gravestone': 2 }

export function createDfProps(kit: DfWorldKit): DfWorldPart {
    const groups = new Map<string, { kind: DfPropKind, variant: number, list: typeof kit.world.props }>()
    for (const p of kit.world.props) {
        const variant = p.seed % (VARIANTS[p.kind] ?? 1)
        const key = `${p.kind}:${variant}`
        let g = groups.get(key)
        if (!g) groups.set(key, g = { kind: p.kind, variant, list: [] })
        g.list.push(p)
    }
    const meshes: THREE.InstancedMesh[] = []
    const geos: THREE.BufferGeometry[] = []
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const up = new THREE.Vector3(0, 1, 0)
    for (const g of groups.values()) {
        const pm = build(g.kind, g.variant)
        const geo = pm.model.mesh(pm.cell)
        if (!geo) continue
        geos.push(geo)
        const inst = new THREE.InstancedMesh(geo, kit.mat, g.list.length)
        inst.name = `df-props-${g.kind}`
        g.list.forEach((p, i) => {
            q.setFromAxisAngle(up, p.rot * Math.PI / 2)
            pos.set(p.x, p.y, p.z)
            inst.setMatrixAt(i, m4.compose(pos, q, one))
        })
        inst.computeBoundingSphere()
        inst.castShadow = kit.shadows && pm.shadow
        inst.receiveShadow = kit.shadows
        kit.root.add(inst)
        meshes.push(inst)
    }
    return {
        update() {},
        dispose() {
            for (const m of meshes) {
                m.removeFromParent()
                m.dispose()
            }
            for (const g of geos) g.dispose()
        }
    }
}
