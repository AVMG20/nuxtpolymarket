// World bosses and super bosses, Worlds 6–10 — the walk past the Void's door and out through
// the edge of the world. See bosses-a.ts for the shared conventions.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { CF, fr, sm, span } from './creature'
import type { Mat } from './weapons'
import {
    B, Entry, bossStates, drive, finish, bz, ball, chain, tentacle, glowEye, wing, speckle,
    limbT, reach, elbow, P, rect, px, line, disc, ellipse, tri, quad, dither, ditherEllipse, ring, arc, poly, q, wv, bayer, hash2
} from './boss-kit'
import { Surface, ditherDisc } from './surface'

const R = Math.round

const VIOLET: Mat = [C.purple0, C.purple1, C.purple2]
const VOIDM: Mat = [C.ink, C.void, C.purple0]
const BONE: Mat = [C.bone0, C.bone1, C.white]
const RUST_ARMOR: Mat = [C.stone0, C.stone1, C.brown2]
const STONE: Mat = [C.stone1, C.stone2, C.stone3]
const STORM: Mat = [C.night2, C.night3, C.haze]
const FEATHER: Mat = [C.stone1, C.stone2, C.steel2]
const FADED: Mat = [C.stone2, C.stone3, C.bone0]

/** Void interior: black speckled with stars that twinkle on the frame grid. */
function voidFill(s: Parameters<CreatureDef['draw']>[0], x: number, y: number, w: number, h: number, t: number, seed: number): void {
    for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
            const X = x + xx
            const Y = y + yy
            if (s.get(X, Y) === 0) continue
            const r = hash2(X * 31 + seed, Y)
            const tw = (fr(t, 4, 3) + ((X + Y) & 3)) % 3
            s.set(X, Y, r < 0.02 ? (tw ? C.white : C.haze) : r < 0.05 ? C.purple1 : bayer(X, Y, 3) ? C.void : C.ink)
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 6 · Duskspire

// Stage 5: Magister Halvane, master of the tower schools, floating with his grimoires orbiting
// him. Stage 10: Archmage Ithren, the Door-Opener, holding open the door he opened to the Void.

const SKIN: Mat = [C.skin0, C.skin1, C.skin2]
const BOOKS: readonly Mat[] = [[C.red0, C.red1, C.red2], [C.teal0, C.teal1, C.teal2], [C.blue0, C.blue1, C.blue2]]

/** A grimoire at (x, y): a cover with a darker spine, gold corners and a sigil; `open` fans its pages. */
function grimoire(s: Surface, x: number, y: number, m: Mat, open: number, t: number): void {
    if (open > 0.5) {
        // flung open, pages fanning in the draught of the spell
        const flap = Math.floor(t * 12) & 1
        quad(s, x, y + 4, x - 7, y - 1, x - 7, y - 6, x, y - 1, m[1])
        quad(s, x, y + 4, x + 7, y - 1, x + 7, y - 6, x, y - 1, m[0])
        quad(s, x, y + 3, x - 6, y - 1, x - 6, y - 5 - flap, x, y - 1, C.bone1)
        quad(s, x, y + 3, x + 6, y - 1, x + 6, y - 5 + flap, x, y - 1, C.white)
        line(s, x - 4, y - 2, x - 2, y - 1, C.pink); line(s, x + 2, y - 2, x + 4, y - 3, C.cyan) // the lit script
        return
    }
    rect(s, x - 4, y - 4, 9, 8, m[1])
    rect(s, x - 4, y - 4, 2, 8, m[0]) // the spine
    line(s, x - 2, y - 4, x + 4, y - 4, m[2])
    rect(s, x + 4, y - 3, 1, 6, C.bone1) // the page edges
    px(s, x - 2, y - 4, C.gold2); px(s, x + 4, y + 3, C.gold1); px(s, x - 2, y + 3, C.gold1); px(s, x + 4, y - 4, C.gold2)
    // the sigil: a gold ring round a lit point
    px(s, x + 1, y - 2, C.gold2); px(s, x - 1, y, C.gold2); px(s, x + 3, y, C.gold1); px(s, x + 1, y + 2, C.gold1)
    px(s, x + 1, y, C.cyan)
}

/**
 * A robed arm from the shoulder (sx, sy) to the wrist (wx, wy), bending at the elbow toward `bend`:
 * a fitted upper sleeve, a forearm flaring into a bell sleeve whose cloth hangs below it, the
 * opening lined dark with a gold cuff. Leaves where the hand comes out in P.
 */
function robedArm(s: Surface, sx: number, sy: number, wx: number, wy: number, bend: number, m: Mat, t: number): void {
    elbow(sx, sy, wx, wy, 9, 9, bend)
    const ex = P.x
    const ey = P.y
    limbT(s, sx, sy, ex, ey, 5, 4, m)
    // the drape of the bell sleeve, hanging from under the forearm
    const d = Math.floor(t * 4) & 1
    const mx = ex + (wx - ex) * 0.35
    const my = ey + (wy - ey) * 0.35
    tri(s, mx, my + 1, wx, wy + 2, wx - 2 + d, wy + 8, m[0])
    tri(s, mx, my + 1, wx - 2 + d, wy + 8, mx - 1, my + 4, m[0])
    line(s, R(mx - 1), R(my + 4), R(wx - 2 + d), R(wy + 8), C.gold1)
    limbT(s, ex, ey, wx, wy, 4, 6, m)
    // the opening: dark lining inside a gold cuff
    const ux = (wx - ex) / (Math.hypot(wx - ex, wy - ey) || 1)
    const uy = (wy - ey) / (Math.hypot(wx - ex, wy - ey) || 1)
    line(s, R(wx - uy * 3), R(wy + ux * 3), R(wx + uy * 3), R(wy - ux * 3), C.gold1)
    line(s, R(wx - uy * 2 + ux), R(wy + ux * 2 + uy), R(wx + uy * 2 + ux), R(wy - ux * 2 + uy), C.night1)
    P.x = wx + ux * 2
    P.y = wy + uy * 2
}

/**
 * Magister Halvane, master of Duskspire's schools: floating in arcane robes, violet with a night-blue
 * panel of glowing runes down the front, moons and stars stitched in gold, a rune-lit hem trailing
 * off into smoke; a standing collar and a star-pinned mantle, a sigil medallion at his belt, a
 * twilight cape full of stars. The tall bent hat of his order, banded in runes; a long stranded
 * beard, bushy white brows over eyes lit pink. His grimoires orbit him. The staff, a gold crescent
 * cradling a star, stands in his far hand behind him; the near hand holds an arcane orb out at the
 * party, draws it back as the books fly open, and thrusts it to loose a bolt at the front rank.
 */
export const MAGISTER_HALVANE: CreatureDef = {
    name: 'Magister Halvane', size: 96, shadow: 12, hover: 1, accent: C.pink,
    states: bossStates(1.2, 1.8, 1.8),
    draw(s, st, t) {
        drive(this, st, t, 4, 1.8)
        const x = s.ax - 2 + B.lunge - B.kb
        const y = s.ay
        const hover = -8 + wv(t, 1.8, 2) + R(B.die * 10)
        const hip = y - 22 + hover
        const top = hip - 22
        const sway = wv(t, 1.2, 2)
        const open = B.wind > 0.3 || B.strike || B.rec > 0.4 || B.roar ? 1 : 0
        const rune = fr(t, 5, 6)
        // the grimoires orbiting him, one full turn per idle loop so it closes seamlessly; the far
        // half of the orbit goes behind
        const spin = (Math.PI * 2) / this.states.idle!.dur
        const orbit = (front: boolean) => {
            for (let i = 0; i < 3; i++) {
                const a = q(t) * spin + i * (Math.PI * 2 / 3)
                const z = Math.sin(a)
                if ((z > 0) !== front) continue
                grimoire(s, x + R(Math.cos(a) * 26), top + 12 + R(z * 6), front ? BOOKS[i]! : [C.void, BOOKS[i]![0], BOOKS[i]![1]], open, t + i * 0.3)
            }
        }
        orbit(false)
        // the twilight cape streaming behind him, full of stars
        poly(s, [-5, 0, 0, 0, -6, 20, -18 + sway, 38, -24 + sway, 34, -12, 18], x, top, C.night1)
        poly(s, [-5, 0, -2, 0, -8, 20, -18 + sway, 36, -21 + sway, 34, -11, 18], x, top, C.night2)
        line(s, x - 5, top, x - 11, top + 18, C.night3)
        for (let i = 0; i < 6; i++) px(s, x - 8 - (i * 5) % 13 + R(sway * i / 6), top + 8 + i * 5, i & 1 ? C.white : C.frost)
        // the standing collar, behind his head
        poly(s, [-7, 1, -1, 0, -4, -9, -10, -6], x, top, C.purple0)
        line(s, x - 7, top + 1, x - 10, top - 6, C.gold1); line(s, x - 10, top - 6, x - 4, top - 9, C.gold2)
        line(s, x - 6, top - 1, x - 8, top - 5, C.cyan)
        // the staff in the far hand, behind him: lifted on the wind-up, tipped forward on the strike
        const shx = x - 15
        const shy = top + 14 + R(sway / 2) + R(bz(0, -6, 0))
        const sa = bz(-1.62, -1.62, -1.5)
        const sdx = Math.cos(sa)
        const sdy = Math.sin(sa)
        line(s, R(shx - sdx * 20), R(shy - sdy * 20), R(shx + sdx * 26), R(shy + sdy * 26), C.brown1, 2)
        line(s, R(shx - sdx * 20 + 1), R(shy - sdy * 20), R(shx + sdx * 26 + 1), R(shy + sdy * 26), C.brown2)
        px(s, R(shx - sdx * 20), R(shy - sdy * 20), C.gold2)
        const cx = shx + sdx * 30
        const cy = shy + sdy * 30
        arc(s, cx, cy, 4, sa + 0.9, sa + 2 * Math.PI - 0.9, C.gold1)
        arc(s, cx, cy, 3.4, sa + 1.1, sa + 2 * Math.PI - 1.1, C.gold2)
        tri(s, cx - 2, cy, cx + 2, cy, cx, cy - 3, C.pink); tri(s, cx - 2, cy, cx + 2, cy, cx, cy + 3, C.pink) // the star it cradles
        line(s, R(cx) - 3, R(cy), R(cx) + 3, R(cy), C.pink)
        px(s, cx, cy, C.white)
        robedArm(s, x - 4, top + 3, shx + 3, shy + 1, -1, [C.purple0, C.purple1, C.purple1], t)
        // the fist round the staff
        disc(s, shx, shy, 2, C.skin0)
        line(s, shx - 1, shy - 1, shx + 1, shy - 1, C.skin1)
        // the robe, shaped and lit, its hem trailing off into violet smoke
        poly(s, [-7, 0, 7, 0, 9, 20, 12, 34, -14, 34, -10, 20], x, top, VIOLET[1])
        poly(s, [-7, 0, -3, 0, -4, 20, -5, 34, -14, 34, -10, 20], x, top, VIOLET[0])
        line(s, x + 6, top + 2, x + 11, top + 32, C.purple2)
        // moons and stars stitched in gold across the skirt
        for (const [ox, oy] of [[-8, 24], [-2, 28], [7, 26], [-10, 30], [5, 30]] as const) px(s, x + ox, top + oy, C.gold2)
        disc(s, x - 5, top + 25, 2, C.gold3); disc(s, x - 4, top + 24, 1.6, VIOLET[0]) // a crescent moon
        // the panel of runes down the front, night blue between gold lines, glowing in turn
        poly(s, [1, 0, 5, 0, 8, 33, -1, 33], x, top, C.night1)
        line(s, x + 1, top, x - 1, top + 33, C.gold1); line(s, x + 5, top, x + 8, top + 33, C.gold1)
        for (let i = 0; i < 6; i++) {
            const gx = x + 3 + R(i * 0.25)
            const gy = top + 5 + i * 5
            const c = (i + rune) % 3 === 0 ? C.white : i & 1 ? C.cyan : C.pink
            px(s, gx, gy, c); px(s, gx - 1, gy + 1, c); px(s, gx + 1, gy + 1, c); if (i & 1) px(s, gx, gy + 2, c)
        }
        // the hem band, runes glowing along it
        rect(s, x - 13, top + 32, 25, 2, C.gold1)
        for (let i = 0; i < 7; i++) px(s, x - 12 + i * 4, top + 32, (i + rune) % 3 === 0 ? C.white : i & 1 ? C.pink : C.cyan)
        for (let i = 0; i < 6; i++) {
            const wx = x - 12 + i * 4 + R(Math.sin(t * 3 + i) * 1.5)
            tri(s, wx - 2, top + 34, wx + 2, top + 34, wx + R(sway), top + 40 + (i & 1) * 3, i & 1 ? C.purple0 : C.purple1)
        }
        dither(s, x - 14, top + 38, 26, 6, C.purple0, 5)
        // the belt and the sigil medallion of the order
        rect(s, x - 8, top + 17, 16, 2, C.gold0)
        line(s, x - 8, top + 17, x + 7, top + 17, C.gold1)
        ring(s, x + 3, top + 18, 3, C.gold2)
        disc(s, x + 3, top + 18, 2, C.night1)
        px(s, x + 3, top + 18, rune & 1 ? C.white : C.pink); px(s, x + 3, top + 16, C.cyan); px(s, x + 5, top + 18, C.cyan)
        // the mantle over his shoulders, pointed, gold-edged, pinned with stars
        poly(s, [-8, -1, 8, -1, 9, 5, 5, 8, 1, 6, -3, 8, -8, 5], x, top, C.night2)
        poly(s, [-8, -1, -3, -1, -3, 8, -8, 5], x, top, C.night1)
        line(s, x - 8, top + 5, x - 3, top + 8, C.gold1); line(s, x - 3, top + 8, x + 1, top + 6, C.gold1)
        line(s, x + 1, top + 6, x + 5, top + 8, C.gold1); line(s, x + 5, top + 8, x + 9, top + 5, C.gold1)
        px(s, x - 6, top + 1, C.gold3); px(s, x + 6, top + 1, C.gold3) // the star pins
        // the near arm holding the arcane orb out at the party, elbow down, under the beard: drawn
        // back as the orb gathers, thrust to loose it
        const gx = x + 17 + R(bz(0, -6, 4))
        const gy = top + 8 + R(bz(0, -5, -2))
        robedArm(s, x + 5, top + 2, gx, gy, 1, VIOLET, t)
        const hax = P.x
        const hay = P.y
        disc(s, hax, hay, 2, C.skin1)
        px(s, hax + 2, hay - 1, C.skin1); px(s, hax + 2, hay + 1, C.skin0) // the fingers cupped under the orb
        // the head: a long nose, bushy white brows, eyes lit pink, a long stranded beard
        const hx = x + 2
        const hy = top - 1
        ball(s, hx + 1, hy - 6, 5, 6, SKIN)
        rect(s, hx + 3, hy - 8, 3, 3, C.skin2) // the lit cheek
        px(s, hx + 6, hy - 7, C.skin1); px(s, hx + 7, hy - 6, C.skin1); px(s, hx + 7, hy - 5, C.skin0) // the nose
        const eye = B.hurt ? C.ink : B.glow > 0.5 ? C.white : C.pink
        if (!B.hurt && B.glow > 0.3) ditherDisc(s, hx + 4, hy - 8, 3, C.pink, 3 + R(B.glow * 4))
        rect(s, hx + 3, hy - 8, 2, 1, C.ink); px(s, hx + 4, hy - 8, eye)
        line(s, hx + 1, hy - 10, hx + 6, hy - 10, C.white); line(s, hx + 6, hy - 10, hx + 8, hy - 11, C.bone1) // the brows
        // the beard falls in strands over the mantle to the belt
        poly(s, [-3, -4, 6, -4, 5, 4, 2, 17, 0, 9, -2, 4], hx, hy, C.bone1)
        poly(s, [-3, -4, 0, -4, 0, 9, -2, 4], hx, hy, C.bone0)
        for (let i = 0; i < 3; i++) line(s, hx + 1 + i * 2, hy - 2, hx + 1 + i, hy + 8 + i * 3, C.white)
        line(s, hx + 3, hy - 4, hx + 8, hy - 3, C.white); px(s, hx + 8, hy - 2, C.bone1) // the moustache
        if (B.roar || B.strike) rect(s, hx + 3, hy - 3, 3, 2, C.ink)
        // the tall hat of his order, the tip bent back, a band of runes, moons and stars on it
        const hty = hy - 3
        ellipse(s, hx, hty - 11, 10, 2, C.purple0)
        line(s, hx - 9, hty - 12, hx + 9, hty - 12, C.purple1)
        poly(s, [-6, -12, 6, -12, 2, -26, -3, -33, -10, -35, -5, -27], hx, hty, C.purple1)
        poly(s, [-6, -12, -2, -12, -3, -26, -5, -27], hx, hty, C.purple0)
        line(s, hx + 5, hty - 13, hx + 1, hty - 27, C.purple2)
        rect(s, hx - 6, hty - 15, 12, 2, C.gold1)
        line(s, hx - 6, hty - 15, hx + 5, hty - 15, C.gold2)
        for (let i = 0; i < 3; i++) px(s, hx - 4 + i * 4, hty - 14, (i + rune) % 3 === 0 ? C.white : C.cyan) // the runes on the band
        disc(s, hx, hty - 21, 2.2, C.gold3); disc(s, hx + 1, hty - 22, 1.8, C.purple1) // a crescent moon
        px(s, hx - 2, hty - 25, C.gold2); px(s, hx + 2, hty - 18, C.gold2); px(s, hx - 3, hty - 19, C.gold2) // stars
        px(s, hx - 10, hty - 36, C.gold3); px(s, hx - 11, hty - 35, C.gold2) // the star at the tip
        const ox = hax + 3
        const oy = hay - 3
        const power = Math.max(B.glow, 0.25)
        ditherDisc(s, ox, oy, 5 + power * 3, C.purple2, 3 + R(power * 5))
        disc(s, ox, oy, 3.5, C.purple1)
        disc(s, ox - 0.5, oy - 0.5, 2.8, C.purple2)
        disc(s, ox - 1, oy - 1, 1.6, C.pink)
        px(s, ox - 1, oy - 2, C.white)
        if (B.glow > 0.5) { px(s, ox, oy - 1, C.white); px(s, ox - 2, oy - 1, C.white) }
        // the rune ring turning round it
        const ra = q(t) * spin * 2
        for (let i = 0; i < 6; i++) {
            const a = ra + i * Math.PI / 3
            px(s, R(ox + Math.cos(a) * 6), R(oy + Math.sin(a) * 2.2), Math.sin(a) > 0 ? C.cyan : C.frost)
        }
        orbit(true)
        finish(s, Entry.Fade)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 10)
        for (let i = 0; i < 3; i++) dst.set(x + dir * (-12 + ((i * 11 + k * 3) % 26)), y - 60 + ((k * 5 + i * 13) % 50), C.pink)
        if ((st === 'attack' && B.strike) || B.roar) {
            // the bolt off the orb, a burst where it leaves
            const bx = x + dir * 28
            const by = y - 47
            for (let i = 0; i < 14; i++) {
                const a = (i / 14) * Math.PI * 2
                dst.set(bx + R(Math.cos(a) * 7), by + R(Math.sin(a) * 7), i & 1 ? C.white : C.cyan)
            }
            for (let i = 0; i < 18; i++) {
                dst.set(bx + dir * (6 + i * 2), by + R(i * 1.4), i % 3 ? C.pink : C.white)
                dst.set(bx + dir * (6 + i * 2), by + R(i * 1.4) + 1, C.purple2)
            }
        }
    }
}

const SILVER: Mat = [C.bone0, C.bone1, C.white]
const ASH: Mat = [C.stone2, C.stone3, C.bone0]
const VOID_IRON: Mat = [C.void, C.stone0, C.stone1]

/** Offscreen buffers for the door and for Ithren, so each can be grown, shrunk and dissolved whole. */
const SCRATCH: Record<string, Surface> = {}
function scratch(key: string, like: Surface): Surface {
    let b = SCRATCH[key]
    if (!b || b.w !== like.w || b.h !== like.h) b = SCRATCH[key] = new Surface(like.w, like.h, like.ax, like.ay)
    b.data.fill(0)
    return b
}

/**
 * The door to the Void at full width, its sill on `floor` and centred on `dx`: an arch of carved
 * stone blocks lit on the left, a keystone cut as an eye, a pink rune on every other block pulsing
 * up the pillars, a plinth, cracks spreading from its frame; inside, the Void wheeling in a
 * three-armed vortex round a glowing heart. It is drawn only while Ithren comes and goes: the
 * door is a boss of its own further on.
 */
function voidDoor(s: Surface, dx: number, floor: number, t: number, glow: boolean): void {
    const dw = 26
    const archY = floor - 92
    ellipse(s, dx, archY, dw + 8, 20, STONE[0])
    ellipse(s, dx - 1, archY - 1, dw + 7, 19, STONE[1])
    ellipse(s, dx, archY, dw, 14, C.ink)
    rect(s, dx - dw, archY, dw * 2 + 1, floor - archY, C.ink)
    voidFill(s, dx - dw, archY - 14, dw * 2 + 1, floor - archY + 14, t, 7)
    for (let arm = 0; arm < 3; arm++) {
        for (let k = 0; k < 26; k++) {
            const r = k * (dw / 26) * 1.1
            const a = q(t) * 1.4 + arm * (Math.PI * 2 / 3) + k * 0.22
            const vx = dx + Math.cos(a) * r
            const vy = archY + 30 + Math.sin(a) * r * 1.4
            if (Math.abs(vx - dx) > dw || vy < archY - 10) continue
            const c = k < 6 ? C.pink : k & 1 ? C.purple2 : C.purple1
            px(s, vx, vy, c); px(s, vx + 1, vy, c)
        }
    }
    ditherDisc(s, dx, archY + 30, 5, C.pink, 5)
    disc(s, dx, archY + 30, 2, C.white)
    const pulse = fr(t, 4, 4)
    for (const side of [-1, 1]) {
        const px0 = side < 0 ? dx - dw - 7 : dx + dw + 1
        rect(s, px0, archY, 7, floor - archY, STONE[1])
        rect(s, px0, archY, 1, floor - archY, side < 0 ? STONE[2] : STONE[1])
        rect(s, px0 + 6, archY, 1, floor - archY, STONE[0])
        for (let by = archY + 2, i = 0; by < floor - 2; by += 9, i++) {
            line(s, px0, by, px0 + 6, by, STONE[0])
            line(s, px0 + 1, by + 1, px0 + 5, by + 1, STONE[2])
            if ((i + (side < 0 ? 0 : 1)) % 2 === 0) {
                const lit = (i + pulse) % 4 === 0 ? C.pink : C.purple2
                px(s, px0 + 3, by + 3, lit); px(s, px0 + 2, by + 4, lit); px(s, px0 + 4, by + 4, lit); px(s, px0 + 3, by + 5, lit)
            }
        }
    }
    for (let k = 1; k < 8; k++) {
        const a = Math.PI + (k / 8) * Math.PI
        line(s, R(dx + Math.cos(a) * dw), R(archY + Math.sin(a) * 14), R(dx + Math.cos(a) * (dw + 7)), R(archY + Math.sin(a) * 20), STONE[0])
    }
    for (let a = Math.PI * 1.1; a < Math.PI * 1.6; a += 0.04) px(s, R(dx + Math.cos(a) * (dw + 6)), R(archY + Math.sin(a) * 19), STONE[2])
    poly(s, [-4, 0, 4, 0, 5, -8, -5, -8], dx, archY - 13, STONE[2])
    line(s, dx - 5, archY - 21, dx + 5, archY - 21, C.stone3)
    ellipse(s, dx, archY - 17, 3, 1.5, C.ink); px(s, dx, archY - 17, glow ? C.white : C.pink)
    rect(s, dx - dw - 10, floor - 3, dw * 2 + 21, 3, STONE[0])
    line(s, dx - dw - 10, floor - 3, dx + dw + 10, floor - 3, STONE[2])
    line(s, dx + dw + 8, archY + 30, dx + dw + 14, archY + 36, C.purple2); px(s, dx + dw + 11, archY + 33, C.pink)
    line(s, dx - dw - 8, archY + 52, dx - dw - 14, archY + 58, C.purple2); px(s, dx - dw - 11, archY + 55, C.pink)
}

/**
 * The door coming and going as a rift: `rise` 0..1 grows a line of light up from the floor, then
 * `open` 0..1 widens it into the door, the line still burning down its middle as it parts.
 */
function riftDoor(s: Surface, dx: number, floor: number, t: number, rise: number, open: number, glow: boolean): void {
    const H = 112
    if (open > 0.02) {
        const d = scratch('door', s)
        voidDoor(d, dx, floor, t, glow)
        const half = 34 * open
        for (let X = Math.floor(dx - half); X <= Math.ceil(dx + half); X++) {
            const sx = R(dx + (X - dx) / open)
            if (sx < 0 || sx >= d.w) continue
            for (let Y = 0; Y < d.h; Y++) {
                const c = d.data[Y * d.w + sx]!
                if (c) s.set(X, Y, c)
            }
        }
    }
    if (rise > 0 && open < 0.9) {
        // the line of light, glowing, thinning out as the door opens round it
        const top = R(floor - H * rise)
        const bright = 1 - open
        ditherEllipse(s, dx, (floor + top) / 2, 3 + bright * 2, (floor - top) / 2 + 2, C.purple2, R(3 + bright * 5))
        line(s, dx - 1, top + 2, dx - 1, floor, C.pink)
        line(s, dx + 1, top + 2, dx + 1, floor, C.pink)
        line(s, dx, top, dx, floor, C.white)
    }
}

/** Blit `src` into `dst` shrunk by `k` about (fx, fy), landing that point on (tx, ty), dithered to `level` of 16. */
function warp(dst: Surface, src: Surface, fx: number, fy: number, tx: number, ty: number, k: number, level: number): void {
    for (let Y = 0; Y < src.h; Y++) {
        for (let X = 0; X < src.w; X++) {
            const c = src.data[Y * src.w + X]!
            if (!c) continue
            const dx = R(tx + (X - fx) * k)
            const dy = R(ty + (Y - fy) * k)
            if (level < 16 && !bayer(dx, dy, level)) continue
            dst.set(dx, dy, c)
        }
    }
}

/**
 * Ithren himself: tall, gaunt and ashen, floating. An angular face with sharp cheekbones, a hooked
 * nose and a pointed white goatee, brows drawn down over sunken eyes burning pink; long white hair
 * down his back; a tall crown of void-iron spikes set with pink gems under a double ring of turning
 * runes; a spiked collar and spiked pauldrons of void-iron rimmed in gold; a black open coat trimmed
 * in gold over violet robes, a tabard of glowing runes, a gold belt with an eye medallion and gem
 * chains; the hem spiked in gold and coming apart into the dark. The far hand is raised back, the
 * Void crackling off its claws; the near hand draws the Void into an orb and throws it.
 */
function ithrenBody(s: Surface, x: number, y: number, t: number): void {
    const hover = -4 + wv(t, 2.0, 2)
    const hip = y - 30 + hover
    const top = hip - 32
    const sway = wv(t, 1.4, 2)
    const rune = fr(t, 5, 6)
    const hx = x + 1
    const hy = top - 3
    // the double ring of runes turning behind his head, the inner one against the outer
    for (let i = 0; i < 16; i++) {
        const a = q(t) * 0.8 + i * Math.PI / 8
        px(s, R(hx + Math.cos(a) * 17), R(hy - 13 + Math.sin(a) * 17), i % 4 === 0 ? C.pink : C.purple2)
        if (i % 4 === 0) px(s, R(hx + Math.cos(a) * 19), R(hy - 13 + Math.sin(a) * 19), C.purple1)
    }
    for (let i = 0; i < 10; i++) {
        const a = -q(t) * 1.2 + i * Math.PI / 5
        px(s, R(hx + Math.cos(a) * 13), R(hy - 13 + Math.sin(a) * 13), (i + rune) % 5 === 0 ? C.white : C.purple1)
    }
    // long white hair falling down his back, the ends stirring
    const hs = wv(t, 1.6, 2)
    poly(s, [0, -21, -8, -20, -11, -10, -12, 4, -15, 16 + hs, -11, 18, -8, 14 + hs, -5, 4, -2, -4], hx, hy, SILVER[1])
    poly(s, [-6, -15, -9, -8, -10, 6, -12, 16 + hs, -9, 16, -7, 6, -4, -2], hx, hy, SILVER[0])
    for (let i = 0; i < 3; i++) line(s, hx - 3 - i * 2, hy - 19 + i, hx - 7 - i * 2, hy + 12 + (i & 1) * 3 + hs, C.white)
    // the spiked collar of the Void fanning behind his head, rimmed in gold
    poly(s, [-13, 4, -4, 2, -8, -14, -12, -24, -15, -12, -21, -18, -17, -2], x, top, C.void)
    poly(s, [13, 4, 5, 2, 10, -12, 15, -20, 16, -8, 21, -12, 17, 2], x, top, C.void)
    line(s, x - 12, top - 24, x - 8, top - 14, C.gold1); line(s, x - 21, top - 18, x - 15, top - 12, C.gold1)
    line(s, x + 15, top - 20, x + 10, top - 12, C.gold1); line(s, x + 21, top - 12, x + 16, top - 8, C.gold1)
    for (const [ox, oy] of [[-11, -8], [-14, -4], [-9, -2], [12, -6], [15, -2]] as const) px(s, x + ox, top + oy, (ox + oy) & 1 ? C.white : C.pink)
    // the far pauldron, behind
    poly(s, [-15, 6, -6, 0, -8, -4, -12, -10, -14, -3, -19, -6, -17, 2], x, top, VOID_IRON[1])
    line(s, x - 15, top + 6, x - 6, top, C.gold1)
    // the far hand raised back, the Void crackling off its claws
    const bhx = x - 20
    const bhy = top - 6 + R(sway / 2) - R(B.glow * 3)
    robedArm(s, x - 9, top + 3, bhx, bhy, 1, [C.void, C.purple0, C.purple1], t)
    const fhx = P.x
    const fhy = P.y
    disc(s, fhx, fhy, 2, ASH[1])
    for (let i = 0; i < 3; i++) { line(s, R(fhx), R(fhy), R(fhx - 2 + i * 2), R(fhy - 4), ASH[1]); px(s, R(fhx - 2 + i * 2), R(fhy - 5), C.ink) } // the claws
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.5 + Math.sin(t * 9 + i) * 0.3
        const r = 4 + ((fr(t, 10, 4) + i) % 4)
        px(s, R(fhx + Math.cos(a) * r), R(fhy - 3 + Math.sin(a) * r), i & 1 ? C.pink : C.purple2)
    }
    // the black coat, open over violet robes, trimmed in gold, flaring to a spiked hem
    poly(s, [-13, 0, 13, 0, 16, 26, 22, 48, -24, 48, -17, 26], x, top, C.void)
    poly(s, [-13, 0, -6, 0, -8, 26, -9, 48, -24, 48, -17, 26], x, top, C.ink)
    line(s, x + 11, top + 2, x + 19, top + 44, C.purple0) // the lit fold
    poly(s, [-4, 2, 7, 2, 11, 48, -7, 48], x, top, VIOLET[1]) // the robes where the coat falls open
    poly(s, [-4, 2, 0, 2, -2, 48, -7, 48], x, top, VIOLET[0])
    line(s, x - 4, top + 2, x - 7, top + 47, C.gold1); line(s, x + 7, top + 2, x + 11, top + 47, C.gold1)
    line(s, x - 5, top + 2, x - 8, top + 47, C.gold0); line(s, x + 8, top + 2, x + 12, top + 47, C.gold0)
    // the tabard of runes down the front, glowing in turn
    poly(s, [-1, 20, 6, 20, 7, 42, 2, 46, -2, 42], x, top, C.night1)
    line(s, x - 1, top + 20, x - 2, top + 42, C.gold2); line(s, x + 6, top + 20, x + 7, top + 42, C.gold2)
    for (let i = 0; i < 4; i++) {
        const gx = x + 2 + (i & 1)
        const gy = top + 24 + i * 5
        const c = (i + rune) % 3 === 0 ? C.white : i & 1 ? C.pink : C.purple2
        px(s, gx, gy, c); px(s, gx - 1, gy + 1, c); px(s, gx + 1, gy + 1, c)
    }
    // the hem: a band of gold spikes, then the robe coming apart into the dark with stars in it
    rect(s, x - 23, top + 46, 45, 2, C.gold1)
    for (let i = 0; i < 11; i++) tri(s, x - 22 + i * 4, top + 46, x - 20 + i * 4, top + 46, x - 21 + i * 4, top + 43, C.gold2)
    for (let i = 0; i < 11; i++) {
        const wx = x - 22 + i * 4 + R(Math.sin(t * 3 + i) * 1.5)
        tri(s, wx - 2, top + 48, wx + 2, top + 48, wx + R(sway), top + 54 + (i & 1) * 3, i & 1 ? C.void : C.purple0)
        if (i % 3 === 1) px(s, wx, top + 50, C.white)
    }
    line(s, x - 12, top + 30, x - 9, top + 42, C.purple2); px(s, x - 10, top + 36, C.white) // a crack of the Void in the coat
    // the belt, the eye medallion, and chains of gems swinging off it
    rect(s, x - 14, top + 18, 29, 3, C.gold0)
    line(s, x - 14, top + 18, x + 14, top + 18, C.gold2)
    disc(s, x + 3, top + 19, 3.5, C.gold1)
    ellipse(s, x + 3, top + 19, 2.5, 1.5, C.ink)
    px(s, x + 3, top + 19, B.glow > 0.3 ? C.white : C.pink)
    for (let c = 0; c < 2; c++) {
        const cx0 = x - 10 + c * 4
        for (let i = 0; i < 5; i++) px(s, R(cx0 + i * 1.5 + Math.sin(t * 2 + c) * 0.5), top + 21 + R(Math.sin(i / 4 * Math.PI) * 3), C.gold2)
        disc(s, cx0 + 3, top + 25, 1, c ? C.purple2 : C.pink)
    }
    // the gorget at his throat
    poly(s, [-5, 0, 6, 0, 4, 4, -3, 4], x, top - 1, C.gold1)
    line(s, x - 4, top - 1, x + 5, top - 1, C.gold3)
    px(s, x + 1, top + 1, C.pink)
    // the head: long and angular, ashen, lit on its front, a hooked nose, sharp cheekbones
    poly(s, [-6, -20, 1, -23, 6, -21, 8, -15, 12, -10, 8, -9, 8, -5, 5, -1, 3, 2, -1, 0, -5, -4, -7, -11], hx, hy, ASH[1])
    poly(s, [-6, -20, -3, -21, -4, -11, -1, -2, -1, 0, -5, -4, -7, -11], hx, hy, ASH[0])
    line(s, hx + 1, hy - 21, hx + 6, hy - 19, ASH[2]) // the lit brow of the skull
    px(s, hx + 6, hy - 10, ASH[2]); px(s, hx + 7, hy - 11, ASH[2]) // the cheekbone
    line(s, hx + 3, hy - 9, hx + 4, hy - 3, ASH[0]) // the hollow under it
    line(s, hx + 8, hy - 14, hx + 12, hy - 10, ASH[2]); px(s, hx + 10, hy - 9, ASH[0]) // the hooked nose
    // sunken eyes burning under brows drawn down toward the nose
    const eye = B.hurt ? C.ink : B.glow > 0.5 ? C.white : C.pink
    if (!B.hurt && B.glow > 0.3) ditherDisc(s, hx + 5, hy - 15, 3, C.pink, 2 + R(B.glow * 5))
    rect(s, hx + 3, hy - 15, 5, 2, C.ink)
    rect(s, hx + 4, hy - 15, 3, 1, eye); if (!B.hurt) px(s, hx + 5, hy - 15, C.white)
    line(s, hx + 2, hy - 18, hx + 8, hy - 16, C.white); line(s, hx + 2, hy - 17, hx + 7, hy - 16, C.bone0)
    // the sneer, or teeth bared
    if (B.roar || B.strike) { rect(s, hx + 5, hy - 6, 4, 2, C.ink); px(s, hx + 5, hy - 6, C.white); px(s, hx + 7, hy - 6, C.white) } else line(s, hx + 5, hy - 5, hx + 8, hy - 6, ASH[0])
    poly(s, [0, -2, 7, -2, 5, 4, 2, 10, 1, 3], hx, hy, C.bone1) // the goatee
    line(s, hx + 3, hy - 1, hx + 2, hy + 8, C.white)
    // the crown of void-iron: a band and five spikes cut apart, lit on one edge, gold-tipped,
    // pink gems at their feet
    poly(s, [-7, -19, 9, -22, 9, -25, -7, -22], hx, hy, VOID_IRON[1])
    line(s, hx - 7, hy - 22, hx + 9, hy - 25, C.gold1)
    line(s, hx - 7, hy - 19, hx + 9, hy - 22, C.gold0)
    for (let i = 0; i < 5; i++) {
        const cx = hx - 5 + i * 3.5
        const h = i === 2 ? 14 : i & 1 ? 11 : 7
        const by = hy - 22 - R(i * 0.7)
        const tx = cx - (4 - i) * 0.4
        tri(s, cx - 1.2, by, cx + 1.2, by, tx, by - h, VOID_IRON[2])
        line(s, R(cx - 1), by, R(tx), by - h + 1, C.stone2)
        px(s, R(tx), by - h, C.gold3)
        px(s, R(cx), by + 1, i === 2 ? C.white : C.pink)
    }
    // the near arm: the Void drawn into an orb on the wind-up, thrown on the strike
    const gx = x + 22 + R(bz(0, -7, 6))
    const gy = top + 12 + R(bz(0, -10, -5))
    robedArm(s, x + 10, top + 3, gx, gy, 1, [C.void, C.ink, C.purple0], t)
    const hax = P.x
    const hay = P.y
    disc(s, hax, hay, 2, ASH[1])
    for (let i = 0; i < 3; i++) { line(s, R(hax), R(hay), R(hax + 3), R(hay - 2 + i * 2), ASH[1]); px(s, R(hax + 4), R(hay - 2 + i * 2), C.ink) } // the claws
    // the near pauldron over the shoulder: spikes swept back, a gem in its heart
    poly(s, [5, 6, 16, 6, 18, 0, 15, -5, 12, -12, 10, -4, 6, -8, 4, -1], x, top, VOID_IRON[1])
    poly(s, [5, 6, 16, 6, 17, 2, 6, 2], x, top, VOID_IRON[0])
    line(s, x + 4, top - 1, x + 18, top, C.gold1)
    line(s, x + 5, top + 6, x + 16, top + 6, C.gold1)
    px(s, x + 12, top - 12, C.gold3); px(s, x + 6, top - 8, C.gold3)
    disc(s, x + 11, top + 3, 1.5, C.pink); px(s, x + 11, top + 2, C.white)
    const orb = B.wind > 0 ? B.wind : B.strike ? 1 : B.glow
    if (orb > 0.1) {
        const ox = hax + 5
        const oy = hay - 2
        ditherDisc(s, ox, oy, 3 + orb * 4, C.purple2, 6)
        disc(s, ox, oy, 1 + orb * 2.5, C.void)
        px(s, ox, oy, C.white); px(s, ox + 1, oy - 1, C.pink)
        arc(s, ox, oy, 2 + orb * 2.5, q(t) * 8, q(t) * 8 + 3, C.pink)
    }
}

const ITHREN_STATES = { ...bossStates(1.5, 2.0, 2.6), death: { dur: 2.4, loop: false } }

/**
 * Archmage Ithren, the Door-Opener, who opened the door to the Void. The door comes with him only
 * as he arrives and as he dies: on his entry a line of light rises out of nothing and widens into
 * the door, he comes out of its heart, and it closes behind him; on his death it opens again and
 * pulls him back in, then snaps shut. Otherwise he fights alone, since the door is a boss of its
 * own further on.
 */
export const ARCHMAGE_ITHREN: CreatureDef = {
    name: 'Archmage Ithren, the Door-Opener', size: 128, shadow: 18, hover: 1, accent: C.purple2,
    states: ITHREN_STATES,
    draw(s, st, t) {
        drive(this, st, t, 4, 2.0)
        const x = s.ax - 4 + B.lunge - B.kb
        const y = s.ay
        const dx = x - 26
        const heartY = y - 54
        const body = () => { const b = scratch('ithren', s); ithrenBody(b, x, y, t); return b }
        if (st === 'entry') {
            // the rift rises and opens, he comes out of its heart, and it closes behind him
            const u = q(t) / ITHREN_STATES.entry.dur
            const rise = Math.min(1, u / 0.12)
            const open = u < 0.62 ? sm(span(u, 0.12, 0.3)) : 1 - sm(span(u, 0.62, 0.75))
            const lineOut = u < 0.75 ? 1 : 1 - span(u, 0.75, 0.8)
            if (lineOut > 0) riftDoor(s, dx, y, t, rise * lineOut, open, true)
            const e = sm(span(u, 0.3, 0.62))
            if (e > 0) warp(s, body(), x, heartY, dx + (x - dx) * e, heartY, 0.2 + 0.8 * e, R(4 + 12 * e))
            B.ent = 1
        } else if (st === 'death') {
            // the rift opens again behind him and pulls him in, then snaps shut
            CF.fade = 0
            const u = q(t) / ITHREN_STATES.death.dur
            const rise = Math.min(1, span(u, 0.04, 0.14))
            const open = u < 0.72 ? sm(span(u, 0.14, 0.3)) : 1 - sm(span(u, 0.72, 0.84))
            const lineOut = u < 0.84 ? 1 : 1 - span(u, 0.84, 0.92)
            if (lineOut > 0 && rise > 0) riftDoor(s, dx, y, t, rise * lineOut, open, false)
            const p = sm(span(u, 0.3, 0.7))
            if (p < 1) warp(s, body(), x, heartY, x + (dx - x) * p, heartY + R(Math.sin(p * Math.PI) * -4), 1 - 0.85 * p, R(16 - 13 * p))
            if (p > 0 && p < 1) {
                // streaks of him torn loose and drawn into the heart
                for (let i = 0; i < 10; i++) {
                    const k = (i / 10 + q(t) * 2) % 1
                    const sx = x + 4 - (x + 4 - dx) * k + ((i * 7) % 11) - 5
                    const sy = heartY - 30 + ((i * 13) % 60) * (1 - k)
                    px(s, sx, sy, i & 1 ? C.pink : C.purple2)
                }
            }
        } else {
            ithrenBody(s, x, y, t)
        }
        finish(s, Entry.Fade, 0)
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'death') return
        const k = fr(t, 10, 12)
        for (let i = 0; i < 4; i++) dst.set(x - dir * (20 + ((i * 7 + k) % 30) - 15), y - 100 + ((i * 29 + k * 7) % 90), i & 1 ? C.pink : C.purple2)
        if ((st === 'attack' && (B.strike || B.rec > 0.5)) || B.roar) {
            // the orb thrown as a beam of the Void, violet-edged, a pink core
            for (let i = 0; i < 44; i++) {
                const yy = y - 57 + R(Math.sin(i * 0.5 + k) * 2)
                dst.set(x + dir * (30 + i), yy - 1, C.purple2)
                dst.set(x + dir * (30 + i), yy, i % 3 ? C.void : C.white)
                dst.set(x + dir * (30 + i), yy + 1, C.pink)
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 7 · The Bonefields

/** Grave Marshal Korr — the forgotten war's general, still carrying its banner. */
export const GRAVE_MARSHAL_KORR: CreatureDef = {
    name: 'Grave Marshal Korr', size: 96, shadow: 16, accent: C.green4,
    states: bossStates(1.2, 1.6, 2.0),
    draw(s, st, t) {
        drive(this, st, t, 8, 1.6)
        const x = s.ax - 4 + B.lunge - B.kb
        const y = s.ay
        const crouch = R(B.strike ? 4 : B.rec * 3 + B.die * 14)
        const hip = y - 24 + crouch + B.bob
        const top = hip - 22
        // banner on his back: a pole and a torn red flag
        line(s, x - 8, top - 26, x - 6, hip + 4, C.brown1, 2)
        const flap = fr(t, 5, 3)
        poly(s, [0, 0, -16, 2 + flap, -14, 8, -18, 14 - flap, 0, 12], x - 8, top - 24, C.red1)
        line(s, x - 8, top - 24, x - 22, top - 22 + flap, C.red2)
        px(s, x - 12, top - 18, C.bone1); px(s, x - 13, top - 19, C.bone1) // sigil
        // cape
        quad(s, x - 8, top + 2, x, top + 2, x - 6, y - 4, x - 20, y - 2 + flap, C.red1)
        line(s, x - 8, top + 2, x - 20, y - 2 + flap, C.red0)
        // legs: bone in black greaves
        limbT(s, x - 3, hip, x - 6, y - 3, 6, 5, RUST_ARMOR)
        limbT(s, x + 5, hip, x + 7, y - 3, 6, 5, [C.stone1, C.stone2, C.gold1])
        // armour over a ribcage
        rect(s, x - 10, top + 2, 20, 20, C.stone1)
        rect(s, x - 10, top + 2, 20, 2, C.gold1)
        for (let i = 0; i < 3; i++) { rect(s, x - 7, top + 8 + i * 4, 14, 1, C.bone1); px(s, x - 8, top + 8 + i * 4, C.bone0) }
        rect(s, x - 1, top + 6, 2, 16, C.bone1)
        disc(s, x + 1, top + 12, 2, C.green3) // soul-fire in the ribs
        px(s, x + 1, top + 12, C.green4)
        ball(s, x + 8, top + 3, 5, 3, [C.stone0, C.stone1, C.gold1]) // pauldron
        rect(s, x - 10, hip - 3, 20, 3, C.brown0)
        // back arm
        limbT(s, x - 8, top + 4, x - 12, top + 18, 4, 3, BONE)
        // skull in a crested helm
        const hx = x + 3
        const hy = top + 2 + R(B.die * 4)
        rect(s, hx - 5, hy - 11, 10, 11, C.bone1)
        rect(s, hx - 4, hy - 1, 8, 2, C.bone0)
        for (let i = 0; i < 4; i++) px(s, hx - 3 + i * 2, hy - 1, C.ink)
        rect(s, hx + 1, hy - 7, 3, 3, C.ink)
        glowEye(s, hx + 2, hy - 6, B.hurt ? C.white : C.green4, C.green2)
        px(s, hx + 4, hy - 3, C.ink)
        rect(s, hx - 6, hy - 14, 12, 5, C.stone1)
        rect(s, hx - 6, hy - 14, 12, 1, C.gold1)
        rect(s, hx - 6, hy - 10, 2, 7, C.stone0)
        for (let i = 0; i < 7; i++) line(s, hx - 5 + i * 2, hy - 15, hx - 7 + i * 2, hy - 20 - (i === 3 ? 2 : 0), i & 1 ? C.red2 : C.red1, 2) // crest
        // greatsword
        const sx = x + 8
        const sy = top + 6
        const a = bz(-1.2, -2.6, 0.6)
        reach(sx, sy, a, 12)
        const gx = P.x
        const gy = P.y
        limbT(s, sx, sy, gx, gy, 4, 3, BONE)
        reach(gx, gy, a, 30)
        line(s, gx, gy, P.x, P.y, C.steel1, 3)
        line(s, gx + Math.sin(a), gy - Math.cos(a), P.x + Math.sin(a), P.y - Math.cos(a), C.steel2)
        px(s, P.x, P.y, C.white)
        line(s, gx - Math.sin(a) * 4, gy + Math.cos(a) * 4, gx + Math.sin(a) * 4, gy - Math.cos(a) * 4, C.gold1, 2)
        finish(s, Entry.Rise, 12)
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'attack' && B.strike) for (let i = 0; i < 8; i++) dst.set(x + dir * (22 + i * 2), y - (i % 3), i & 1 ? C.bone1 : C.stone3)
        if (st === 'entry' && B.ent < 1) for (let i = 0; i < 10; i++) dst.set(x + dir * (-14 + i * 3), y - 1 - (i & 1), i & 1 ? C.brown2 : C.bone0)
        const k = fr(t, 10, 8)
        dst.set(x + dir * 4, y - 60 - k * 2, C.green3)
    }
}

/** Ossuar, the Thousand-Bone Host — the dead of the whole war, fused into one walking mound. */
export const OSSUAR: CreatureDef = {
    name: 'Ossuar, the Thousand-Bone Host', size: 128, shadow: 36, accent: C.green4,
    states: bossStates(1.5, 2.0, 2.6),
    draw(s, st, t) {
        drive(this, st, t, 6, 2.0)
        const x = s.ax - 2 + B.lunge - B.kb
        const y = s.ay
        const top = y - 84 + B.breath + R(B.die * 24)
        // far arms
        limbT(s, x - 18, top + 30, x - 34, top + 56, 7, 5, BONE)
        limbT(s, x - 34, top + 56, x - 30, y - 6, 5, 4, BONE)
        // the mound: layered skulls and bones
        ball(s, x, top + 50, 34, 30, [C.bone0, C.bone0, C.bone1], false)
        dither(s, x - 34, top + 56, 68, 26, C.stone2, 5)
        for (let i = 0; i < 26; i++) {
            const bx = x - 28 + R(hash2(5, i) * 56)
            const by = top + 26 + R(hash2(6, i) * 50)
            if (s.get(bx, by) === 0) continue
            if (i % 3 === 0) { line(s, bx - 4, by, bx + 4, by + (i & 1 ? 2 : -2), C.bone1, 2); px(s, bx - 5, by, C.white); px(s, bx + 5, by + (i & 1 ? 2 : -2), C.white) } else {
                rect(s, bx - 2, by - 2, 5, 4, C.bone1); px(s, bx - 1, by - 1, C.ink); px(s, bx + 1, by - 1, C.ink); px(s, bx, by + 1, C.bone0)
            }
        }
        // ribcage chest with green soul-fire
        const cx = x + 4
        const cy = top + 34
        ellipse(s, cx, cy, 12, 10, C.ink)
        for (let i = 0; i < 4; i++) arc(s, cx, cy - 2 + i * 4, 11, -0.3, Math.PI + 0.3, C.bone1)
        rect(s, cx - 1, cy - 9, 3, 18, C.bone1)
        const pulse = fr(t, 5, 2)
        disc(s, cx + 2, cy + 1, 4 + pulse, C.green2)
        disc(s, cx + 2, cy + 1, 2 + pulse, C.green4)
        // the great skull on top, with horns
        const hx = x + 8
        const hy = top + 10 + R(bz(0, -4, 6))
        ellipse(s, hx, hy, 11, 10, C.bone1)
        ellipse(s, hx - 3, hy - 3, 6, 5, C.white)
        rect(s, hx - 6, hy + 7, 14, 5, C.bone0)
        const open = B.strike || B.roar ? 3 : 0
        rect(s, hx - 4, hy + 8 + open, 12, 3, C.bone1)
        if (open) rect(s, hx - 4, hy + 8, 12, open, C.ink)
        for (let i = 0; i < 6; i++) px(s, hx - 4 + i * 2, hy + 8 + open, C.ink)
        ellipse(s, hx + 1, hy, 3, 3, C.ink)
        ellipse(s, hx + 8, hy, 2, 3, C.ink)
        glowEye(s, hx + 1, hy, B.hurt ? C.white : C.green4, C.green2, true)
        glowEye(s, hx + 8, hy, B.hurt ? C.white : C.green4, C.green2)
        tri(s, hx + 5, hy + 4, hx + 7, hy + 4, hx + 6, hy + 6, C.ink)
        for (const d of [-1, 1]) { line(s, hx + d * 9, hy - 6, hx + d * 16, hy - 14, C.bone0, 3); line(s, hx + d * 16, hy - 14, hx + d * 14, hy - 22, C.bone1, 2) }
        // near arms: a big one that slams
        const sx = x + 22
        const sy = top + 30
        const a = bz(1.0, -1.3, 1.3)
        reach(sx, sy, a, 36)
        limbT(s, sx, sy, P.x, P.y, 9, 6, BONE)
        for (let i = 0; i < 4; i++) line(s, P.x, P.y, P.x + 4 + i * 2, P.y + 4 + (i & 1) * 2, C.bone1, 2) // claw-fingers
        limbT(s, x + 10, top + 58, x + 22, y - 4, 6, 5, BONE)
        finish(s, Entry.Rise, 14)
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'attack' && B.strike) for (let i = 0; i < 12; i++) dst.set(x + dir * (40 + i * 2), y - (i % 4), i & 1 ? C.bone1 : C.stone3)
        const k = fr(t, 10, 10)
        for (let i = 0; i < 3; i++) dst.set(x + dir * (-10 + i * 12), y - 56 - ((k * 3 + i * 7) % 24), C.green3)
    }
}

// ═══════════════════════════════════════════════════════════════ 8 · The Shattered Sky

/** Stormcrown Roc — a thunderbird wearing a crown of its own lightning. */
export const STORMCROWN_ROC: CreatureDef = {
    name: 'Stormcrown Roc', size: 96, shadow: 18, hover: 1, accent: C.gold3,
    states: bossStates(1.1, 1.0, 1.8),
    draw(s, st, t) {
        drive(this, st, t, 14, 1.0)
        const x = s.ax - 4 + B.lunge - B.kb
        const dive = R(bz(0, -8, 14))
        const y = s.ay - 34 + wv(t, 1.0, 3) + dive + R(B.die * 30)
        const flap = st === 'death' ? -0.5 : Math.sin(q(t) * Math.PI * 2 / (st === 'attack' ? 0.5 : 1.0)) * (B.strike ? 0.3 : 1)
        // far wing
        wing(s, x - 4, y - 6, 34, flap, [C.stone0, C.stone1, C.stone2], true)
        // tail
        for (let i = 0; i < 4; i++) line(s, x - 12, y + 2, x - 24 - i, y + 8 + i * 3, i & 1 ? C.stone1 : C.steel2, 2)
        // body
        ball(s, x, y, 14, 10, FEATHER)
        dither(s, x - 12, y + 3, 24, 6, C.bone0, 6) // pale breast
        // talons, reaching forward on the strike
        const ta = B.strike ? 0.2 : 1.3
        for (const [lx, c] of [[-2, C.gold1], [5, C.gold2]] as const) {
            reach(x + lx, y + 8, ta, 12)
            line(s, x + lx, y + 8, P.x, P.y, c, 2)
            for (let i = -1; i <= 1; i++) line(s, P.x, P.y, P.x + 3 + i, P.y + 2 + i * 2, C.ink)
        }
        // head, beak and the lightning crown
        const hx = x + 14
        const hy = y - 8
        ball(s, hx, hy, 7, 6, FEATHER)
        tri(s, hx + 5, hy - 2, hx + 5, hy + 3, hx + 14, hy + 3, C.gold2)
        tri(s, hx + 5, hy + 1, hx + 12, hy + 3, hx + 11, hy + 5, C.gold1)
        if (B.roar || B.strike) tri(s, hx + 6, hy + 2, hx + 12, hy + 4, hx + 6, hy + 5, C.ink)
        const eye = B.hurt ? C.ink : C.gold3
        px(s, hx + 3, hy - 2, eye); px(s, hx + 2, hy - 3, C.ink)
        const k = fr(t, 10, 2)
        for (let i = 0; i < 4; i++) {
            const bx = hx - 5 + i * 3
            line(s, bx, hy - 6, bx + (k ? 1 : -1), hy - 10 - (i & 1) * 2, C.gold3)
            line(s, bx + (k ? 1 : -1), hy - 10 - (i & 1) * 2, bx, hy - 13 - (i & 1) * 3, C.white)
        }
        // near wing
        wing(s, x + 2, y - 4, 30, flap, FEATHER, true)
        finish(s, Entry.Drop, 0)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 6)
        if (k === 0 || B.roar) {
            // a crackle jumping from the crown
            let lx = x + dir * 8
            for (let yy = y - 64; yy > y - 90; yy--) { if ((yy & 3) === 0) lx += dir * (((yy * 7) & 2) - 1); dst.set(lx, yy, (yy & 1) ? C.gold3 : C.white) }
        }
        if (st === 'attack' && B.strike) for (let i = 0; i < 10; i++) dst.set(x + dir * (30 + i * 2), y - 36 + (i & 1), C.white)
    }
}

/** Zephyrax, Breaker of Heavens — a storm-dragon coiling through the broken islands. */
export const ZEPHYRAX: CreatureDef = {
    name: 'Zephyrax, Breaker of Heavens', size: 128, shadow: 20, hover: 1, accent: C.cyan,
    states: bossStates(1.4, 2.0, 2.2),
    draw(s, st, t) {
        drive(this, st, t, 12, 2.0)
        const x = s.ax - 6 - B.kb
        const y = s.ay
        const ph = q(t) * Math.PI
        const hx = x + 18 + R(bz(0, -10, 14)) + wv(t, 2.0, 2)
        const hy = y - 80 + R(bz(0, -8, 8)) + R(B.die * 50) + wv(t, 2.0, 2, 0.3)
        // floating island fragments
        for (const [ix, iy, w] of [[-44, -30, 10], [30, -98, 7], [-30, -104, 6]] as const) {
            const bob = wv(t, 2.0, 1, ix * 0.01)
            tri(s, x + ix - w, y + iy + bob, x + ix + w, y + iy + bob, x + ix, y + iy + w + 4 + bob, C.stone1)
            rect(s, x + ix - w, y + iy - 2 + bob, w * 2, 2, C.green2)
            px(s, x + ix - w + 2, y + iy - 3 + bob, C.green3)
        }
        // the long body looping behind and up
        chain(s, x - 40, y - 20, x - 10 + Math.sin(ph) * 6, y + 6, x + 10, y - 30, 5, 9, STORM, 16, C.frost)
        chain(s, x + 10, y - 30, x + 34, y - 60, hx - 6, hy + 6, 9, 7, STORM, 16, C.frost)
        // tail end with a wind-fin
        tri(s, x - 40, y - 20, x - 50, y - 28, x - 48, y - 12, C.haze)
        // small wings
        wing(s, x + 22, y - 46, 22, Math.sin(ph * 2), [C.night1, C.night2, C.cyan], false)
        // head
        const open = B.strike || B.roar ? 5 : 1
        poly(s, [-8, -5, 8, -7, 20, -2, 20, 1, -6, 2], hx, hy, STORM[1])
        poly(s, [-6, 2 + open, 18, 2 + open, 16, 5 + open, -4, 6], hx, hy, STORM[0])
        if (open > 1) quad(s, hx - 4, hy + 2, hx + 18, hy + 1, hx + 16, hy + 2 + open, hx - 4, hy + 2 + open, C.blue0)
        line(s, hx - 6, hy - 4, hx + 18, hy - 2, C.haze)
        const eye = B.hurt ? C.ink : C.white
        rect(s, hx + 5, hy - 5, 4, 2, C.cyan); px(s, hx + 7, hy - 5, eye)
        // lightning horns
        const k = fr(t, 10, 2)
        for (const d of [0, 5]) {
            line(s, hx - 4 + d, hy - 6, hx - 10 + d, hy - 12, C.cyan, 2)
            line(s, hx - 10 + d, hy - 12, hx - 7 + d + k, hy - 18, C.frost, 2)
            line(s, hx - 7 + d + k, hy - 18, hx - 14 + d, hy - 23, C.white)
        }
        finish(s, Entry.Drop, 0)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 8)
        for (let i = 0; i < 6; i++) { const yy = y - 110 + ((i * 19 + k * 9) % 100); dst.set(x + dir * (-50 + ((i * 23) % 90)), yy, C.haze); dst.set(x + dir * (-49 + ((i * 23) % 90)), yy + 1, C.night3) }
        if ((st === 'attack' && (B.strike || B.rec > 0.5)) || B.roar) {
            let ly = y - 78
            for (let i = 0; i < 50; i++) { if ((i & 3) === 0) ly += ((i * 13 + k) & 2) - 1; dst.set(x + dir * (40 + i), ly, i & 1 ? C.cyan : C.white); dst.set(x + dir * (40 + i), ly + 1, C.frost) }
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 9 · The Brink

/** Sister Vesper, the Forgotten — a veiled nun no one remembers, fraying at the hem. */
export const SISTER_VESPER: CreatureDef = {
    name: 'Sister Vesper, the Forgotten', size: 96, shadow: 10, hover: 1, accent: C.haze,
    states: bossStates(1.2, 2.0, 2.0),
    draw(s, st, t) {
        drive(this, st, t, 6, 2.0)
        const x = s.ax - 2 + B.lunge - B.kb
        const y = s.ay
        const hover = -10 + wv(t, 2.0, 2) + R(B.die * 12)
        const top = y - 56 + hover
        // habit: long, grey, fraying into threads at the hem
        quad(s, x - 9, top + 12, x + 7, top + 12, x + 12, top + 44, x - 15, top + 44, FADED[1])
        quad(s, x - 9, top + 12, x - 3, top + 12, x - 8, top + 44, x - 15, top + 44, FADED[0])
        for (let i = 0; i < 14; i++) {
            const tx = x - 15 + i * 2
            const len = 4 + ((i * 7) % 9) + fr(t, 3, 2)
            line(s, tx, top + 44, tx - 1 + ((i & 1) * 2), top + 44 + len, i % 3 ? C.stone3 : C.bone0)
        }
        rect(s, x - 9, top + 22, 16, 2, C.stone2)
        // prayer beads
        for (let i = 0; i < 7; i++) px(s, x - 5 + i, top + 25 + (i % 3 === 1 ? 1 : 0), C.bone1)
        px(s, x - 2, top + 28, C.bone1); px(s, x - 2, top + 29, C.bone1)
        // veil and wimple
        ellipse(s, x, top + 6, 9, 10, C.bone0)
        rect(s, x - 9, top + 6, 3, 18, C.bone0)
        ellipse(s, x + 2, top + 6, 5, 6, C.stone3) // veiled face
        dither(s, x - 2, top + 1, 9, 10, C.bone1, 6)
        const eye = B.hurt ? C.white : C.frost
        px(s, x + 3, top + 5, eye); px(s, x + 5, top + 5, C.haze)
        if (B.roar || B.strike) { rect(s, x + 3, top + 8, 3, 3, C.ink) }
        // back hand at prayer
        limbT(s, x - 6, top + 14, x - 1, top + 22, 3, 3, FADED)
        // lantern held out
        const sx = x + 6
        const sy = top + 14
        const lx = sx + R(bz(6, 2, 16))
        const ly = sy + R(bz(8, 2, 2))
        limbT(s, sx, sy, lx, ly - 2, 3, 3, FADED)
        line(s, lx, ly - 2, lx, ly + 2, C.stone1)
        rect(s, lx - 3, ly + 2, 7, 7, C.stone1)
        rect(s, lx - 2, ly + 3, 5, 5, fr(t, 5, 2) || B.glow > 0.5 ? C.frost : C.cyan)
        px(s, lx, ly + 5, C.white)
        rect(s, lx - 3, ly + 9, 7, 1, C.stone0)
        finish(s, Entry.Fade)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 16)
        for (let i = 0; i < 4; i++) dst.set(x + dir * (-8 + ((i * 7 + k) % 18)), y - 10 - ((k * 3 + i * 11) % 40), i & 1 ? C.haze : C.pink) // threads coming loose
        if ((st === 'attack' && B.strike) || B.roar) for (let r = 4; r < 20; r += 5) for (let a = -0.8; a <= 0.8; a += 0.2) dst.set(x + dir * R(12 + Math.cos(a) * r), y - 48 + R(Math.sin(a) * r), r % 2 ? C.frost : C.haze)
    }
}

/** Liminus, the Last Door — not a guardian of a door; the door itself, with an eye. */
export const LIMINUS: CreatureDef = {
    name: 'Liminus, the Last Door', size: 128, shadow: 30, accent: C.pink,
    states: bossStates(1.5, 2.0, 2.4),
    draw(s, st, t) {
        drive(this, st, t, 4, 2.0)
        const x = s.ax + B.lunge - B.kb
        const y = s.ay
        const top = y - 104 + B.breath + R(B.die * 20)
        const lean = R(B.die * 6)
        // the arch: two pillars and a pointed lintel
        const w = 22
        rect(s, x - w - 8 + lean, top + 24, 10, y - top - 24, STONE[1])
        rect(s, x + w - 2 + lean, top + 24, 10, y - top - 24, STONE[1])
        rect(s, x - w - 8 + lean, top + 24, 2, y - top - 24, STONE[2])
        rect(s, x + w + 6 + lean, top + 24, 2, y - top - 24, STONE[0])
        tri(s, x - w - 8 + lean, top + 26, x + w + 8 + lean, top + 26, x + lean, top - 6, STONE[1])
        tri(s, x - w + 2 + lean, top + 26, x + w - 2 + lean, top + 26, x + lean, top + 6, C.ink)
        rect(s, x - w + 2 + lean, top + 24, 2 * w - 3, y - top - 24, C.ink)
        // the inside of the door — colour gone, stars, a thread-pale horizon
        voidFill(s, x - w + 2 + lean, top + 6, 2 * w - 3, y - top - 6, t, 11)
        const glow = B.glow > 0.3 ? 8 : 3
        dither(s, x - w + 2 + lean, y - 20, 2 * w - 3, 20, C.haze, glow)
        // keystone eye: opens on the wind-up
        const ex = x + lean
        const ey = top + 2
        rect(s, ex - 6, ey - 6, 12, 11, STONE[2])
        const lid = B.strike || B.roar ? 4 : B.wind > 0.3 ? 3 : st === 'death' ? 0 : 2
        ellipse(s, ex, ey, 5, lid, C.white)
        if (lid > 0) { disc(s, ex + 1, ey, Math.min(2, lid), B.hurt ? C.ink : C.pink); px(s, ex + 1, ey, C.ink) } else line(s, ex - 4, ey, ex + 4, ey, C.ink)
        speckle(s, x - w - 8, top - 6, 2 * w + 16, y - top, STONE, 9)
        // threads unravelling off the edges
        const f = fr(t, 4, 2)
        for (let i = 0; i < 5; i++) {
            line(s, x + w + 8 + lean, top + 34 + i * 12, x + w + 14 + lean + ((i + f) & 1) * 2, top + 40 + i * 12 + f * 2, i & 1 ? C.haze : C.pink)
            line(s, x - w - 8 + lean, top + 40 + i * 12, x - w - 13 + lean, top + 46 + i * 12 - f, i & 1 ? C.bone0 : C.haze)
        }
        // two floating stone hands
        const hy = y - 44 + wv(t, 2.0, 2)
        const ha = bz(0, -14, 10)
        ball(s, x + w + 18 + lean + R(ha * 0.4), hy + R(ha), 6, 5, STONE)
        ball(s, x - w - 18 + lean, hy + 4, 6, 5, STONE)
        finish(s, Entry.Rise, 12)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 8)
        for (let i = 0; i < 3; i++) dst.set(x + dir * (-20 + ((i * 17 + k * 5) % 40)), y - 110 - ((k * 2 + i * 5) % 12), C.haze)
        if ((st === 'attack' && (B.strike || B.rec > 0.5)) || B.roar) {
            for (let i = 0; i < 44; i++) for (let j = -2; j <= 2; j++) if ((i + j) % 3) dst.set(x + dir * (4 + i), y - 102 + j + R(Math.sin(i * 0.4) * 1), j === 0 ? C.white : C.pink)
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 10 · The Void

/** Void Herald — the winged thing that announces the end, sounding a bone horn. */
export const VOID_HERALD: CreatureDef = {
    name: 'Void Herald', size: 96, shadow: 12, hover: 1, accent: C.purple2,
    states: bossStates(1.2, 1.6, 2.0),
    draw(s, st, t) {
        drive(this, st, t, 4, 1.6)
        const x = s.ax - 2 + B.lunge - B.kb
        const y = s.ay
        const hover = -12 + wv(t, 1.6, 2) + R(B.die * 14)
        const top = y - 56 + hover
        const flap = Math.sin(q(t) * Math.PI * 2 / 1.6)
        // four wings, starred
        wing(s, x - 2, top + 8, 30, flap * 0.6 + 0.5, VOIDM, false)
        wing(s, x - 2, top + 14, 24, flap * 0.6 - 0.4, VOIDM, false)
        // halo of black fire
        ring(s, x + 2, top - 6, 11, C.purple1)
        ring(s, x + 2, top - 6, 10, C.void)
        // body: a tall slender shape, violet-rimmed
        quad(s, x - 6, top + 6, x + 6, top + 6, x + 4, top + 50, x - 10, top + 50, C.void)
        line(s, x + 6, top + 6, x + 4, top + 50, C.purple2)
        line(s, x - 6, top + 6, x - 10, top + 50, C.purple0)
        for (let i = 0; i < 5; i++) px(s, x - 3 + ((i * 3) % 6), top + 12 + i * 8, (fr(t, 4, 2) + i) & 1 ? C.white : C.haze) // stars inside
        tri(s, x - 10, top + 50, x + 4, top + 50, x - 4, top + 58, C.void)
        // head: smooth, eyeless but for one line of light
        ellipse(s, x + 2, top, 5, 7, C.void)
        line(s, x + 2, top - 1, x + 6, top - 1, B.hurt ? C.white : C.pink)
        line(s, x + 6, top - 5, x + 6, top + 4, C.purple2)
        // back arm down, front arm raising the horn
        limbT(s, x - 4, top + 10, x - 8, top + 26, 3, 2, VOIDM)
        const a = bz(0.6, -0.7, -0.15)
        reach(x + 4, top + 10, a, 10)
        limbT(s, x + 4, top + 10, P.x, P.y, 3, 2, VOIDM)
        const hx = P.x
        const hy = P.y
        reach(hx, hy, a - 0.6, 14)
        line(s, hx, hy, P.x, P.y, C.bone1, 2)
        disc(s, P.x, P.y, 2.5, C.bone0)
        disc(s, P.x, P.y, 1.2, C.ink)
        line(s, hx, hy, P.x, P.y + 1, C.bone0)
        finish(s, Entry.Fade)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 10)
        for (let i = 0; i < 3; i++) dst.set(x + dir * (-20 + ((i * 13 + k * 3) % 40)), y - 20 - ((k * 5 + i * 9) % 50), C.purple2)
        if ((st === 'attack' && (B.strike || B.rec > 0.4)) || B.roar) {
            for (let r = 4; r <= 28; r += 6) {
                const rr = r + (k % 3) * 2
                for (let a = -0.7; a <= 0.7; a += 0.12) dst.set(x + dir * R(24 + Math.cos(a) * rr), y - 48 + R(Math.sin(a) * rr), r % 12 ? C.pink : C.white)
            }
        }
    }
}

/** Nihil, the Hunger at the End — a mouth the size of the sky, with eyes all round it. */
export const NIHIL: CreatureDef = {
    name: 'Nihil, the Hunger at the End', size: 128, shadow: 0, accent: C.pink,
    states: bossStates(1.6, 2.4, 2.8),
    draw(s, st, t) {
        drive(this, st, t, 8, 2.4)
        const x = s.ax - 2 + B.lunge - B.kb
        const y = s.ay
        const cy = y - 56 + B.breath + R(B.die * 20)
        const ph = q(t) * 1.8
        // tendrils trailing down into nothing
        for (let i = 0; i < 6; i++) tentacle(s, x - 26 + i * 10, cy + 36, Math.PI / 2 + (i - 2.5) * 0.18, 26, 3, ph + i, [C.ink, C.void, C.purple1])
        // the mass
        ellipse(s, x, cy, 50, 44, C.ink)
        ellipse(s, x - 2, cy - 2, 47, 41, C.void)
        voidFill(s, x - 50, cy - 44, 100, 88, t, 21)
        // a violet rim-light on the upper edge
        arc(s, x, cy, 49, Math.PI * 1.05, Math.PI * 1.95, C.purple2)
        arc(s, x, cy, 48, Math.PI * 1.15, Math.PI * 1.85, C.purple1)
        // the maw: a ring of teeth that opens on the wind-up and snaps on the strike
        const open = B.strike ? 26 : B.wind > 0 ? 14 + R(B.wind * 12) : B.roar ? 24 : 12 + wv(t, 2.4, 2)
        const mx = x + 10
        ellipse(s, mx, cy + 4, open * 0.8, open * 0.55, C.ink)
        ellipse(s, mx, cy + 4, open * 0.6, open * 0.4, C.purple0)
        disc(s, mx, cy + 4, Math.max(1, open * 0.15), C.pink)
        for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2
            const tx = mx + R(Math.cos(a) * open * 0.8)
            const ty = cy + 4 + R(Math.sin(a) * open * 0.55)
            const ix = mx + R(Math.cos(a) * open * 0.6)
            const iy = cy + 4 + R(Math.sin(a) * open * 0.4)
            tri(s, tx - 1, ty, tx + 1, ty, ix, iy, C.bone1)
            px(s, ix, iy, C.white)
        }
        // eyes all around
        for (let i = 0; i < 9; i++) {
            const a = -Math.PI * 0.95 + i * 0.26 + (i > 4 ? 0.6 : 0)
            const r = 36 + ((i * 7) % 5)
            const ex = x + R(Math.cos(a) * r * 0.9)
            const ey = cy + R(Math.sin(a) * r * 0.8)
            const blink = (fr(t, 3, 11) === i) || B.hurt
            ellipse(s, ex, ey, 3, blink ? 0 : 2, C.white)
            if (!blink) { px(s, ex + 1, ey, C.pink); px(s, ex + 1, ey - 1, C.ink) }
        }
        finish(s, Entry.Grow, 0)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 12)
        for (let i = 0; i < 6; i++) {
            // matter being pulled in toward the maw
            const a = i * 1.1 + k * 0.2
            const r = 60 - ((k * 4 + i * 9) % 40)
            dst.set(x + dir * (10 + R(Math.cos(a) * r)), y - 52 + R(Math.sin(a) * r * 0.7), i & 1 ? C.haze : C.purple2)
        }
    }
}

export const BOSSES_B: readonly (readonly [CreatureDef, CreatureDef])[] = [
    [MAGISTER_HALVANE, ARCHMAGE_ITHREN],
    [GRAVE_MARSHAL_KORR, OSSUAR],
    [STORMCROWN_ROC, ZEPHYRAX],
    [SISTER_VESPER, LIMINUS],
    [VOID_HERALD, NIHIL]
]

