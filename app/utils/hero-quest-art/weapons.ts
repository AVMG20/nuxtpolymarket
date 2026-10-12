// Held items, drawn from a hand position along an angle (0 = pointing right, −π/2 = up).
// Shared by the Hero, Champions and trash enemies so a sword reads as the same object on
// every body — the party and the enemy speak one weapon vocabulary (asset-list §1.4).
//
// Every drawer writes the far end of the item into `tip`, which the VFX layer reads to
// spawn a cast from the right pixel.

import { C } from './palette'
import type { Surface} from './surface';
import { line, px, rect, disc, ring, tri, arc } from './surface'

export type Mat = readonly [dark: number, base: number, light: number]

export const M = {
    steel: [C.steel1, C.steel2, C.steel3],
    iron: [C.steel0, C.steel1, C.steel2],
    gold: [C.gold1, C.gold2, C.gold3],
    bronze: [C.gold0, C.gold1, C.gold2],
    wood: [C.brown1, C.brown2, C.brown3],
    darkwood: [C.brown0, C.brown1, C.brown2],
    bone: [C.bone0, C.bone1, C.white],
    obsidian: [C.void, C.stone1, C.stone2],
    ice: [C.blue2, C.cyan, C.frost],
    lava: [C.lava0, C.lava1, C.gold2],
    arcane: [C.purple1, C.purple2, C.pink],
    holy: [C.gold2, C.gold3, C.white],
    nature: [C.green1, C.green2, C.green3],
    sea: [C.teal1, C.teal2, C.teal3],
    blood: [C.red0, C.red1, C.red2],
    voidm: [C.void, C.purple0, C.purple2],
    rust: [C.brown1, C.brown2, C.orange],
    leather: [C.brown0, C.brown1, C.brown2]
} as const satisfies Record<string, Mat>

/** Far end of the last drawn item, in the surface's coordinates. */
export const tip = { x: 0, y: 0 }

const R = Math.round

// Scratch output of at(), so drawers never allocate a tuple.
let AX = 0
let AY = 0
function at(hx: number, hy: number, a: number, d: number): void {
    AX = R(hx + Math.cos(a) * d)
    AY = R(hy + Math.sin(a) * d)
}

/** Straight blade with a highlight edge, crossguard and pommel. */
export function sword(s: Surface, hx: number, hy: number, a: number, len: number, blade: Mat, guard: Mat, grip: number, wide = false): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const sx = R(hx + dx * 2)
    const sy = R(hy + dy * 2)
    const tx = R(hx + dx * len)
    const ty = R(hy + dy * len)
    line(s, sx, sy, tx, ty, blade[1], wide ? 3 : 2)
    const nx = R(dy)
    const ny = R(-dx)
    line(s, sx - nx, sy + ny, tx - nx, ty + ny, blade[2])
    if (wide) line(s, sx + nx, sy - ny, tx + nx, ty - ny, blade[0])
    px(s, tx, ty, C.white)
    const gw = wide ? 4 : 3
    line(s, sx - R(-dy * gw), sy - R(dx * gw), sx + R(-dy * gw), sy + R(dx * gw), guard[1])
    px(s, sx, sy, guard[2])
    line(s, hx, hy, R(hx - dx * 2), R(hy - dy * 2), grip)
    px(s, R(hx - dx * 3), R(hy - dy * 3), guard[0])
    tip.x = tx; tip.y = ty
}

export function dagger(s: Surface, hx: number, hy: number, a: number, blade: Mat, grip: number): void {
    at(hx, hy, a, 7)
    const tx = AX
    const ty = AY
    at(hx, hy, a, 1)
    const bx = AX
    const by = AY
    line(s, bx, by, tx, ty, blade[1])
    px(s, R((bx + tx) / 2), R((by + ty) / 2), blade[2])
    px(s, tx, ty, C.white)
    at(hx, hy, a + Math.PI / 2, 1.5); px(s, AX, AY, blade[0])
    at(hx, hy, a - Math.PI / 2, 1.5); px(s, AX, AY, blade[0])
    at(hx, hy, a, -2); px(s, AX, AY, grip)
    tip.x = tx; tip.y = ty
}

/** Axe: haft plus a bearded head. `double` gives a second bit (great axes). */
/**
 * An axe from the hand along `a`. The blade sits on the side the haft rotates away from as `a`
 * falls; `under` puts it on the other side, so an axe carried pointing down shows its edge
 * downward and a chop that swings `a` upward leads with the edge.
 */
export function axe(s: Surface, hx: number, hy: number, a: number, haft: number, head: Mat, wood: Mat, double = false, under = false): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const nx = under ? dy : -dy
    const ny = under ? -dx : dx
    line(s, R(hx - dx * 3), R(hy - dy * 3), R(hx + dx * haft), R(hy + dy * haft), wood[1], 2)
    line(s, R(hx - dx * 3), R(hy - dy * 3), R(hx + dx * haft), R(hy + dy * haft), wood[2])
    const cx = hx + dx * (haft - 2)
    const cy = hy + dy * (haft - 2)
    // blade on the −normal side of the haft, with a curved edge
    for (let k = -3; k <= 3; k++) {
        const w = 5 - Math.abs(k) * 0.6
        const bx0 = cx + dx * k
        const by0 = cy + dy * k
        line(s, R(bx0 - nx * 1), R(by0 - ny * 1), R(bx0 - nx * w), R(by0 - ny * w), head[1])
        px(s, R(bx0 - nx * w), R(by0 - ny * w), head[2])
        if (double) {
            line(s, R(bx0 + nx * 1), R(by0 + ny * 1), R(bx0 + nx * w), R(by0 + ny * w), head[1])
            px(s, R(bx0 + nx * w), R(by0 + ny * w), head[2])
        }
    }
    line(s, R(cx - dx * 3 - nx * 2), R(cy - dy * 3 - ny * 2), R(cx + dx * 3 - nx * 2), R(cy + dy * 3 - ny * 2), head[0])
    px(s, R(cx + dx * 4), R(cy + dy * 4), head[2])
    tip.x = R(cx - nx * 5); tip.y = R(cy - ny * 5)
}

export function hammer(s: Surface, hx: number, hy: number, a: number, haft: number, head: Mat, wood: Mat): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const nx = -dy
    const ny = dx
    line(s, R(hx - dx * 4), R(hy - dy * 4), R(hx + dx * haft), R(hy + dy * haft), wood[1], 2)
    for (let k = 0; k < 5; k++) {
        const cx = hx + dx * (haft - 1 + k)
        const cy = hy + dy * (haft - 1 + k)
        const c = k === 0 || k === 4 ? head[0] : (k === 1 ? head[2] : head[1])
        line(s, R(cx - nx * 4), R(cy - ny * 4), R(cx + nx * 4), R(cy + ny * 4), c)
    }
    px(s, R(hx + dx * haft - nx * 4), R(hy + dy * haft - ny * 4), C.white)
    px(s, R(hx - dx * 5), R(hy - dy * 5), head[1])
    tip.x = R(hx + dx * (haft + 2)); tip.y = R(hy + dy * (haft + 2))
}

export function mace(s: Surface, hx: number, hy: number, a: number, haft: number, head: Mat, wood: Mat): void {
    at(hx, hy, a, haft)
    const ex = AX
    const ey = AY
    line(s, R(hx - Math.cos(a) * 2), R(hy - Math.sin(a) * 2), ex, ey, wood[1], 2)
    disc(s, ex, ey, 2.4, head[1])
    px(s, ex - 1, ey - 1, head[2])
    at(ex, ey, a, 3); px(s, AX, AY, head[0])
    at(ex, ey, a + 1.6, 3); px(s, AX, AY, head[0])
    at(ex, ey, a - 1.6, 3); px(s, AX, AY, head[0])
    tip.x = ex; tip.y = ey
}

/** A flanged mace: a gripped haft and a head of four flanges around a spiked cap. */
export function flangedMace(s: Surface, hx: number, hy: number, a: number, haft: number, head: Mat, grip: Mat): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const at2 = (u: number, v: number) => [R(hx + dx * u - dy * v), R(hy + dy * u + dx * v)] as const
    const seg = (u0: number, v0: number, u1: number, v1: number, c: number, w = 1) => {
        const [x0, y0] = at2(u0, v0)
        const [x1, y1] = at2(u1, v1)
        line(s, x0, y0, x1, y1, c, w)
    }
    seg(-2, 0, haft, 0, grip[1], 2)
    seg(-2, 0, 1, 0, grip[0], 2)
    for (let k = 0; k < 5; k++) {
        const w = k === 0 || k === 4 ? 2 : 3
        seg(haft + k, -w, haft + k, w, k === 1 ? head[2] : head[1])
        const [ex, ey] = at2(haft + k, -w)
        px(s, ex, ey, head[2])
        const [fx, fy] = at2(haft + k, w)
        px(s, fx, fy, head[0])
    }
    const [tx, ty] = at2(haft + 5, 0)
    px(s, tx, ty, C.white)
    tip.x = tx; tip.y = ty
}

export function spear(s: Surface, hx: number, hy: number, a: number, len: number, head: Mat, wood: Mat): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    line(s, R(hx - dx * 8), R(hy - dy * 8), R(hx + dx * len), R(hy + dy * len), wood[1])
    line(s, R(hx - dx * 8), R(hy - dy * 8), R(hx + dx * (len - 4)), R(hy + dy * (len - 4)), wood[1], 2)
    const bx = hx + dx * len
    const by = hy + dy * len
    const nx = -dy
    const ny = dx
    tri(s, bx + nx * 2, by + ny * 2, bx - nx * 2, by - ny * 2, bx + dx * 6, by + dy * 6, head[1])
    line(s, R(bx), R(by), R(bx + dx * 5), R(by + dy * 5), head[2])
    px(s, R(bx - dx), R(by - dy), C.red2)
    tip.x = R(bx + dx * 6); tip.y = R(by + dy * 6)
}

export function scythe(s: Surface, hx: number, hy: number, a: number, len: number, blade: Mat, wood: Mat): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    line(s, R(hx - dx * 6), R(hy - dy * 6), R(hx + dx * len), R(hy + dy * len), wood[1], 2)
    const ex = hx + dx * len
    const ey = hy + dy * len
    for (let k = 0; k <= 10; k++) {
        const u = k / 10
        const ang = a - Math.PI / 2 - u * 1.9
        const r = 9 - u * 2
        const bx = ex + Math.cos(ang) * r * 0.9 + dx * (u * 3)
        const by = ey + Math.sin(ang) * r * 0.9 + dy * (u * 3)
        line(s, R(ex + dx * u * 2), R(ey + dy * u * 2), R(bx), R(by), k < 8 ? blade[1] : blade[0])
        if (k > 1) px(s, R(bx), R(by), blade[2])
    }
    tip.x = R(ex); tip.y = R(ey)
}

export const enum Gem { Orb, Crystal, Claw, Skull, Totem, Moon, Flame }

/**
 * A pair of antlers rising from (x, y) along angle `a`: a 2 px beam curving out to each side,
 * a brow tine and an outer tine off it, white at the points. The far antler sits in shadow.
 * Returns the point between them, where a spirit glint or a spell leaves from.
 */
export function antlers(s: Surface, x: number, y: number, a: number): { x: number, y: number } {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const at = (u: number, v: number) => [R(x + dx * u - dy * v), R(y + dy * u + dx * v)] as const
    const seg = (u0: number, v0: number, u1: number, v1: number, c: number, w = 1) => {
        const [x0, y0] = at(u0, v0)
        const [x1, y1] = at(u1, v1)
        line(s, x0, y0, x1, y1, c, w)
    }
    for (const side of [-1, 1]) {
        const c = side < 0 ? C.bone0 : C.bone1
        seg(0, 0, 3, 3 * side, c, 2)
        seg(3, 3 * side, 7, 4 * side, c)
        seg(7, 4 * side, 8, 3 * side, c)
        seg(3, 3 * side, 5, 1 * side, c)
        seg(5, 4 * side, 6, 6 * side, c)
        for (const [u, v] of [[8, 3], [5, 1], [6, 6]] as const) {
            const [px0, py0] = at(u, v * side)
            px(s, px0, py0, side < 0 ? C.bone1 : C.white)
        }
    }
    const [cx, cy] = at(5, 0)
    return { x: cx, y: cy }
}

/** A caster's staff with a head ornament. `glow` 0..1 brightens it. */
export function staff(s: Surface, hx: number, hy: number, a: number, len: number, wood: Mat, gem: Mat, style: Gem, glow: number, t: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const tx = R(hx + dx * len)
    const ty = R(hy + dy * len)
    line(s, R(hx - dx * 10), R(hy - dy * 10), tx, ty, wood[1], 2)
    line(s, R(hx - dx * 10), R(hy - dy * 10), tx, ty, wood[2])
    px(s, R(hx - dx * 10), R(hy - dy * 10), wood[0])
    const gx = R(tx + dx * 2)
    const gy = R(ty + dy * 2)
    const lit = glow > 0.5 || (Math.floor(t * 5) & 3) === 0
    switch (style) {
        case Gem.Orb:
            px(s, tx - 2, ty - 1, M.gold[0]); px(s, tx + 2, ty - 1, M.gold[0])
            disc(s, gx, gy, 2, gem[1])
            px(s, gx - 1, gy - 1, lit ? C.white : gem[2])
            break
        case Gem.Crystal:
            tri(s, gx - 2, gy + 1, gx + 2, gy + 1, gx, gy - 5, gem[1])
            tri(s, gx - 2, gy + 1, gx + 2, gy + 1, gx, gy + 3, gem[0])
            line(s, gx - 1, gy, gx, gy - 4, gem[2])
            px(s, gx, gy - 3, lit ? C.white : gem[2])
            px(s, tx - 2, ty, wood[2]); px(s, tx + 2, ty, wood[2])
            break
        case Gem.Claw:
            px(s, tx - 2, ty - 1, M.gold[1]); px(s, tx + 2, ty - 1, M.gold[1])
            px(s, tx - 2, ty - 2, M.gold[2]); px(s, tx + 2, ty - 2, M.gold[2])
            rect(s, gx - 1, gy - 2, 3, 5, gem[1])
            rect(s, gx - 2, gy - 1, 5, 3, gem[1])
            rect(s, gx - 1, gy - 1, 2, 2, lit ? gem[2] : gem[1])
            px(s, gx - 1, gy - 1, C.white)
            break
        case Gem.Skull:
            rect(s, gx - 2, gy - 3, 5, 4, C.bone1)
            rect(s, gx - 1, gy + 1, 3, 1, C.bone0)
            px(s, gx - 1, gy - 2, lit ? gem[2] : C.ink); px(s, gx + 1, gy - 2, lit ? gem[2] : C.ink)
            px(s, gx - 2, gy - 3, C.white)
            px(s, gx, gy - 5 - (Math.floor(t * 8) & 1), gem[1])
            px(s, gx - 1, gy - 4, gem[1]); px(s, gx + 1, gy - 4, gem[0])
            break
        case Gem.Totem: {
            // antlers lashed to the staff head, a bead charm hanging from the binding
            const c = antlers(s, tx, ty, a)
            px(s, tx, ty, C.brown0); px(s, R(tx - dx), R(ty - dy), C.brown3)
            px(s, tx - 2, ty + 1, gem[1]); px(s, tx - 2, ty + 2, gem[2]); px(s, tx - 2, ty + 3, C.red2)
            if (lit) { px(s, c.x, c.y, C.white); px(s, c.x - 1, c.y, gem[2]); px(s, c.x + 1, c.y, gem[2]) }
            tip.x = c.x; tip.y = c.y
            return
        }
        case Gem.Moon:
            arc(s, gx, gy - 1, 3, Math.PI * 0.6, Math.PI * 2.1, gem[1])
            arc(s, gx, gy - 1, 2, Math.PI * 0.7, Math.PI * 1.9, gem[2])
            px(s, gx + 1, gy - 1, lit ? C.white : gem[0])
            break
        case Gem.Flame: {
            const f = Math.floor(t * 10) & 3
            rect(s, gx - 1, gy - 1, 3, 2, M.obsidian[1])
            tri(s, gx - 2, gy - 1, gx + 2, gy - 1, gx + (f & 1), gy - 6 - (f >> 1), gem[1])
            tri(s, gx - 1, gy - 1, gx + 1, gy - 1, gx, gy - 4, gem[2])
            px(s, gx, gy - 2, C.white)
            break
        }
    }
    tip.x = gx; tip.y = gy - 1
}

/** Bow held at (hx, hy) aimed along `a`; `pull` 0..1 draws the string back, `nock` shows an arrow. */
export function bow(s: Surface, hx: number, hy: number, a: number, pull: number, nock: boolean, wood: Mat, size = 8, arrowTip: number = C.steel3): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const nx = -dy
    const ny = dx
    const bend = 3 + R(pull * 2)
    let t0x = 0; let t0y = 0; let t1x = 0; let t1y = 0
    for (let i = -size; i <= size; i++) {
        const k = i / size
        const b = R(bend * Math.cos(k * Math.PI * 0.5)) - 1
        const x = R(hx + nx * i + dx * b)
        const y = R(hy + ny * i + dy * b)
        const end = i <= -size + 1 || i >= size - 1
        px(s, x, y, end ? wood[0] : (i < 0 ? wood[2] : wood[1]))
        if (!end) px(s, x, y + 1, wood[0])
        if (i === -size) { t0x = x; t0y = y }
        if (i === size) { t1x = x; t1y = y }
    }
    const pl = 1 + pull * 8
    const sx = R(hx - dx * pl)
    const sy = R(hy - dy * pl)
    line(s, t0x, t0y, sx, sy, C.bone1)
    line(s, sx, sy, t1x, t1y, C.bone1)
    if (nock) {
        const ax = R(sx + dx * 13)
        const ay = R(sy + dy * 13)
        line(s, sx, sy, ax, ay, C.brown3)
        px(s, ax, ay, C.white)
        px(s, R(ax - dx), R(ay - dy), arrowTip)
        px(s, sx, sy - 1, C.red2)
        px(s, sx + 1, sy - 1, C.red2)
    }
    tip.x = R(hx + dx * 4); tip.y = R(hy + dy * 4)
}

/**
 * A crossbow held at (hx, hy) aimed along `a`: a stock running forward from the hand, a short
 * prod across its nose, and the string drawn back to the latch while `spanned`, when a bolt
 * lies in the groove. Loosed, the string snaps forward to the prod.
 */
export function crossbow(s: Surface, hx: number, hy: number, a: number, spanned: boolean, stock: Mat, prod: Mat, boltTip: number = C.steel3): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const at = (u: number, v: number) => [R(hx + dx * u - dy * v), R(hy + dy * u + dx * v)] as const
    const seg = (u0: number, v0: number, u1: number, v1: number, c: number, w = 1) => {
        const [x0, y0] = at(u0, v0)
        const [x1, y1] = at(u1, v1)
        line(s, x0, y0, x1, y1, c, w)
    }
    const nose = 9
    seg(-4, 1, 0, 1, stock[0], 2) // the butt, dropped below the line of the stock
    seg(-1, 0, nose, 0, stock[1], 2)
    seg(0, -1, nose - 1, -1, stock[2])
    // the prod: a stiff bow standing across the nose, its limbs only just curling back
    for (const side of [-1, 1]) {
        seg(nose, 0, nose, 2 * side, prod[1], 2)
        seg(nose, 2 * side, nose - 1, 4 * side, prod[side < 0 ? 0 : 1])
        seg(nose - 1, 4 * side, nose - 2, 5 * side, prod[side < 0 ? 0 : 1])
        const [ex, ey] = at(nose - 2, 5 * side)
        px(s, ex, ey, prod[2])
    }
    const latch = spanned ? 3 : nose - 1
    seg(nose - 2, -5, latch, -1, C.bone0)
    seg(latch, 1, nose - 2, 5, C.bone0)
    const [lx, ly] = at(2, 1)
    px(s, lx, ly, C.ink) // trigger
    if (spanned) {
        seg(2, -1, nose + 2, -1, C.brown3)
        const [bx, by] = at(nose + 2, -1)
        px(s, bx, by, boltTip)
        const [fx, fy] = at(2, -2)
        px(s, fx, fy, C.red2)
    }
    const [tx, ty] = at(nose + 2, -1)
    tip.x = tx; tip.y = ty
}

export const enum ShieldStyle { Round, Kite, Tower, Buckler, Heater, Targe, Pavise }

/** Shield seen from the side-front, centred on (x, y). */
export function shield(s: Surface, x: number, y: number, style: ShieldStyle, rimM: Mat, face: Mat, emblem: number): void {
    x = R(x); y = R(y)
    switch (style) {
        case ShieldStyle.Round:
            rect(s, x - 3, y - 5, 6, 11, rimM[1])
            rect(s, x - 2, y - 6, 4, 13, rimM[1])
            rect(s, x - 2, y - 4, 4, 9, face[1])
            rect(s, x - 1, y - 5, 2, 11, face[1])
            rect(s, x - 2, y - 4, 1, 9, face[2])
            rect(s, x, y - 2, 1, 5, emblem)
            rect(s, x - 1, y, 3, 1, emblem)
            px(s, x, y, rimM[2])
            break
        case ShieldStyle.Kite:
            rect(s, x - 3, y - 6, 7, 8, rimM[1])
            tri(s, x - 3, y + 2, x + 3, y + 2, x, y + 8, rimM[1])
            rect(s, x - 2, y - 5, 5, 7, face[1])
            tri(s, x - 2, y + 2, x + 2, y + 2, x, y + 6, face[1])
            rect(s, x - 2, y - 5, 1, 7, face[2])
            rect(s, x, y - 4, 1, 8, emblem)
            rect(s, x - 2, y - 2, 5, 1, emblem)
            px(s, x, y - 2, rimM[2])
            break
        case ShieldStyle.Tower:
            rect(s, x - 3, y - 9, 7, 18, rimM[1])
            rect(s, x - 2, y - 8, 5, 16, face[1])
            rect(s, x - 2, y - 8, 1, 16, face[2])
            rect(s, x + 2, y - 8, 1, 16, face[0])
            rect(s, x - 1, y - 3, 3, 5, emblem)
            px(s, x, y - 4, emblem); px(s, x, y + 2, emblem)
            rect(s, x - 3, y - 9, 7, 1, rimM[2])
            break
        case ShieldStyle.Buckler:
            disc(s, x, y, 3, rimM[1])
            disc(s, x, y, 2, face[1])
            px(s, x, y, emblem)
            px(s, x - 1, y - 2, face[2])
            break
        case ShieldStyle.Targe:
            // a round shield cut to chibi size, for a shield carried in front of the body
            disc(s, x, y, 4.5, rimM[1])
            disc(s, x, y, 3.5, face[1])
            px(s, x - 2, y - 2, face[2]); px(s, x - 1, y - 3, face[2]); px(s, x - 3, y - 1, face[2])
            rect(s, x - 1, y - 1, 3, 3, rimM[2])
            px(s, x, y, emblem)
            break
        case ShieldStyle.Pavise:
            // a tower shield cut to chibi size: as tall as a shield in front can be
            rect(s, x - 4, y - 5, 8, 12, rimM[1])
            rect(s, x - 3, y - 4, 6, 10, face[1])
            rect(s, x - 3, y - 4, 1, 10, face[2])
            rect(s, x + 2, y - 4, 1, 10, face[0])
            rect(s, x - 1, y - 2, 2, 5, emblem)
            rect(s, x - 2, y - 1, 4, 1, emblem)
            rect(s, x - 4, y - 5, 8, 1, rimM[2])
            break
        case ShieldStyle.Heater:
            // a kite cut down to chibi size, for a shield carried in front of the body
            rect(s, x - 3, y - 5, 7, 6, rimM[1])
            tri(s, x - 3, y + 1, x + 3, y + 1, x, y + 5, rimM[1])
            rect(s, x - 2, y - 4, 5, 5, face[1])
            tri(s, x - 2, y + 1, x + 2, y + 1, x, y + 4, face[1])
            rect(s, x - 2, y - 4, 1, 5, face[2])
            rect(s, x - 3, y - 5, 7, 1, rimM[2])
            rect(s, x, y - 3, 1, 6, emblem)
            rect(s, x - 2, y - 1, 5, 1, emblem)
            break
    }
}

export function tome(s: Surface, x: number, y: number, cover: Mat, glow: number): void {
    x = R(x); y = R(y)
    rect(s, x - 3, y - 3, 6, 5, cover[1])
    rect(s, x - 3, y + 2, 6, 1, C.bone1)
    rect(s, x - 3, y - 3, 1, 6, cover[0])
    px(s, x, y - 1, glow > 0.5 ? C.white : M.gold[1])
    px(s, x + 1, y - 1, M.gold[1])
    px(s, x, y, M.gold[1])
}

/** A floating orb (control casters), with a 1px ring when lit. */
export function orb(s: Surface, x: number, y: number, m: Mat, glow: number, t: number): void {
    x = R(x); y = R(y)
    disc(s, x, y, 2, m[1])
    px(s, x - 1, y - 1, m[2])
    px(s, x + 1, y + 1, m[0])
    if (glow > 0.3) {
        const f = Math.floor(t * 10) & 1
        ring(s, x, y, 4 + f, m[glow > 0.7 ? 2 : 1])
    }
    tip.x = x; tip.y = y
}

/** Fist wraps — the Beginner's weapon is his hands. */
export function fist(s: Surface, hx: number, hy: number, wrap: number, knuckle: number): void {
    rect(s, hx - 1, hy - 1, 3, 3, wrap)
    px(s, hx + 1, hy - 1, knuckle)
    px(s, hx - 1, hy + 1, C.bone0)
    tip.x = R(hx + 2); tip.y = R(hy)
}

/** An arrow in flight (projectile), pointing along `a`. */
export function arrow(s: Surface, x: number, y: number, a: number, shaft: number, head: number, fletch: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    line(s, R(x - dx * 7), R(y - dy * 7), R(x), R(y), shaft)
    px(s, R(x), R(y), head)
    px(s, R(x - dx), R(y - dy), head)
    px(s, R(x - dx * 7 - dy), R(y - dy * 7 + dx), fletch)
    px(s, R(x - dx * 7 + dy), R(y - dy * 7 - dx), fletch)
    px(s, R(x - dx * 6 - dy), R(y - dy * 6 + dx), fletch)
    px(s, R(x - dx * 6 + dy), R(y - dy * 6 - dx), fletch)
}
