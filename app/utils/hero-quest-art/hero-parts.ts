// The Hero's constant identity: one young rookie with messy brown hair and a plaster on his
// cheek, who changes outfit, weapon and stance as he changes class but never changes face.
// Every class head draws `heroFace` and then its own headgear over whatever hair it leaves showing.

import { C } from './palette'
import type { Surface} from './surface';
import { line, px, rect, hash2 } from './surface'
import { HP, fxX, fxY } from './rig'
import type { Mat } from './weapons'

export const HERO_SKIN: Mat = [C.skin0, C.skin1, C.skin2]
export const HAIR: Mat = [C.brown1, C.brown2, C.brown3]

/** Face only, (x, y) = neck. Occupies x−2..x+3, y−7..y−1. */
export function heroFace(s: Surface, x: number, y: number, p: Float32Array, eye: number = C.ink): void {
    rect(s, x - 2, y - 7, 5, 7, C.skin1)
    rect(s, x + 1, y - 6, 2, 4, C.skin2)
    px(s, x + 3, y - 4, C.skin1)
    px(s, x + 3, y - 3, C.skin2) // nose
    px(s, x - 1, y - 4, C.skin0) // ear
    px(s, x - 2, y - 1, C.skin0)
    const mouth = p[HP.mouth]!
    const hurt = p[HP.flash]! > 0.5 || mouth > 0.5
    if (hurt && p[HP.fade]! < 1 && p[HP.glow]! < 0.5) {
        // wince: eye squeezed shut
        px(s, x + 1, y - 4, C.ink)
        px(s, x + 2, y - 5, C.ink)
    } else {
        px(s, x + 2, y - 4, eye)
        px(s, x + 1, y - 4, C.white)
        px(s, x + 2, y - 5, C.brown1) // brow
        px(s, x + 1, y - 5, C.brown1)
    }
    // the plaster on his cheek, just under the eye
    px(s, x, y - 3, C.bone1)
    px(s, x + 1, y - 3, C.white)
    if (mouth > 0.5) {
        rect(s, x + 1, y - 1, 2, 1, C.ink)
        px(s, x + 2, y - 1, C.red1)
    } else {
        px(s, x + 2, y - 1, C.skin0)
    }
}

/**
 * Messy hair. `cover` hides the top rows under headgear: 0 = full mop, 1 = only the sides,
 * back tufts and fringe show (caps, circlets), 2 = only a fringe and nape (full helms, hoods).
 */
export function heroHair(s: Surface, x: number, y: number, cover: 0 | 1 | 2, hair: Mat = HAIR): void {
    const [dk, base, hi] = hair
    if (cover === 0) {
        rect(s, x - 3, y - 9, 6, 3, base)
        rect(s, x - 2, y - 10, 4, 1, base)
        px(s, x - 3, y - 10, dk); px(s, x + 1, y - 11, base); px(s, x - 1, y - 11, base)
        px(s, x + 3, y - 9, base); px(s, x + 3, y - 8, base) // fringe swept forward
        px(s, x - 1, y - 9, hi); px(s, x, y - 10, hi); px(s, x + 1, y - 9, hi)
        rect(s, x - 3, y - 6, 2, 3, base) // back of the head
        px(s, x - 4, y - 8, base); px(s, x - 4, y - 6, dk); px(s, x - 5, y - 7, dk) // tufts
        px(s, x - 3, y - 3, dk)
        px(s, x + 2, y - 7, base) // fringe over the brow
    } else if (cover === 1) {
        rect(s, x - 3, y - 7, 2, 4, base)
        px(s, x - 4, y - 6, dk); px(s, x - 4, y - 5, base); px(s, x - 3, y - 3, dk)
        px(s, x + 2, y - 7, base); px(s, x + 3, y - 7, base)
        px(s, x - 2, y - 7, hi)
    } else {
        px(s, x + 2, y - 7, base)
        px(s, x - 3, y - 4, base); px(s, x - 3, y - 3, dk)
    }
}

/** A plain tunic torso with a belt; most early outfits build on it. (x, y) = shoulder centre. */
export function tunic(s: Surface, x: number, y: number, len: number, cloth: Mat, belt: number, buckle: number): void {
    rect(s, x - 4, y, 8, len, cloth[1])
    rect(s, x - 4, y, 1, len, cloth[0])
    rect(s, x + 2, y + 1, 1, len - 3, cloth[2])
    rect(s, x - 4, y + len - 3, 8, 1, belt)
    px(s, x + 1, y + len - 3, buckle)
}

/** A cape hanging from the shoulders and trailing behind (to the left). */
export function cape(s: Surface, x: number, y: number, len: number, flutter: number, c: number, cd: number): void {
    for (let i = 0; i < len; i++) {
        const back = Math.round(i * (0.3 + flutter * 0.12))
        const w = 3 + (i >> 2)
        rect(s, x - back - w + 1, y + i, w, 1, i > len - 3 ? cd : c)
        px(s, x - back - w + 1, y + i, cd)
    }
}

/** Shoulder plate on the front shoulder. */
export function pauldron(s: Surface, x: number, y: number, m: Mat, big = false): void {
    const w = big ? 5 : 4
    rect(s, x + 1, y - 1, w, 3, m[1])
    rect(s, x + 1, y - 1, w, 1, m[2])
    px(s, x + w, y + 1, m[0])
    if (big) px(s, x + 3, y - 2, m[2])
}

/** A long robe skirt that replaces the legs; sways with `sway` px and shows boot tips. */
export function robeSkirt(s: Surface, x: number, hipY: number, floor: number, cloth: Mat, trim: number, sway: number, boot: number, stepping: number): void {
    const h = floor - hipY
    for (let i = 0; i <= h; i++) {
        const w = 8 + (i >> 1)
        const shift = Math.round((i / Math.max(1, h)) * sway)
        rect(s, x - 4 - (i >> 2) + shift, hipY + i, w, 1, i === h ? cloth[0] : cloth[1])
        px(s, x - 1 + shift + (i >> 3), hipY + i, cloth[2])
        px(s, x - 4 - (i >> 2) + shift, hipY + i, cloth[0])
    }
    const hemW = 8 + (h >> 1)
    rect(s, x - 4 - (h >> 2) + Math.round(sway), floor - 1, hemW, 1, trim)
    rect(s, x + 2 + stepping, floor, 3, 1, boot)
}

/** A line of cloth hanging from (x, y), used for sashes and tabards. */
export function sash(s: Surface, x0: number, y0: number, x1: number, y1: number, c: number): void {
    line(s, x0, y0, x1, y1, c)
}

// ── Scene-space effects (drawn un-outlined over the stamped sprite) ────────────────

/**
 * Weapon smear: a bright arc swept around (cx, cy) from angle a0 to a1, thicker toward the
 * leading edge — Pixel Crusade's strike smear. (cx, cy) are sprite-local.
 */
export function smear(dst: Surface, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, accent: number, edge: number = C.white): void {
    const steps = Math.max(8, Math.round(Math.abs(a1 - a0) * r1))
    for (let i = 0; i <= steps; i++) {
        const k = i / steps
        const a = a0 + (a1 - a0) * k
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const th = Math.round(1 + k * (r1 - r0 - 1))
        for (let r = r1 - th; r <= r1; r++) {
            if (k < 0.35 && r < r1 - 1 && (i & 1) === 0) continue
            const c = r === r1 ? edge : (r >= r1 - 1 ? C.steel3 : accent)
            dst.set(fxX(Math.round(cx + ca * r)), fxY(Math.round(cy + sa * r)), c)
        }
    }
}

/** A release streak: a line trailing back from (x, y) along angle a, `len` long. */
export function streak(dst: Surface, x: number, y: number, a: number, len: number, c: number, head: number = C.white): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    for (let i = 0; i < len; i++) {
        if (i > len * 0.6 && (i & 1)) continue
        dst.set(fxX(Math.round(x - dx * i)), fxY(Math.round(y - dy * i)), i < 2 ? head : c)
    }
}

/** A few 1px sparks around (x, y), sprite-local, laid out by hash so frames are stable. */
export function sparks(dst: Surface, x: number, y: number, r: number, n: number, seed: number, c0: number, c1: number): void {
    for (let i = 0; i < n; i++) {
        const a = hash2(seed, i) * Math.PI * 2
        const d = r * (0.4 + hash2(seed + 7, i) * 0.6)
        dst.set(fxX(Math.round(x + Math.cos(a) * d)), fxY(Math.round(y + Math.sin(a) * d)), i & 1 ? c0 : c1)
    }
}
