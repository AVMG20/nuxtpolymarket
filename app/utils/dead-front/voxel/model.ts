import type * as THREE from 'three'
import { DfVox, dfHash3 } from '#shared/utils/dead-front/voxel'
import type { DfVoxFill, DfVoxPaletteEntry } from '#shared/utils/dead-front/voxel'
import { dfMeshVox } from './mesher'
import type { DfMeshOpts } from './mesher'

// A voxel model with its own palette, for props, machines, zombies, weapons
// and avatars. Colours are registered on the fly (`c(hex)`), so authoring code
// reads like painting: `m.box(0, 0, 0, 4, 2, 4, m.c(0x6b4a2e))`.

export class DfVoxModel {
    readonly vox: DfVox
    readonly palette: DfVoxPaletteEntry[] = [{ color: 0, mat: '' }]
    private readonly keys = new Map<string, number>()

    constructor(sx: number, sy: number, sz: number) {
        this.vox = new DfVox(sx, sy, sz)
    }

    get sx(): number {
        return this.vox.sx
    }

    get sy(): number {
        return this.vox.sy
    }

    get sz(): number {
        return this.vox.sz
    }

    /** Palette index for a colour (glow 0..1 makes it emissive). */
    c(hex: number, glow = 0): number {
        const key = `${hex}:${glow}`
        let i = this.keys.get(key)
        if (i === undefined) {
            i = this.palette.length
            if (i > 255) return this.palette.length - 1
            this.palette.push({ color: hex, mat: '', emissive: glow || undefined })
            this.keys.set(key, i)
        }
        return i
    }

    /** One of three close shades of `hex` per cell (keeps greedy merging effective). */
    shade(hex: number, amount = 0.08, seed = 0, glow = 0): (i: number, j: number, k: number) => number {
        const a = this.c(scaleHex(hex, 1 + amount), glow)
        const b = this.c(hex, glow)
        const c = this.c(scaleHex(hex, 1 - amount), glow)
        return (i, j, k) => {
            const h = dfHash3(i, j, k, seed)
            return h < 0.33 ? a : h < 0.72 ? b : c
        }
    }

    box(i0: number, j0: number, k0: number, i1: number, j1: number, k1: number, v: DfVoxFill): this {
        this.vox.box(i0, j0, k0, i1, j1, k1, v)
        return this
    }

    set(i: number, j: number, k: number, v: number): this {
        this.vox.set(i, j, k, v)
        return this
    }

    get(i: number, j: number, k: number): number {
        return this.vox.get(i, j, k)
    }

    /** Recolours every voxel through `fn(colourHex, glow, i, j, k)` returning [hex, glow] or null to keep. */
    recolor(fn: (hex: number, glow: number, i: number, j: number, k: number) => [number, number] | null): this {
        const pal = this.palette
        this.vox.map((v, i, j, k) => {
            const p = pal[v]!
            const r = fn(p.color, p.emissive ?? 0, i, j, k)
            return r ? this.c(r[0], r[1]) : -1
        })
        return this
    }

    /**
     * Meshes the model. `pivot` is in voxel units (the point that ends up at
     * the origin); by default the bottom centre.
     */
    mesh(cell: number, pivot?: [number, number, number], opts: Partial<DfMeshOpts> = {}): THREE.BufferGeometry | null {
        const p = pivot ?? [this.vox.sx / 2, 0, this.vox.sz / 2]
        return dfMeshVox(this.vox, this.palette, { cell, origin: { x: -p[0] * cell, y: -p[1] * cell, z: -p[2] * cell }, ...opts })
    }

    /** Model space centres of every filled voxel with its linear colour, for debris bursts (subsampled by `step`). */
    points(cell: number, pivot: [number, number, number], step = 1): { x: number, y: number, z: number, color: number }[] {
        const out: { x: number, y: number, z: number, color: number }[] = []
        const { sx, sy, sz } = this.vox
        for (let j = 0; j < sy; j += step) {
            for (let k = 0; k < sz; k += step) {
                for (let i = 0; i < sx; i += step) {
                    const v = this.vox.get(i, j, k)
                    if (!v) continue
                    // Only surface voxels: interior ones are never seen.
                    if (this.vox.get(i + 1, j, k) && this.vox.get(i - 1, j, k) && this.vox.get(i, j + 1, k) && this.vox.get(i, j - 1, k) && this.vox.get(i, j, k + 1) && this.vox.get(i, j, k - 1)) continue
                    out.push({ x: (i + 0.5 - pivot[0]) * cell, y: (j + 0.5 - pivot[1]) * cell, z: (k + 0.5 - pivot[2]) * cell, color: this.palette[v]!.color })
                }
            }
        }
        return out
    }
}

/** Scales an sRGB hex colour's channels (clamped). */
export function scaleHex(hex: number, k: number): number {
    const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 255) * k)))
    const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 255) * k)))
    const b = Math.min(255, Math.max(0, Math.round((hex & 255) * k)))
    return (r << 16) | (g << 8) | b
}

/** Mixes two sRGB hex colours. */
export function mixHex(a: number, b: number, t: number): number {
    const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
    return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
