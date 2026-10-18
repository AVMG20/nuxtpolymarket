import * as THREE from 'three'
import type { DfVox, DfVoxPaletteEntry } from '#shared/utils/dead-front/voxel'

// Greedy voxel mesher with baked per-vertex ambient occlusion. Every visible
// face of a volume is merged with its neighbours of the same colour and the
// same corner occlusion into one quad. Output: positions, normals, linear
// vertex colours (palette colour x AO) and a per-vertex `aGlow` (palette
// emissive), ready for the shared voxel material.

export interface DfVoxColors {
    /** Linear RGB per palette index. */
    rgb: Float32Array
    /** Emissive 0..1 per palette index. */
    glow: Float32Array
}

const colorCache = new WeakMap<DfVoxPaletteEntry[], DfVoxColors>()

/** Linear colours for a palette (cached per palette array). */
export function dfVoxColors(palette: DfVoxPaletteEntry[]): DfVoxColors {
    let c = colorCache.get(palette)
    if (c) return c
    const rgb = new Float32Array(256 * 3)
    const glow = new Float32Array(256)
    const col = new THREE.Color()
    palette.forEach((p, i) => {
        if (i === 0 || i > 255) return
        col.setHex(p.color)
        rgb[i * 3] = col.r
        rgb[i * 3 + 1] = col.g
        rgb[i * 3 + 2] = col.b
        glow[i] = p.emissive ?? 0
    })
    c = { rgb, glow }
    colorCache.set(palette, c)
    return c
}

export interface DfMeshOpts {
    /** Metres per voxel. */
    cell: number
    /** World position of voxel (0, 0, 0)'s min corner. */
    origin?: { x: number, y: number, z: number }
    /** Cell range to mesh, half-open; defaults to the whole volume. Neighbours outside it still occlude. */
    range?: { i0: number, i1: number, j0: number, j1: number, k0: number, k1: number }
    /** Skip faces pointing down out of row j = 0 (the map's ground skin). */
    skipFloorUnderside?: boolean
    /** Darkest AO multiplier (fully occluded corner). */
    aoMin?: number
    /** Per-axis brightness on top of the lighting, a touch of faked bounce: [x, +y, -y, z]. */
    shade?: [number, number, number, number]
}

// Reused scratch buffers (grow as needed).
let pos = new Float32Array(1 << 16)
let nor = new Float32Array(1 << 16)
let col = new Float32Array(1 << 16)
let glw = new Float32Array(1 << 14)
let idx = new Uint32Array(1 << 15)
let mask = new Int32Array(64 * 64)

function grow(nVerts: number, nIdx: number): void {
    if (nVerts * 3 > pos.length) {
        const n = Math.max(nVerts * 3, pos.length * 2)
        const p2 = new Float32Array(n)
        p2.set(pos)
        pos = p2
        const n2 = new Float32Array(n)
        n2.set(nor)
        nor = n2
        const c2 = new Float32Array(n)
        c2.set(col)
        col = c2
        const g2 = new Float32Array(n / 3)
        g2.set(glw)
        glw = g2
    }
    if (nIdx > idx.length) {
        const i2 = new Uint32Array(Math.max(nIdx, idx.length * 2))
        i2.set(idx)
        idx = i2
    }
}

/** Greedy-meshes a volume. Returns null when nothing is visible. */
export function dfMeshVox(vox: DfVox, palette: DfVoxPaletteEntry[], opts: DfMeshOpts): THREE.BufferGeometry | null {
    const colors = dfVoxColors(palette)
    const { rgb, glow } = colors
    const cell = opts.cell
    const ox = opts.origin?.x ?? 0
    const oy = opts.origin?.y ?? 0
    const oz = opts.origin?.z ?? 0
    const r = opts.range ?? { i0: 0, i1: vox.sx, j0: 0, j1: vox.sy, k0: 0, k1: vox.sz }
    const aoMin = opts.aoMin ?? 0.45
    const ao = [aoMin, aoMin + (1 - aoMin) * 0.45, aoMin + (1 - aoMin) * 0.78, 1]
    const shade = opts.shade ?? [0.86, 1, 0.62, 0.92]
    const lo = [r.i0, r.j0, r.k0]
    const hi = [r.i1, r.j1, r.k1]
    const data = vox.data
    const sx = vox.sx
    const sy = vox.sy
    const sz = vox.sz
    const get = (i: number, j: number, k: number): number => {
        if (i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz) return 0
        return data[i + sx * (k + sz * j)]!
    }
    let nv = 0
    let ni = 0
    const x = [0, 0, 0]
    const q = [0, 0, 0]

    for (let d = 0; d < 3; d++) {
        const u = (d + 1) % 3
        const w = (d + 2) % 3
        const ux = u === 0 ? 1 : 0
        const uy = u === 1 ? 1 : 0
        const uz = u === 2 ? 1 : 0
        const wx = w === 0 ? 1 : 0
        const wy = w === 1 ? 1 : 0
        const wz = w === 2 ? 1 : 0
        const nu = hi[u]! - lo[u]!
        const nw = hi[w]! - lo[w]!
        if (nu * nw > mask.length) mask = new Int32Array(nu * nw)
        for (let side = 0; side < 2; side++) {
            const dir = side === 0 ? 1 : -1
            const axisShade = d === 1 ? (dir > 0 ? shade[1] : shade[2]) : d === 0 ? shade[0] : shade[3]
            for (let s = lo[d]!; s < hi[d]!; s++) {
                // Build the mask of faces of slice s facing `dir`.
                let any = false
                for (let b = 0; b < nw; b++) {
                    for (let a = 0; a < nu; a++) {
                        x[d] = s
                        x[u] = lo[u]! + a
                        x[w] = lo[w]! + b
                        const v = get(x[0]!, x[1]!, x[2]!)
                        let m = 0
                        if (v) {
                            q[0] = x[0]!
                            q[1] = x[1]!
                            q[2] = x[2]!
                            q[d] = s + dir
                            if (!get(q[0], q[1], q[2]) && !(opts.skipFloorUnderside && d === 1 && dir < 0 && s === 0)) {
                                // Corner occlusion sampled in the air layer in front of the face.
                                let bits = 0
                                if (!(glow[v]! > 0)) {
                                    const qx = q[0]!
                                    const qy = q[1]!
                                    const qz = q[2]!
                                    const occ = (da: number, db: number) => (get(qx + da * ux + db * wx, qy + da * uy + db * wy, qz + da * uz + db * wz) ? 1 : 0)
                                    const su0 = occ(-1, 0)
                                    const su1 = occ(1, 0)
                                    const sw0 = occ(0, -1)
                                    const sw1 = occ(0, 1)
                                    const a00 = su0 && sw0 ? 0 : 3 - su0 - sw0 - occ(-1, -1)
                                    const a10 = su1 && sw0 ? 0 : 3 - su1 - sw0 - occ(1, -1)
                                    const a11 = su1 && sw1 ? 0 : 3 - su1 - sw1 - occ(1, 1)
                                    const a01 = su0 && sw1 ? 0 : 3 - su0 - sw1 - occ(-1, 1)
                                    bits = a00 | (a10 << 2) | (a11 << 4) | (a01 << 6)
                                } else {
                                    bits = 0xFF
                                }
                                m = v | (bits << 8)
                                any = true
                            }
                        }
                        mask[a + b * nu] = m
                    }
                }
                if (!any) continue
                // Greedy merge.
                for (let b = 0; b < nw; b++) {
                    for (let a = 0; a < nu;) {
                        const m = mask[a + b * nu]!
                        if (!m) {
                            a++
                            continue
                        }
                        let wa = 1
                        while (a + wa < nu && mask[a + wa + b * nu] === m) wa++
                        let hb = 1
                        outer: while (b + hb < nw) {
                            for (let k = 0; k < wa; k++) {
                                if (mask[a + k + (b + hb) * nu] !== m) break outer
                            }
                            hb++
                        }
                        for (let yb = 0; yb < hb; yb++) for (let k = 0; k < wa; k++) mask[a + k + (b + yb) * nu] = 0
                        // Emit the quad.
                        grow(nv + 4, ni + 6)
                        const v = m & 0xFF
                        const bits = m >> 8
                        const plane = side === 0 ? s + 1 : s
                        const cr = rgb[v * 3]! * axisShade
                        const cg = rgb[v * 3 + 1]! * axisShade
                        const cb = rgb[v * 3 + 2]! * axisShade
                        const gl = glow[v]!
                        const corners: [number, number, number][] = [[a, b, bits & 3], [a + wa, b, (bits >> 2) & 3], [a + wa, b + hb, (bits >> 4) & 3], [a, b + hb, (bits >> 6) & 3]]
                        for (let c = 0; c < 4; c++) {
                            const [ca, cb2, aoL] = corners[c]!
                            const p = [0, 0, 0]
                            p[d] = plane
                            p[u] = lo[u]! + ca
                            p[w] = lo[w]! + cb2
                            const o = (nv + c) * 3
                            pos[o] = ox + p[0]! * cell
                            pos[o + 1] = oy + p[1]! * cell
                            pos[o + 2] = oz + p[2]! * cell
                            nor[o] = d === 0 ? dir : 0
                            nor[o + 1] = d === 1 ? dir : 0
                            nor[o + 2] = d === 2 ? dir : 0
                            const k = gl > 0 ? 1 : ao[aoL]!
                            col[o] = cr * k
                            col[o + 1] = cg * k
                            col[o + 2] = cb * k
                            glw[nv + c] = gl
                        }
                        // Winding: counter-clockwise seen from the face normal. (u, w) is right-handed
                        // with d, so +dir uses 0-1-2, -dir flips. Split along the brighter diagonal.
                        const a0 = corners[0]![2] + corners[2]![2]
                        const a1 = corners[1]![2] + corners[3]![2]
                        const flip = a0 < a1
                        const t = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3]
                        if (dir > 0) {
                            for (let k = 0; k < 6; k++) idx[ni + k] = nv + t[k]!
                        } else {
                            for (let k = 0; k < 6; k += 3) {
                                idx[ni + k] = nv + t[k]!
                                idx[ni + k + 1] = nv + t[k + 2]!
                                idx[ni + k + 2] = nv + t[k + 1]!
                            }
                        }
                        nv += 4
                        ni += 6
                        a += wa
                    }
                }
            }
        }
    }
    if (nv === 0) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, nv * 3), 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.slice(0, nv * 3), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col.slice(0, nv * 3), 3))
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glw.slice(0, nv), 1))
    geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? idx.slice(0, ni) : new Uint16Array(idx.subarray(0, ni)), 1))
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
}

/** Appends `src` (same attribute layout) transformed by `m` into a list for merging. */
export function dfMergeVoxGeometries(parts: { geo: THREE.BufferGeometry, matrix?: THREE.Matrix4, tint?: THREE.Color }[]): THREE.BufferGeometry | null {
    let nv = 0
    let ni = 0
    for (const p of parts) {
        nv += p.geo.getAttribute('position').count
        ni += p.geo.index ? p.geo.index.count : p.geo.getAttribute('position').count
    }
    if (!nv) return null
    const P = new Float32Array(nv * 3)
    const N = new Float32Array(nv * 3)
    const Cc = new Float32Array(nv * 3)
    const G = new Float32Array(nv)
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
    const v = new THREE.Vector3()
    const nm = new THREE.Matrix3()
    let vo = 0
    let io = 0
    for (const p of parts) {
        const pa = p.geo.getAttribute('position') as THREE.BufferAttribute
        const na = p.geo.getAttribute('normal') as THREE.BufferAttribute
        const ca = p.geo.getAttribute('color') as THREE.BufferAttribute
        const ga = p.geo.getAttribute('aGlow') as THREE.BufferAttribute | undefined
        if (p.matrix) nm.getNormalMatrix(p.matrix)
        for (let i = 0; i < pa.count; i++) {
            v.fromBufferAttribute(pa, i)
            if (p.matrix) v.applyMatrix4(p.matrix)
            P[(vo + i) * 3] = v.x
            P[(vo + i) * 3 + 1] = v.y
            P[(vo + i) * 3 + 2] = v.z
            v.fromBufferAttribute(na, i)
            if (p.matrix) v.applyMatrix3(nm).normalize()
            N[(vo + i) * 3] = v.x
            N[(vo + i) * 3 + 1] = v.y
            N[(vo + i) * 3 + 2] = v.z
            const tr = p.tint?.r ?? 1
            const tg = p.tint?.g ?? 1
            const tb = p.tint?.b ?? 1
            Cc[(vo + i) * 3] = ca.getX(i) * tr
            Cc[(vo + i) * 3 + 1] = ca.getY(i) * tg
            Cc[(vo + i) * 3 + 2] = ca.getZ(i) * tb
            G[vo + i] = ga ? ga.getX(i) : 0
        }
        const index = p.geo.index
        if (index) {
            for (let i = 0; i < index.count; i++) I[io + i] = index.getX(i) + vo
            io += index.count
        } else {
            for (let i = 0; i < pa.count; i++) I[io + i] = vo + i
            io += pa.count
        }
        vo += pa.count
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3))
    geo.setAttribute('aGlow', new THREE.BufferAttribute(G, 1))
    geo.setIndex(new THREE.BufferAttribute(I, 1))
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
}
