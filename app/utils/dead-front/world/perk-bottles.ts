import type { DfPerkId } from '#shared/utils/dead-front/types'

// The perk bottle silhouettes, shared by the HUD's pixel sprites
// (DfPixelPerk.vue) and the voxel world (the bottle on each machine, the
// lit sign on its front and the bottle it drops on purchase), so a perk
// reads the same everywhere: stout, tonic, rye, round flask, wasp waist,
// long neck.

export const DF_BOTTLE_W = 12
export const DF_BOTTLE_H = 20

/** Per row (top 0 to bottom H - 1): the body's [left, right] columns (inclusive), or null above the bottle. */
export type DfBottleSpans = ([number, number] | null)[]

export interface DfBottleSprite {
    spans: DfBottleSpans
    /** Rows covered by the paper label [from, to] inclusive. */
    label: [number, number]
}

function rows(...parts: [number, number, [number, number]][]): DfBottleSpans {
    const out: DfBottleSpans = Array.from({ length: DF_BOTTLE_H }, () => null)
    for (const [a, b, span] of parts) {
        for (let r = a; r <= b; r++) out[r] = span
    }
    return out
}

export const DF_BOTTLES: Record<DfPerkId, DfBottleSprite> = {
    // stout: graded shoulders, wide body
    ironhide: { spans: rows([0, 4, [4, 7]], [5, 5, [3, 8]], [6, 19, [2, 9]]), label: [10, 13] },
    // tonic: slim and tall
    quickhand: { spans: rows([0, 5, [4, 7]], [6, 19, [3, 8]]), label: [10, 14] },
    // rye: flat square shoulders, the widest
    twinfire: { spans: rows([0, 3, [4, 7]], [4, 19, [1, 10]]), label: [9, 12] },
    // round flask
    secondwind: { spans: rows([0, 6, [4, 7]], [7, 7, [3, 8]], [8, 8, [2, 9]], [9, 10, [1, 10]], [11, 15, [0, 11]], [16, 17, [1, 10]], [18, 18, [2, 9]], [19, 19, [3, 8]]), label: [12, 14] },
    // wasp waist
    fleetfoot: { spans: rows([0, 3, [4, 7]], [4, 7, [2, 9]], [8, 9, [3, 8]], [10, 19, [1, 10]]), label: [13, 16] },
    // long neck
    steadyeye: { spans: rows([0, 8, [4, 7]], [9, 9, [3, 8]], [10, 19, [2, 9]]), label: [13, 16] }
}

/** What a sprite pixel is. */
export type DfBottlePixel = 'none' | 'cork' | 'corkHi' | 'outline' | 'label' | 'labelBand' | 'ink' | 'liquid' | 'liquidHi' | 'liquidLo' | 'glass' | 'glassHi'

/** The cork rows on top of the first body row. */
const CAP_ROWS = 2

/**
 * Classifies one pixel of a perk's bottle sprite, `fill` (0..1) being the
 * liquid level. Shared by the SVG sprite and the voxel builders.
 */
export function dfBottlePixel(sp: DfBottleSprite, x: number, y: number, fill = 1): DfBottlePixel {
    const s = sp.spans[y]
    if (!s || x < s[0] || x > s[1]) return 'none'
    const first = sp.spans.findIndex(r => r !== null)
    const bodyTop = first + CAP_ROWS
    if (y < bodyTop) return y === first ? 'corkHi' : 'cork'
    const bottom = DF_BOTTLE_H - 1
    const inside = (px: number, py: number): boolean => {
        if (py < bodyTop || py > bottom) return false
        const r = sp.spans[py]
        return !!r && px >= r[0] && px <= r[1]
    }
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return 'outline'
    if (y >= sp.label[0] && y <= sp.label[1] && inside(x - 2, y) && inside(x + 2, y)) {
        const stripe = y === Math.floor((sp.label[0] + sp.label[1]) / 2) && sp.label[1] - sp.label[0] >= 3 && inside(x - 3, y) && inside(x + 3, y)
        return y === sp.label[0] || y === sp.label[1] ? 'labelBand' : stripe ? 'ink' : 'label'
    }
    const f = Math.max(0, Math.min(1, fill))
    const liquidTop = Math.round(bottom - f * (bottom - bodyTop - 1))
    if (y >= liquidTop) return !inside(x - 2, y) ? 'liquidHi' : !inside(x + 2, y) ? 'liquidLo' : y === liquidTop ? 'liquidHi' : 'liquid'
    return !inside(x - 2, y) ? 'glassHi' : 'glass'
}
