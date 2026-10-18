// Voxel volumes for Dead Front: the map is authored on a voxel grid (server
// collision + client rendering), and props, zombies and weapons are voxel
// models. A volume is a dense box of palette indices (0 = empty).
//
// Authoring helpers work in cell coordinates (i = x, j = y, k = z) with
// half-open ranges [a, b). Values may be a palette index or a function of the
// cell, for patterns (bricks, noise).

export interface DfVoxPaletteEntry {
    /** sRGB colour, 0xRRGGBB. */
    color: number
    /** Collision / impact material (see dfMaterialSurface). */
    mat: string
    /** Collides (default true). Decor voxels render but never collide. */
    solid?: boolean
    /** Glow strength 0..1: the voxel renders emissive. */
    emissive?: number
}

export type DfVoxFill = number | ((i: number, j: number, k: number) => number)

export class DfVox {
    readonly data: Uint8Array

    constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
        this.data = new Uint8Array(sx * sy * sz)
    }

    inside(i: number, j: number, k: number): boolean {
        return i >= 0 && j >= 0 && k >= 0 && i < this.sx && j < this.sy && k < this.sz
    }

    /** Index layout: x fastest, then z, then y (columns stay cache friendly per layer). */
    index(i: number, j: number, k: number): number {
        return i + this.sx * (k + this.sz * j)
    }

    get(i: number, j: number, k: number): number {
        if (i < 0 || j < 0 || k < 0 || i >= this.sx || j >= this.sy || k >= this.sz) return 0
        return this.data[i + this.sx * (k + this.sz * j)]!
    }

    set(i: number, j: number, k: number, v: number): void {
        if (i < 0 || j < 0 || k < 0 || i >= this.sx || j >= this.sy || k >= this.sz) return
        this.data[i + this.sx * (k + this.sz * j)] = v
    }

    /** Fills the half-open cell box [i0, i1) x [j0, j1) x [k0, k1), clipped to the volume. */
    box(i0: number, j0: number, k0: number, i1: number, j1: number, k1: number, v: DfVoxFill): this {
        const a0 = Math.max(0, Math.min(i0, i1))
        const a1 = Math.min(this.sx, Math.max(i0, i1))
        const b0 = Math.max(0, Math.min(j0, j1))
        const b1 = Math.min(this.sy, Math.max(j0, j1))
        const c0 = Math.max(0, Math.min(k0, k1))
        const c1 = Math.min(this.sz, Math.max(k0, k1))
        const fn = typeof v === 'function' ? v : null
        for (let j = b0; j < b1; j++) {
            for (let k = c0; k < c1; k++) {
                let o = a0 + this.sx * (k + this.sz * j)
                for (let i = a0; i < a1; i++, o++) this.data[o] = fn ? fn(i, j, k) : (v as number)
            }
        }
        return this
    }

    /** Fills cells whose centre lies inside the ellipsoid centred at (ci, cj, ck) with radii (ri, rj, rk), in cells. */
    ellipsoid(ci: number, cj: number, ck: number, ri: number, rj: number, rk: number, v: DfVoxFill): this {
        const fn = typeof v === 'function' ? v : null
        for (let j = Math.floor(cj - rj); j <= Math.ceil(cj + rj); j++) {
            for (let k = Math.floor(ck - rk); k <= Math.ceil(ck + rk); k++) {
                for (let i = Math.floor(ci - ri); i <= Math.ceil(ci + ri); i++) {
                    const dx = (i + 0.5 - ci) / ri
                    const dy = (j + 0.5 - cj) / rj
                    const dz = (k + 0.5 - ck) / rk
                    if (dx * dx + dy * dy + dz * dz <= 1) this.set(i, j, k, fn ? fn(i, j, k) : (v as number))
                }
            }
        }
        return this
    }

    /** Vertical cylinder, cells with centre inside radius r (cells) around (ci, ck), rows [j0, j1). */
    cylinder(ci: number, ck: number, r: number, j0: number, j1: number, v: DfVoxFill): this {
        const fn = typeof v === 'function' ? v : null
        for (let j = j0; j < j1; j++) {
            for (let k = Math.floor(ck - r); k <= Math.ceil(ck + r); k++) {
                for (let i = Math.floor(ci - r); i <= Math.ceil(ci + r); i++) {
                    const dx = i + 0.5 - ci
                    const dz = k + 0.5 - ck
                    if (dx * dx + dz * dz <= r * r) this.set(i, j, k, fn ? fn(i, j, k) : (v as number))
                }
            }
        }
        return this
    }

    /**
     * Layered authoring: `layers` from the bottom up, each a list of rows
     * (k = 0 first), each row a string with one char per cell (i = 0 first).
     * `key` maps chars to palette indices; unknown chars and ' ' / '.' stay empty.
     */
    layers(i0: number, j0: number, k0: number, layers: string[][], key: Record<string, number>): this {
        for (let y = 0; y < layers.length; y++) {
            const rows = layers[y]!
            for (let z = 0; z < rows.length; z++) {
                const row = rows[z]!
                for (let x = 0; x < row.length; x++) {
                    const v = key[row[x]!]
                    if (v) this.set(i0 + x, j0 + y, k0 + z, v)
                }
            }
        }
        return this
    }

    /** Copies `src` into this volume at cell offset (i0, j0, k0), rotated `rot` quarter turns about +y; empty cells are skipped. */
    stamp(src: DfVox, i0: number, j0: number, k0: number, rot = 0, remap?: (v: number) => number): this {
        const r = ((rot % 4) + 4) % 4
        for (let j = 0; j < src.sy; j++) {
            for (let k = 0; k < src.sz; k++) {
                for (let i = 0; i < src.sx; i++) {
                    const v = src.data[i + src.sx * (k + src.sz * j)]!
                    if (!v) continue
                    let x = i
                    let z = k
                    if (r === 1) {
                        x = src.sz - 1 - k
                        z = i
                    } else if (r === 2) {
                        x = src.sx - 1 - i
                        z = src.sz - 1 - k
                    } else if (r === 3) {
                        x = k
                        z = src.sx - 1 - i
                    }
                    this.set(i0 + x, j0 + j, k0 + z, remap ? remap(v) : v)
                }
            }
        }
        return this
    }

    /** Mirrors the half i < sx / 2 onto the other half (symmetric models). */
    mirrorX(): this {
        for (let j = 0; j < this.sy; j++) {
            for (let k = 0; k < this.sz; k++) {
                for (let i = 0; i < this.sx >> 1; i++) {
                    const v = this.get(i, j, k)
                    if (v) this.set(this.sx - 1 - i, j, k, v)
                }
            }
        }
        return this
    }

    /** Replaces every voxel for which `fn` returns a non-negative value. */
    map(fn: (v: number, i: number, j: number, k: number) => number): this {
        for (let j = 0; j < this.sy; j++) {
            for (let k = 0; k < this.sz; k++) {
                for (let i = 0; i < this.sx; i++) {
                    const o = i + this.sx * (k + this.sz * j)
                    const v = this.data[o]!
                    if (!v) continue
                    const n = fn(v, i, j, k)
                    if (n >= 0) this.data[o] = n
                }
            }
        }
        return this
    }

    count(): number {
        let n = 0
        for (let o = 0; o < this.data.length; o++) if (this.data[o]) n++
        return n
    }
}

/** Deterministic hash of a cell in [0, 1). */
export function dfHash3(i: number, j: number, k: number, seed = 0): number {
    let h = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 144269504) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
}

/** Small seeded PRNG (mulberry32) for deterministic authoring. */
export function dfVoxRng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export interface DfVoxBox {
    i0: number
    j0: number
    k0: number
    i1: number
    j1: number
    k1: number
    /** Merge class returned by the classifier. */
    cls: number
}

/**
 * Greedy-merges cells into as few boxes as possible: grows along x, then z,
 * then y, only across cells of the same class. `classify(v)` returns 0 for
 * cells that don't take part (empty, decor). Rows below `jMin` are skipped.
 */
export function dfVoxGreedyBoxes(vox: DfVox, classify: (v: number) => number, jMin = 0): DfVoxBox[] {
    const { sx, sy, sz, data } = vox
    const cls = new Uint8Array(data.length)
    const lut = new Uint8Array(256)
    for (let v = 1; v < 256; v++) lut[v] = classify(v)
    for (let o = 0; o < data.length; o++) cls[o] = lut[data[o]!]!
    const used = new Uint8Array(data.length)
    const out: DfVoxBox[] = []
    const at = (i: number, j: number, k: number) => i + sx * (k + sz * j)
    for (let j = jMin; j < sy; j++) {
        for (let k = 0; k < sz; k++) {
            for (let i = 0; i < sx; i++) {
                const o = at(i, j, k)
                const c = cls[o]!
                if (!c || used[o]) continue
                let i1 = i + 1
                while (i1 < sx && cls[at(i1, j, k)] === c && !used[at(i1, j, k)]) i1++
                let k1 = k + 1
                grow: while (k1 < sz) {
                    for (let x = i; x < i1; x++) {
                        const p = at(x, j, k1)
                        if (cls[p] !== c || used[p]) break grow
                    }
                    k1++
                }
                let j1 = j + 1
                growY: while (j1 < sy) {
                    for (let z = k; z < k1; z++) {
                        for (let x = i; x < i1; x++) {
                            const p = at(x, j1, z)
                            if (cls[p] !== c || used[p]) break growY
                        }
                    }
                    j1++
                }
                for (let y = j; y < j1; y++) for (let z = k; z < k1; z++) for (let x = i; x < i1; x++) used[at(x, y, z)] = 1
                out.push({ i0: i, j0: j, k0: k, i1, j1, k1, cls: c })
            }
        }
    }
    return out
}
