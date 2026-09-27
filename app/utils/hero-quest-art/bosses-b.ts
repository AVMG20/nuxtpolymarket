// World bosses and super bosses, Worlds 6–10 — the walk past the Void's door and out through
// the edge of the world. See bosses-a.ts for the shared conventions.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { CF, fr, sm, span } from './creature'
import type { Mat } from './weapons'
import {
    B, Entry, bossStates, drive, finish, bz, ball, tentacle, glowEye, wing, speckle,
    limbT, reach, elbow, P, rect, px, line, disc, ellipse, tri, quad, dither, ditherEllipse, ring, arc, poly, q, wv, bayer, hash2
} from './boss-kit'
import { Surface, ditherDisc } from './surface'

const R = Math.round

const VIOLET: Mat = [C.purple0, C.purple1, C.purple2]
const VOIDM: Mat = [C.ink, C.void, C.purple0]
const STONE: Mat = [C.stone1, C.stone2, C.stone3]
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

// Stage 5: Grave Marshal Korr, the forgotten war's first dead, a hunched mass of fused skeletons
// under a black shroud with a sword of bone. Stage 10: Ossuar, the Thousand-Bone Host, a crowned
// skeleton king crawling on its hands out of a pool of darkness. (Both after Dark Souls, the
// user's call: Gravelord Nito and High Lord Wolnir.)

const SHROUD: Mat = [C.ink, C.void, C.night1]

/** A small skull at (x, y), two sockets and a jaw; `lit` whitens its crown. */
function skullBit(s: Surface, x: number, y: number, lit: boolean): void {
    rect(s, x - 2, y - 2, 5, 4, C.bone1)
    rect(s, x - 1, y + 2, 3, 1, C.bone0)
    if (lit) line(s, x - 1, y - 2, x + 1, y - 2, C.white)
    px(s, x - 1, y, C.ink); px(s, x + 1, y, C.ink)
    px(s, x, y + 1, C.bone0)
}

/** A long bone from (x0, y0) to (x1, y1), `w` thick, knobbed at both ends, lit along its top. */
function longBone(s: Surface, x0: number, y0: number, x1: number, y1: number, w: number): void {
    line(s, x0, y0, x1, y1, C.bone0, w)
    line(s, x0, y0 - 1, x1, y1 - 1, C.bone1, Math.max(1, w - 1))
    for (const [ex, ey] of [[x0, y0], [x1, y1]] as const) { disc(s, ex, ey, w * 0.8, C.bone0); disc(s, ex - 0.5, ey - 0.5, w * 0.55, C.bone1) }
}

/** Dark miasma pooled at (x, y) over `rx`, thinning at its edge, wisps curling up off it. */
function miasma(s: Surface, x: number, y: number, rx: number, ry: number, t: number): void {
    ditherEllipse(s, x, y, rx + 4, ry + 2, C.purple0, 5)
    ditherEllipse(s, x, y, rx, ry, C.void, 10)
    ditherEllipse(s, x, y, rx * 0.7, ry * 0.7, C.ink, 14)
    for (let i = 0; i < 6; i++) {
        const k = (t * 0.6 + i / 6) % 1
        const wx = x - rx + ((i * 37) % (rx * 2))
        const wy = y - k * 18
        if (k < 0.8) { px(s, R(wx + Math.sin(k * 6 + i) * 2), R(wy), i & 1 ? C.void : C.purple0); px(s, R(wx + Math.sin(k * 6 + i) * 2), R(wy) + 1, C.ink) }
    }
}

/**
 * A skull at (x, y) facing forward, `r` across: a shaded cranium, deep sockets, a nasal hole, a
 * row of teeth. `dim` shades it as one half-buried in the dark.
 */
function skull(s: Surface, x: number, y: number, r: number, dim: boolean): void {
    ellipse(s, x, y - r * 0.2, r, r * 0.85, dim ? C.bone0 : C.bone1)
    ellipse(s, x - r * 0.35, y + r * 0.1, r * 0.6, r * 0.6, dim ? C.stone2 : C.bone0) // the shade on its back and cheek
    if (!dim) line(s, R(x - r * 0.4), R(y - r), R(x + r * 0.4), R(y - r), C.white)
    ellipse(s, x + r * 0.15, y, r * 0.3, r * 0.35, C.ink)
    ellipse(s, x + r * 0.7, y, r * 0.22, r * 0.35, C.ink)
    px(s, x + r * 0.45, y + r * 0.45, C.ink)
    for (let i = 0; i < 3; i++) px(s, x + r * (0.1 + i * 0.3), y + r * 0.75, i & 1 ? C.ink : dim ? C.bone0 : C.bone1)
}

/** Korr's sword grip and blade angle, written into KS. */
const KS = { gx: 0, gy: 0, a: 0 }
const KORR_REST = { dx: 18, dy: 34, a: 0.7 }
/** The swing runs round a circle about his shoulder, the grip this far out, lagging the blade by GRIP_LAG. */
const KORR_SWING = { sx: 8, sy: 17, r: 18 }
const GRIP_LAG = -0.3
const KORR_BACK = { a: -2.4 }
const KORR_END = { a: 0.9 }

/**
 * Korr's sword on its swoop, `p` 0 → 1: the blade sweeps an arc from the backswing over his hump,
 * up over the top and down in front, the grip travelling a circle round his shoulder.
 */
function korrSwoop(x: number, top: number, p: number): void {
    KS.a = KORR_BACK.a + (KORR_END.a - KORR_BACK.a) * p
    const ga = KS.a + GRIP_LAG
    KS.gx = x + KORR_SWING.sx + Math.cos(ga) * KORR_SWING.r
    KS.gy = top + KORR_SWING.sy + Math.sin(ga) * KORR_SWING.r
}

/**
 * Grave Marshal Korr, the forgotten war's first dead, a grave lord: tall and hunched like a
 * vulture, high shoulders, the head low and forward between them. A black shroud hangs off him in
 * long torn strips, open down the front on a column of fused ribcages, spines and tangled arm bones
 * with skulls half-buried in them, and shreds at the ground into tendrils that fade into miasma; a
 * dark haze hangs round him. His head is a gaunt, angular skull deep in the cowl, pinpoints of
 * green in its sockets; skulls are fused into the cowl behind it and ribs rise from it like a crown
 * of spikes. His far arm hangs long with clawed fingers. He carries a long, jagged greatsword made
 * of fused bones and sweeps it up and down onto the front rank.
 */
export const GRAVE_MARSHAL_KORR: CreatureDef = {
    name: 'Grave Marshal Korr', size: 128, shadow: 0, accent: C.green4,
    states: bossStates(1.2, 1.6, 2.0),
    draw(s, st, t) {
        drive(this, st, t, 8, 1.6)
        const x = s.ax - 4 + B.lunge - B.kb
        const y = s.ay
        const sag = R(B.strike ? 3 : B.rec * 2 + B.die * 12)
        const top = y - 60 + sag + B.bob
        const sway = wv(t, 1.4, 2)
        // the haze of the grave hanging round him, and the miasma he stands in
        ditherEllipse(s, x + 1, top + 26, 26, 36, C.purple0, 2)
        miasma(s, x - 2, y - 2, 22, 4, t)
        // the far arm hanging long behind him, its fingers long claws
        longBone(s, x - 14, top + 6, x - 22, top + 24, 3)
        longBone(s, x - 22, top + 24, x - 21 + sway, top + 40, 2)
        for (let i = 0; i < 4; i++) {
            line(s, x - 21 + sway, top + 40, x - 24 + i * 2 + sway, top + 49, C.bone0)
            px(s, x - 24 + i * 2 + sway, top + 50, C.ink) // the claw tips
        }
        // the shroud: a hunched mass falling from high shoulders, torn into long strips
        // the hump of his back rises above his head; he narrows toward the ground
        poly(s, [-15, 4, -9, -9, 1, -7, 10, 4, 15, 16, 16, 34, 13, 50, -12, 52, -15, 34, -17, 16], x, top, SHROUD[0])
        for (let i = 0; i < 6; i++) {
            // the tears between the strips, and the dusk catching their folds
            const sx0 = x - 15 + i * 5
            line(s, sx0, top + 10 + (i & 1) * 6, sx0 - 1 + (i & 1), top + 50, C.void)
            if (i < 3) line(s, sx0 + 2, top + 16 + i * 3, sx0 + 2, top + 40, C.night1)
        }
        // the column of the dead down the open front: fused ribcages, a spine, tangled arm bones
        ellipse(s, x + 4, top + 30, 8, 20, C.ink)
        line(s, x + 3, top + 12, x + 4, top + 48, C.bone0)
        for (const [ry, w] of [[16, 6], [30, 5]] as const) {
            for (let i = 0; i < 4; i++) {
                arc(s, x + 4, top + ry + i * 3, w, Math.PI * 1.1, Math.PI * 1.9, C.bone1)
                px(s, x + 4 - w, top + ry + 1 + i * 3, C.bone0)
            }
        }
        longBone(s, x - 1, top + 40, x + 9, top + 34, 1.5)
        longBone(s, x + 8, top + 44, x + 1, top + 48, 1.5)
        skull(s, x + 1, top + 25, 3, true)
        skull(s, x + 6, top + 42, 3.5, false)
        skull(s, x - 1, top + 47, 3, true)
        // the front edge of the shroud falling open over it, ragged, lit along its edge
        poly(s, [10, 3, 16, 16, 18, 34, 16, 50, 11, 50, 13, 40, 10, 30, 12, 20, 8, 10], x, top, SHROUD[1])
        for (let i = 0; i < 4; i++) tri(s, x + 10 + (i & 1), top + 18 + i * 8, x + 13, top + 20 + i * 8, x + 8, top + 22 + i * 8, SHROUD[1])
        line(s, x + 10, top + 3, x + 16, top + 16, SHROUD[2]); line(s, x + 16, top + 16, x + 18, top + 34, SHROUD[2])
        line(s, x - 15, top + 4, x - 9, top - 9, SHROUD[2]); line(s, x - 9, top - 9, x + 1, top - 7, SHROUD[2]) // the rim of dusk on the hump of his back
        // the dead fused into the hump: great ribs arching back off it, a giant's spine under the shroud
        for (let i = 0; i < 3; i++) {
            const r = 11 + i * 4
            arc(s, x + 2, top + 4, r, Math.PI * 1.12, Math.PI * 1.5 - i * 0.04, C.bone0)
            arc(s, x + 2, top + 3, r, Math.PI * 1.15, Math.PI * 1.48 - i * 0.04, C.bone1)
            px(s, R(x + 2 + Math.cos(Math.PI * 1.12) * r), R(top + 4 + Math.sin(Math.PI * 1.12) * r), C.white) // the broken end
        }
        skull(s, x - 10, top - 5, 4, true)
        skull(s, x - 4, top - 8, 3.5, false)
        skull(s, x - 14, top + 3, 3, true)
        // the hem shredded into tendrils trailing into the miasma
        for (let i = 0; i < 10; i++) {
            const hx0 = x - 16 + i * 3.6 + R(Math.sin(t * 3 + i) * 1)
            const len = 4 + ((i * 7) % 5)
            tri(s, hx0 - 2, top + 49, hx0 + 2, top + 49, hx0 + R(sway / 2) + (i & 1 ? 1 : -1), top + 51 + len, i & 1 ? C.void : C.ink)
        }
        dither(s, x - 18, top + 52, 36, 6, C.void, 6)
        // the cowl, peaked back, skulls fused into it and ribs rising from it like a crown of spikes
        const hx = x + 12
        const hy = top + 12 + R(bz(0, -2, 3))
        poly(s, [-12, -4, -6, -12, 2, -11, 7, -5, 8, 4, 4, 11, -8, 11], hx, hy, SHROUD[0])
        line(s, hx - 6, hy - 12, hx + 2, hy - 11, SHROUD[2]); line(s, hx + 2, hy - 11, hx + 7, hy - 5, SHROUD[2])
        // the face: a gaunt, angular skull deep in the cowl, the cowl's shadow over its brow
        ellipse(s, hx + 2, hy, 7, 9, C.ink) // the opening of the cowl
        poly(s, [-4, -7, 4, -8, 8, -4, 8, 2, 6, 6, 5, 10, 0, 10, -3, 7, -4, 1], hx, hy, C.bone1)
        poly(s, [-4, -7, -1, -7, -1, 7, -3, 7, -4, 1], hx, hy, C.bone0)
        line(s, hx + 5, hy + 3, hx + 5, hy + 7, C.bone0) // the hollow under the cheekbone
        dither(s, hx - 4, hy - 8, 13, 3, C.ink, 8) // the cowl's shadow over the brow
        line(s, hx - 1, hy - 4, hx + 8, hy - 4, C.bone0) // the brow ridge
        rect(s, hx, hy - 3, 3, 4, C.ink); rect(s, hx + 5, hy - 3, 2, 4, C.ink) // the sockets, deep
        if (!B.hurt) ditherDisc(s, hx + 3, hy - 1, 3, C.green2, 3 + R(B.glow * 5))
        px(s, hx + 1, hy - 2, B.hurt ? C.white : C.green4); px(s, hx + 5, hy - 2, B.hurt ? C.white : C.green3)
        tri(s, hx + 3, hy + 3, hx + 4, hy + 1, hx + 4, hy + 3, C.ink) // the nasal hole
        const open = B.strike || B.roar ? 3 : 0
        rect(s, hx, hy + 6, 6, 1 + open, C.ink)
        for (let i = 0; i < 3; i++) px(s, hx + i * 2, hy + 6, C.bone1) // the teeth
        if (open) { line(s, hx, hy + 7 + open, hx + 5, hy + 7 + open, C.bone0); for (let i = 0; i < 3; i++) px(s, hx + 1 + i * 2, hy + 6 + open, C.bone1) }
        // The sword of fused bones: rested low before it, drawn back over his hump (an overhead lift
        // would cross his face), then a slice rather than a stab: the blade swoops through an arc
        // over the top and down in front, a trail behind its tip, and follows through low.
        const u = st === 'attack' ? q(t) / this.states.attack!.dur : 0
        let swoop = -1
        if (st === 'attack' && u >= 0.4 && u < 0.6) {
            swoop = sm(Math.min(1, (u - 0.4) / 0.1))
            korrSwoop(x, top, swoop)
        } else if (st === 'attack' && u >= 0.6) {
            // the recovery, from the follow-through back to rest
            korrSwoop(x, top, 1)
            const r = sm((u - 0.6) / 0.4)
            KS.gx += (x + KORR_REST.dx - KS.gx) * r
            KS.gy += (top + KORR_REST.dy - KS.gy) * r
            KS.a += (KORR_REST.a - KS.a) * r
        } else {
            // The backswing, from rest to the start of the circle, low like a reaper's: the blade
            // swings down and back past his legs and up behind him, so it never crosses his face.
            // The hand leads and the blade lags, which keeps the tip off the ground as it passes.
            korrSwoop(x, top, 0)
            const gw = Math.sqrt(B.wind)
            KS.gx = x + KORR_REST.dx + (KS.gx - x - KORR_REST.dx) * gw
            KS.gy = top + KORR_REST.dy + (KS.gy - top - KORR_REST.dy) * gw
            KS.a = KORR_REST.a + (KS.a + Math.PI * 2 - KORR_REST.a) * B.wind * B.wind
        }
        const gx = R(KS.gx)
        const gy = R(KS.gy)
        const a = KS.a
        if (swoop > 0) {
            // the trail: where the tip and the blade's middle have just been, thinning behind
            let prev: number[] | null = null
            for (let k = 0; k <= 24; k++) {
                const pk = swoop - k * 0.025
                if (pk < 0) break
                korrSwoop(x, top, pk)
                const tdx = Math.cos(KS.a)
                const tdy = Math.sin(KS.a)
                // a solid smear from the blade's middle out to its tip, brightest at the edge
                const pts = [44, 42, 40, 38, 36, 34, 32, 30, 28].map(d => [R(KS.gx + tdx * d), R(KS.gy + tdy * d)] as const)
                if (prev) {
                    const fade = k / 24
                    for (let j = 0; j < pts.length; j++) {
                        const c = j < 2 ? (fade < 0.3 ? C.white : fade < 0.65 ? C.bone1 : C.stone3) : j < 5 ? (fade < 0.45 ? C.bone1 : C.stone3) : C.stone3
                        // the smear thins toward its tail and toward the blade's middle
                        if (fade < 0.35 - j * 0.03 || bayer(pts[j]![0], pts[j]![1], R(12 - fade * 12 - j))) line(s, prev[j * 2]!, prev[j * 2 + 1]!, pts[j]![0], pts[j]![1], c)
                    }
                }
                prev = pts.flat()
            }
        }
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        const nx = -dy
        const ny = dx
        // the arm from under the cowl, bent at the elbow, thick enough to read against the ribs
        elbow(x + KORR_SWING.sx, top + KORR_SWING.sy, gx, gy, 11, 11, 1)
        longBone(s, x + KORR_SWING.sx, top + KORR_SWING.sy, P.x, P.y, 3)
        longBone(s, P.x, P.y, gx, gy, 2.5)
        const L = 40
        // the blade: a spine of fused vertebrae, jagged with ribs and teeth down one edge
        line(s, R(gx), R(gy), R(gx + dx * L), R(gy + dy * L), C.bone0, 4)
        line(s, R(gx - nx), R(gy - ny), R(gx + dx * L - nx), R(gy + dy * L - ny), C.bone1, 2)
        for (let i = 3; i < L; i += 4) {
            const bx = gx + dx * i
            const by = gy + dy * i
            px(s, R(bx), R(by), C.ink) // the joints between the vertebrae
            line(s, R(bx + nx * 2), R(by + ny * 2), R(bx + nx * 4 + dx * 2), R(by + ny * 4 + dy * 2), C.bone0) // a rib jutting off the edge
            if ((i >> 2) % 3 === 1) skullBit(s, R(bx - nx), R(by - ny), false)
        }
        tri(s, gx + dx * L - nx * 2, gy + dy * L - ny * 2, gx + dx * L + nx * 2, gy + dy * L + ny * 2, gx + dx * (L + 6), gy + dy * (L + 6), C.bone1)
        line(s, R(gx - dx * 7), R(gy - dy * 7), R(gx), R(gy), C.bone0, 2) // the hilt, a thighbone
        disc(s, gx - dx * 8, gy - dy * 8, 2, C.bone1)
        // the hand: bony fingers wrapped round the hilt, knuckles lit
        disc(s, gx - dx * 1.5, gy - dy * 1.5, 2, C.bone0)
        for (let i = 0; i < 3; i++) {
            const fx = gx - dx * (i * 1.6 - 1)
            const fy = gy - dy * (i * 1.6 - 1)
            line(s, R(fx - nx * 2.5), R(fy - ny * 2.5), R(fx + nx * 2.5), R(fy + ny * 2.5), C.bone0)
            px(s, R(fx + nx * 2.5), R(fy + ny * 2.5), C.bone1)
        }
        finish(s, Entry.Rise, 12)
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'attack' && B.strike) {
            // the sweep: bone and dark thrown up where the blade bites
            for (let i = 0; i < 12; i++) dst.set(x + dir * (40 + i * 2), y - (i % 3), i & 1 ? C.bone1 : C.purple0)
            for (let i = 0; i < 6; i++) dst.set(x + dir * (44 + i * 3), y - 3 - ((i * 5) % 7), i & 1 ? C.void : C.green3)
        }
        const k = fr(t, 10, 8)
        for (let i = 0; i < 3; i++) dst.set(x + dir * (-8 + i * 8), y - 20 - ((k * 3 + i * 9) % 30), i & 1 ? C.purple0 : C.void)
    }
}

/**
 * A great skeletal arm from the shoulder (sx, sy) through the elbow (ex, ey) to the wrist (wx, wy):
 * a thick upper bone, the two bones of the forearm side by side, gold bangles stacked at the wrist.
 */
function royalArm(s: Surface, sx: number, sy: number, ex: number, ey: number, wx: number, wy: number, w: number): void {
    longBone(s, sx, sy, ex, ey, w)
    const L = Math.hypot(wx - ex, wy - ey) || 1
    const nx = -(wy - ey) / L
    const ny = (wx - ex) / L
    longBone(s, ex + nx * w * 0.4, ey + ny * w * 0.4, wx + nx * w * 0.3, wy + ny * w * 0.3, w * 0.6)
    longBone(s, ex - nx * w * 0.4, ey - ny * w * 0.4, wx - nx * w * 0.3, wy - ny * w * 0.3, w * 0.55)
    for (let i = 0; i < 3; i++) {
        // the bangles, heavy gold, lit on top
        const bx = wx - (wx - ex) / L * (3 + i * 3)
        const by = wy - (wy - ey) / L * (3 + i * 3)
        line(s, R(bx - nx * (w + 1)), R(by - ny * (w + 1)), R(bx + nx * (w + 1)), R(by + ny * (w + 1)), C.gold1, 2)
        px(s, R(bx - nx * w), R(by - ny * w - 1), C.gold3)
        if (i === 1) px(s, R(bx), R(by), C.red2) // a jewel set in the middle one
    }
}

/**
 * A skeletal hand at the wrist (wx, wy) pointing along `a`: a palm of small bones and five long
 * fingers of two joints each, fanned by `spread` and bent by `curl`, dark claws at the tips.
 */
function boneHand(s: Surface, wx: number, wy: number, a: number, spread: number, curl: number, k = 1): void {
    const px0 = wx + Math.cos(a) * 4 * k
    const py0 = wy + Math.sin(a) * 4 * k
    disc(s, px0, py0, 4 * k, C.bone0)
    disc(s, px0 - 0.5, py0 - 0.5, 3 * k, C.bone1)
    for (let i = 0; i < 5; i++) {
        const fa = a + (i - 2) * spread
        const kx = px0 + Math.cos(fa) * 8 * k
        const ky = py0 + Math.sin(fa) * 8 * k
        const ta = fa + curl
        const tx = kx + Math.cos(ta) * 6 * k
        const ty = ky + Math.sin(ta) * 6 * k
        longBone(s, px0, py0, kx, ky, (i === 0 ? 1.5 : 2) * k)
        longBone(s, kx, ky, tx, ty, 1.5 * k)
        px(s, R(tx + Math.cos(ta) * 1.5 * k), R(ty + Math.sin(ta) * 1.5 * k), C.ink) // the claw
    }
}

/**
 * Ossuar, the Thousand-Bone Host: a colossal crowned skeleton crawling on its hands out of a
 * swirling mass of darkness at its back, pale souls adrift in it. Its spine arches up from the dark
 * to high shoulders, spiked vertebrae, a ribcage hanging beneath; a royal robe, dark with a gold
 * hem, is draped over its back and torn into strips down its side. Its great skull thrusts forward
 * low under a tall gold crown of spires, the sockets deep with pinpoints of green, a long upper jaw
 * of teeth and a hinged lower one. Its arms are massive, the forearm's two bones side by side,
 * gold bangles stacked at the wrists, the hands long-fingered. The far hand stays planted; the
 * near one rears high above its crown, fingers spread, and slams down flat on the front rank.
 */
export const OSSUAR: CreatureDef = {
    name: 'Ossuar, the Thousand-Bone Host', size: 256, shadow: 0, accent: C.green4,
    states: bossStates(1.5, 2.0, 2.6),
    draw(s, st, t) {
        // barely lunges: at his size a lunge only pushes the skull into the front rank
        drive(this, st, t, 2, 2.0)
        // Large and low: the camera shows about 106 px above the floor, so it grows along the
        // ground instead, its back running off the edge of the stage into the dark.
        // set back so his resting hand stays clear of the party; the slam reaches forward onto it
        const x = s.ax - 44 + B.lunge - B.kb
        const y = s.ay
        const sink = R(B.die * 50)
        // the body sits 12 px down so the crown and the arch of the back clear the HUD; the planted
        // hands stay on the ground
        const hv = B.breath + sink + 12
        // the darkness at its back, swirling, souls adrift in it, running off the edge
        for (let i = 0; i < 9; i++) {
            const a = q(t) * 0.7 + i * 0.7
            const bx = x - 104 + Math.cos(a) * (12 + (i % 3) * 10) + (i % 3) * 8
            const by = y - 36 - i * 6 + Math.sin(a) * 7 + sink
            ditherEllipse(s, bx, by, 32 - i * 1.5, 24 - i, C.purple0, 5)
            ditherEllipse(s, bx + 3, by + 3, 26 - i * 1.5, 19 - i, C.void, 11)
            ditherEllipse(s, bx + 4, by + 4, 17 - i, 12 - i * 0.7, C.ink, 14)
        }
        for (let i = 0; i < 8; i++) {
            // the souls: pale faces in the dark, drifting up
            const k = (q(t) * 0.25 + i / 8) % 1
            const sx0 = x - 132 + ((i * 29) % 70)
            const sy0 = y - 16 - k * 80 + sink
            px(s, sx0, sy0, C.haze); px(s, sx0 + 2, sy0, C.haze); px(s, sx0 + 1, sy0 + 2, C.night3)
        }
        // the far arm, planted: the hand flat on the ground ahead, fingers splayed
        royalArm(s, x + 14, y - 82 + hv, x - 8, y - 46 + hv, x + 40, y - 16, 8)
        boneHand(s, x + 40, y - 16, 0.3, 0.26, 0.5, 1.6)
        // the spine arching back from high shoulders into the dark, spiked, the ribcage under it
        const spine: number[] = []
        for (let i = 0; i < 15; i++) {
            const u = i / 14
            const fall = Math.pow(Math.max(0, (u - 0.25) / 0.75), 1.3)
            spine.push(x + 22 - u * 150, y - 86 - Math.sin(Math.min(1, u / 0.25) * Math.PI / 2) * 8 + fall * 64 + hv)
        }
        for (let i = 1; i < 11; i++) {
            // the ribs, hanging from the spine and curving forward under it
            const rx0 = spine[i * 2]!
            const ry0 = spine[i * 2 + 1]!
            const drop = 28 + Math.sin(i / 10 * Math.PI) * 14
            longBone(s, rx0, ry0 + 3, rx0 + 8, ry0 + drop * 0.6, 3)
            longBone(s, rx0 + 8, ry0 + drop * 0.6, rx0 + 13, ry0 + drop, 2)
        }
        for (let i = 0; i < 15; i++) {
            const vx = spine[i * 2]!
            const vy = spine[i * 2 + 1]!
            ellipse(s, vx, vy, 7, 5.5, C.bone0)
            ellipse(s, vx - 1, vy - 1.5, 5, 3.5, C.bone1)
            tri(s, vx - 3, vy - 4, vx + 2, vy - 4, vx - 4, vy - 13, C.bone1) // the spinous process
            px(s, vx - 4, vy - 13, C.white)
        }
        // the royal robe draped over its back, hanging in a curtain down its side, a gold hem
        const flap = wv(t, 1.1, 2)
        const robe: number[] = []
        for (let i = 0; i < 15; i++) robe.push(spine[i * 2]!, spine[i * 2 + 1]! - 6)
        const hem = (i: number) => Math.min(y - 24, spine[i * 2 + 1]! + 20 + ((i * 7) % 3) * 7 + (i % 4 === 1 ? -10 : 0))
        for (let i = 14; i >= 0; i--) robe.push(spine[i * 2]! + 6 + (i & 1 ? R(flap) : 0), hem(i))
        poly(s, robe, 0, 0, C.night0)
        for (let i = 1; i < 14; i++) {
            // the folds: wedges of lit and shadowed cloth following the drape down from the spine
            const fx = spine[i * 2]!
            const fy = spine[i * 2 + 1]! - 2
            const hy0 = hem(i)
            if (i % 2 === 0) tri(s, fx - 1, fy, fx + 3, fy, fx + 5 + (i & 2 ? R(flap) : 0), hy0 - 3, C.night1)
            else tri(s, fx - 2, fy + 2, fx + 1, fy + 2, fx + 2, hy0 - 1, C.void)
            if (i % 4 === 0) line(s, fx + 1, fy + 1, fx + 4, hy0 - 6, C.night2) // the lit crest of a fold
        }
        // a tear through the cloth, the ribs showing in it
        const tx0 = spine[10]! + 4
        const ty0 = spine[11]! + 10
        poly(s, [-4, 0, 3, -2, 6, 4, 2, 9, -3, 7], tx0, ty0, C.ink)
        for (let i = 0; i < 3; i++) line(s, tx0 - 2 + i * 2, ty0 + i * 2, tx0 + i * 2, ty0 + 5 + i, C.bone0)
        // the gold edge along the spine, and the embroidered border along the hem
        for (let i = 0; i < 14; i++) line(s, spine[i * 2]!, spine[i * 2 + 1]! - 6, spine[i * 2 + 2]!, spine[i * 2 + 3]! - 6, C.gold0)
        for (let i = 0; i < 14; i++) {
            const ax = spine[i * 2]! + 6
            const ay = Math.min(y - 30, spine[i * 2 + 1]! + 16)
            const bx = spine[i * 2 + 2]! + 6
            const by = Math.min(y - 30, spine[i * 2 + 3]! + 16)
            line(s, ax, ay, bx, by, C.gold0)
            line(s, ax, ay + 1, bx, by + 1, C.gold1)
            line(s, ax, ay + 3, bx, by + 3, C.gold0)
            // the stitched motif between its lines: a lozenge and a point, in turn
            const mx = R((ax + bx) / 2)
            const my = R((ay + by) / 2) + 2
            if (i & 1) { px(s, mx, my, C.gold3); px(s, mx - 1, my, C.purple2); px(s, mx + 1, my, C.purple2) } else px(s, mx, my, C.gold2)
        }
        // the royal sigil embroidered on its side: a small gold crown over a skull
        const gx0 = spine[8]! + 2
        const gy0 = spine[9]! + 12
        line(s, gx0 - 4, gy0, gx0 + 4, gy0, C.gold1)
        for (let i = 0; i < 3; i++) tri(s, gx0 - 4 + i * 4, gy0, gx0 - 2 + i * 4, gy0, gx0 - 3 + i * 4, gy0 - 3 - (i === 1 ? 1 : 0), C.gold2)
        rect(s, gx0 - 2, gy0 + 2, 5, 4, C.gold1); px(s, gx0 - 1, gy0 + 3, C.night0); px(s, gx0 + 1, gy0 + 3, C.night0)
        // the brooch fastening the robe at the shoulder
        const bx0 = spine[0]! - 2
        const by0 = spine[1]! + 2
        disc(s, bx0, by0, 3.5, C.gold1); disc(s, bx0 - 0.5, by0 - 0.5, 2.5, C.gold2)
        disc(s, bx0, by0, 1.6, C.red1); px(s, bx0 - 1, by0 - 1, C.red3)
        for (let i = 0; i < 4; i++) px(s, R(bx0 + Math.cos(i * Math.PI / 2 + 0.78) * 4), R(by0 + Math.sin(i * Math.PI / 2 + 0.78) * 4), C.gold3)
        for (let i = 1; i < 14; i++) {
            // the torn edge: long tatters hanging off the hem, swaying, gold at their ends
            const tx = spine[i * 2]! + 4
            const ty = hem(i) - 2
            const len = 8 + ((i * 5) % 4) * 3
            const sw = R(flap * (i & 1 ? 1 : -1))
            tri(s, tx - 3, ty, tx + 3, ty, tx + sw, ty + len, i & 1 ? C.night0 : C.void)
            px(s, tx + sw, ty + len, C.gold1)
            if (i % 3 === 0) line(s, tx - 2, ty, tx + 2, ty, C.gold1)
        }
        for (let i = 0; i < 4; i++) {
            const bx = x - 118 - i * 8 + R(Math.sin(q(t) * 1.2 + i) * 4)
            const by = y - 30 - i * 7 + sink
            ditherEllipse(s, bx, by, 20 - i * 2, 16 - i * 2, C.void, 10)
            ditherEllipse(s, bx + 3, by + 3, 13 - i * 2, 10 - i * 2, C.ink, 14)
        }
        // the neck, vertebrae running forward to the skull
        for (let i = 0; i < 4; i++) { const nx0 = x + 26 + i * 6; const ny0 = y - 84 + i * 3 + hv; ellipse(s, nx0, ny0, 5, 4, C.bone0); px(s, nx0 - 1, ny0 - 3, C.bone1) }
        // the great skull, thrust forward low
        const hx = x + 66
        const hy = y - 62 + hv + R(bz(0, -4, 6))
        const open = B.strike || B.roar ? 9 : B.wind * 3
        ellipse(s, hx - 5, hy - 9, 22, 18, C.bone0) // the cranium
        ellipse(s, hx - 6, hy - 12, 20, 15, C.bone1)
        arc(s, hx - 6, hy - 12, 17, Math.PI * 1.15, Math.PI * 1.6, C.white) // the light across its dome
        arc(s, hx - 6, hy - 12, 16, Math.PI * 1.2, Math.PI * 1.5, C.white)
        ellipse(s, hx - 18, hy - 2, 8, 11, C.bone0) // the shade on its back
        arc(s, hx - 18, hy - 2, 7, Math.PI * 0.55, Math.PI * 1.3, C.brown2) // old bone shades warm
        arc(s, hx - 18, hy - 2, 6, Math.PI * 0.6, Math.PI * 1.25, C.brown2)
        // the sutures and the cracks of great age across the cranium, pitting
        for (let i = 0; i < 6; i++) px(s, hx - 20 + i * 3, hy - 17 + ((i * 5) % 3) - (i & 1), C.brown2)
        line(s, hx - 4, hy - 24, hx - 6, hy - 18, C.ink); line(s, hx - 6, hy - 18, hx - 3, hy - 14, C.ink); line(s, hx - 3, hy - 14, hx - 5, hy - 10, C.brown2)
        line(s, hx - 14, hy - 12, hx - 10, hy - 9, C.brown2)
        for (const [ox, oy] of [[-12, -16], [-2, -20], [-16, -8], [-8, -6], [2, -14]] as const) px(s, hx + ox, hy + oy, C.bone0)
        // the temple's hollow behind the eye, the cheekbone's arch running back to the ear hole
        ellipse(s, hx - 5, hy - 2, 5, 6, C.bone0)
        ellipse(s, hx - 5, hy + 1, 2, 3, C.brown2)
        ellipse(s, hx - 11, hy + 5, 2, 2.5, C.ink) // the ear hole
        poly(s, [3, -9, 25, -6, 28, 5, 25, 13, 3, 13], hx, hy, C.bone1) // the long upper jaw
        line(s, hx - 9, hy + 4, hx + 4, hy + 5, C.bone1) // the cheekbone's arch
        line(s, hx - 9, hy + 5, hx + 4, hy + 6, C.bone0)
        line(s, hx + 4, hy - 7, hx + 24, hy - 5, C.bone0) // the shadow under the brow
        line(s, hx + 3, hy - 9, hx + 25, hy - 6, C.bone0) // the brow ridge
        line(s, hx + 3, hy - 10, hx + 22, hy - 8, C.white)
        // the sockets, deep, rimmed, pinpoints of green burning in them
        ellipse(s, hx + 6, hy - 2, 7.5, 7, C.bone0)
        ellipse(s, hx + 19, hy - 2, 5.5, 7, C.bone0)
        ellipse(s, hx + 6, hy - 2, 6.5, 6, C.ink)
        ellipse(s, hx + 19, hy - 2, 4.5, 6, C.ink)
        arc(s, hx + 6, hy - 1, 7, Math.PI * 0.2, Math.PI * 0.8, C.white) // the lit lower rims
        arc(s, hx + 19, hy - 1, 5, Math.PI * 0.25, Math.PI * 0.75, C.bone1)
        if (!B.hurt && B.glow > 0.3) { ditherDisc(s, hx + 6, hy - 2, 7, C.green2, 3 + R(B.glow * 3)); ditherDisc(s, hx + 19, hy - 2, 5, C.green2, 3 + R(B.glow * 3)) }
        glowEye(s, hx + 7, hy - 1, B.hurt ? C.white : C.green4, C.green2, true)
        glowEye(s, hx + 19, hy - 1, B.hurt ? C.white : C.green4, C.green2)
        line(s, hx + 10, hy + 5, hx + 14, hy + 8, C.bone0) // the cheek below the socket
        poly(s, [13, 4, 16, 4, 17, 9, 14, 10, 12, 9], hx, hy, C.ink) // the nasal cavity
        line(s, hx + 14, hy + 4, hx + 14, hy + 9, C.bone0) // the septum
        line(s, hx + 4, hy + 11, hx + 26, hy + 11, C.bone0) // the gumline
        for (let i = 0; i < 11; i++) {
            // the upper teeth: long and uneven, canines longest, two missing
            if (i === 3 || i === 8) { rect(s, hx + 4 + i * 2, hy + 12, 2, 3, C.ink); continue }
            const len = i === 2 || i === 9 ? 6 : 4 - (i & 1)
            rect(s, hx + 4 + i * 2, hy + 12, 1, len, C.bone1)
            px(s, hx + 4 + i * 2, hy + 12, C.white)
            px(s, hx + 5 + i * 2, hy + 12, C.ink)
        }
        // the lower jaw, hinged at the back, dropping open on the slam and the roar
        const jo = R(open)
        poly(s, [-9, 13, 27, 14 + jo, 26, 20 + jo, 3, 21 + jo, -9, 18], hx, hy, C.bone0)
        line(s, hx - 8, hy + 14, hx + 26, hy + 15 + jo, C.bone1)
        for (let i = 0; i < 10; i++) { rect(s, hx + 6 + i * 2, hy + 11 + jo, 1, 3, C.bone1); px(s, hx + 7 + i * 2, hy + 12 + jo, C.ink) } // the lower teeth
        if (jo > 2) rect(s, hx + 5, hy + 17, 20, jo - 2, C.ink)
        // The crown: a tall gold band sat back on the skull, scrollwork along it, a ruby in a bezel at
        // its centre with a sapphire and an emerald beside it, pearls along its lower edge; spires
        // tipped with jewels between trefoils; chains of gold hung with jewels off its sides.
        for (const [cx0, ln] of [[-22, 12], [7, 9]] as const) {
            // the jewelled chains swinging off the band
            const sw = R(wv(t, 1.3, 1))
            for (let k = 0; k < ln; k++) px(s, hx + cx0 + (k * sw) / ln, hy - 22 + k, k & 1 ? C.gold1 : C.gold2)
            disc(s, hx + cx0 + sw, hy - 21 + ln, 1.3, C.red1); px(s, hx + cx0 + sw, hy - 22 + ln, C.red3)
        }
        poly(s, [-22, -20, 8, -24, 8, -31, -22, -27], hx, hy, C.gold1)
        line(s, hx - 22, hy - 27, hx + 8, hy - 31, C.gold3)
        line(s, hx - 22, hy - 20, hx + 8, hy - 24, C.gold0)
        for (let i = 0; i < 15; i++) {
            // the scrollwork, and the pearls under it
            const sx0 = hx - 21 + i * 2
            const sy0 = hy - 24 - R(i * 2 * 4 / 30)
            px(s, sx0, sy0 - (i % 3 === 0 ? 1 : 0), i % 3 === 0 ? C.gold3 : C.gold0)
            if (i & 1) px(s, sx0, sy0 + 3, C.white)
        }
        for (const [ox, gem, lit, r] of [[-15, C.blue1, C.blue2, 1.6], [-7, C.red1, C.red3, 2.4], [1, C.green2, C.green4, 1.6]] as const) {
            // the stones, each in a bezel of dark gold
            const gy0 = hy - 25 - R((ox + 22) * 4 / 30)
            disc(s, hx + ox, gy0, r + 1, C.gold0)
            disc(s, hx + ox, gy0, r, gem)
            px(s, hx + ox - 1, gy0 - 1, lit); px(s, hx + ox - 1, gy0 - 1 - (r > 2 ? 1 : 0), C.white)
        }
        for (let i = 0; i < 8; i++) {
            const cx = hx - 21 + i * 4
            const by = hy - 27 - R(i * 0.5)
            if (i & 1) {
                // a trefoil
                tri(s, cx - 1.5, by, cx + 1.5, by, cx - 0.5, by - 5, C.gold2)
                disc(s, cx - 1, by - 6, 1.3, C.gold2); disc(s, cx - 2.5, by - 4, 1, C.gold2); disc(s, cx + 0.5, by - 4, 1, C.gold2)
                px(s, R(cx - 1), by - 7, C.gold3)
                continue
            }
            const h = i === 4 ? 15 : 11
            tri(s, cx - 2, by, cx + 2, by, cx - 1, by - h, C.gold2)
            line(s, R(cx), by, R(cx - 1), by - h + 1, C.gold3)
            disc(s, cx - 1, by - h - 1, 1.2, i === 4 ? C.green4 : i === 0 ? C.blue2 : C.red2) // the jewel on its tip
            px(s, R(cx - 1.5), by - h - 2, C.white)
        }
        // the near arm: rears high above its crown, fingers spread, and slams down flat
        // the shoulder sits on the torso at the front of the ribcage, beside the far one, not at the
        // base of the skull; a shoulder blade and a ball joint anchor it there
        const nsx = x + 18
        const nsy = y - 76 + hv
        ellipse(s, nsx - 6, nsy - 3, 9, 6, C.bone0)
        ellipse(s, nsx - 7, nsy - 5, 7, 3.5, C.bone1)
        line(s, nsx - 14, nsy - 1, nsx + 1, nsy - 7, C.stone3) // the ridge of the blade
        const wxr = x + 100 + R(bz(0, -14, 16))
        const wyr = y - 16 + R(bz(0, -70, 2)) // the raised hand stays under the top of the camera
        elbow(nsx, nsy, wxr, wyr, 52, 56, B.wind > 0.3 ? -1 : 1)
        royalArm(s, nsx, nsy, P.x, P.y, wxr, wyr, 9)
        disc(s, nsx, nsy, 6, C.bone0); disc(s, nsx - 1, nsy - 1, 4.5, C.bone1); px(s, nsx - 3, nsy - 4, C.white) // the ball of the shoulder
        const fa = B.wind > 0.3 ? -1.1 : 0.3
        boneHand(s, wxr, wyr, fa, B.wind > 0.3 ? 0.4 : 0.28, B.wind > 0.3 ? 0.2 : 0.5, 1.7)
        if (B.strike) {
            // the smear of the hand coming down
            for (let i = 1; i < 7; i++) {
                const ty = wyr - i * 12
                for (let k = -8; k <= 18; k += 2) if (bayer(wxr + k, ty, 12 - i * 2)) px(s, wxr + k, ty, i < 3 ? C.bone1 : C.stone3)
            }
        }
        finish(s, Entry.Rise, 0)
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'attack' && B.strike) {
            // the slam: the ground cracks, bone and dark thrown up, soul-fire bursting
            const hx = x + dir * 84
            for (let i = 0; i < 18; i++) dst.set(hx + dir * (-8 + i * 2), y - (i % 4), i & 1 ? C.bone1 : C.stone3)
            for (let i = 0; i < 12; i++) dst.set(hx + dir * (-6 + i * 3), y - 4 - ((i * 7) % 15), i & 1 ? C.green4 : C.void)
            for (let i = 0; i < 9; i++) {
                const a = -Math.PI * (0.1 + i * 0.1)
                dst.set(hx + dir * R(Math.cos(a) * 14), y + R(Math.sin(a) * 8), i & 1 ? C.white : C.bone1)
            }
        }
        const k = fr(t, 10, 10)
        for (let i = 0; i < 3; i++) dst.set(x - dir * (40 + i * 20), y - 20 - ((k * 3 + i * 7) % 40), i & 1 ? C.purple0 : C.haze)
    }
}

// ═══════════════════════════════════════════════════════════════ 8 · The Shattered Sky

// Stage 5: Stormcrown Roc, the thunderbird of the broken sky, wearing a crown of its own
// lightning. Stage 10: Zephyrax, Breaker of Heavens, a sky-dragon coiling through the storm.

const PLUME: Mat = [C.night0, C.night1, C.night2]
const PLUME_FAR: Mat = [C.ink, C.void, C.night0]
const BREAST: Mat = [C.steel1, C.steel2, C.steel3]
const HEAD_WHITE: Mat = [C.steel2, C.steel3, C.white]

/**
 * A great wing from the shoulder (sx, sy) along `a`, `L` long: secondaries falling back off the
 * arm, primaries fanning from the wrist with the longest at the leading edge, coverts over their
 * roots in scalloped rows, a lit leading edge and a zigzag of lightning down its length that
 * flares with `flare`.
 */
function rocWing(s: Surface, sx: number, sy: number, a: number, L: number, m: Mat, tip: number, flare: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const ta = a - Math.PI / 2
    const wx = sx + dx * L * 0.42
    const wy = sy + dy * L * 0.42
    for (let i = 0; i < 6; i++) {
        // the secondaries, falling back off the arm
        const u = 0.1 + i * 0.17
        const bx = sx + (wx - sx) * u
        const by = sy + (wy - sy) * u
        const len = L * (0.36 - i * 0.012)
        const fa = ta + 0.35 - i * 0.05
        limbT(s, bx, by, bx + Math.cos(fa) * len, by + Math.sin(fa) * len, 5, 2, m)
        px(s, R(bx + Math.cos(fa) * len), R(by + Math.sin(fa) * len), tip)
    }
    for (let i = 6; i >= 0; i--) {
        // the primaries, fanning from the wrist, the fingered tips pale
        const fa = a - i * 0.2
        const len = L * (0.62 - i * 0.035)
        const ex = wx + Math.cos(fa) * len
        const ey = wy + Math.sin(fa) * len
        limbT(s, wx, wy, ex, ey, 5, 2, m)
        px(s, R(ex), R(ey), tip)
        px(s, R(ex - Math.cos(fa) * 2), R(ey - Math.sin(fa) * 2), tip === C.white ? C.steel3 : m[2])
    }
    // the coverts over the roots, in scalloped rows
    const c1x = wx + Math.cos(ta) * 7
    const c1y = wy + Math.sin(ta) * 7
    const c0x = sx + Math.cos(ta + 0.3) * 11
    const c0y = sy + Math.sin(ta + 0.3) * 11
    poly(s, [sx, sy, wx, wy, c1x, c1y, c0x, c0y], 0, 0, m[1])
    for (let r = 0; r < 3; r++) {
        for (let i = 0; i < 6; i++) {
            const u = (i + (r & 1) * 0.5) / 6
            const k = 2 + r * 3
            const qx = sx + (wx - sx) * u + Math.cos(ta) * k
            const qy = sy + (wy - sy) * u + Math.sin(ta) * k
            px(s, R(qx), R(qy), m[2]); px(s, R(qx + Math.cos(ta)), R(qy + Math.sin(ta)), m[0])
        }
    }
    // the leading edge, lit
    line(s, R(sx), R(sy), R(wx), R(wy), m[2], 2)
    line(s, R(wx), R(wy), R(wx + dx * L * 0.3), R(wy + dy * L * 0.3), m[2])
    // the thunderbird's mark: a zigzag of lightning down the wing
    let zx = sx + Math.cos(ta) * 4
    let zy = sy + Math.sin(ta) * 4
    const mark = flare > 0.5 ? C.white : flare > 0 ? C.cyan : C.blue2
    for (let i = 1; i <= 5; i++) {
        const u = i / 5
        const side = i & 1 ? 3 : -1
        const nx = sx + (wx + dx * L * 0.25 - sx) * u + Math.cos(ta) * (4 + side)
        const ny = sy + (wy + dy * L * 0.25 - sy) * u + Math.sin(ta) * (4 + side)
        line(s, R(zx), R(zy), R(nx), R(ny), mark)
        zx = nx
        zy = ny
    }
}

/** A roc's leg from the hip along `a`: a feathered thigh, a gold scaled shank, talons open by `open`. */
function rocLeg(s: Surface, hx: number, hy: number, a: number, open: number, far: boolean): void {
    const kx = hx + Math.cos(a) * 7
    const ky = hy + Math.sin(a) * 7
    limbT(s, hx, hy, kx, ky, 6, 4, far ? PLUME_FAR : PLUME)
    const fa = a - 0.3 + open * 0.2
    const fx = kx + Math.cos(fa) * 8
    const fy = ky + Math.sin(fa) * 8
    line(s, R(kx), R(ky), R(fx), R(fy), far ? C.gold0 : C.gold1, 2)
    for (let i = 1; i < 4; i++) px(s, R(kx + (fx - kx) * i / 4), R(ky + (fy - ky) * i / 4), far ? C.gold1 : C.gold2) // the scales
    // three talons forward and one back, curled at rest and flung open on the strike
    for (let i = -1; i <= 2; i++) {
        const ta = i === 2 ? fa + Math.PI * 0.9 : fa - 0.9 + i * (0.35 + open * 0.35) - (1 - open) * 0.6
        const tx = fx + Math.cos(ta) * 5
        const ty = fy + Math.sin(ta) * 5
        line(s, R(fx), R(fy), R(tx), R(ty), far ? C.gold0 : C.gold1, 2)
        const ca = ta + 0.9 * (1 - open * 0.5)
        line(s, R(tx), R(ty), R(tx + Math.cos(ca) * 3), R(ty + Math.sin(ca) * 3), C.ink)
    }
}

/**
 * Stormcrown Roc, the thunderbird of the broken sky: a vast eagle in storm-dark plumage, its wings
 * raised in a V with a zigzag of lightning down each, a pale barred breast, a white head with a
 * heavy brow over a burning gold eye and a great hooked beak, and on its head a gold circlet from
 * which its own lightning rises as a crown. It rears with its wings high, then beats down and
 * rakes the front rank with its talons as a bolt falls from the crown.
 */
export const STORMCROWN_ROC: CreatureDef = {
    name: 'Stormcrown Roc', size: 128, shadow: 20, hover: 1, accent: C.gold3,
    states: bossStates(1.1, 1.2, 1.8),
    draw(s, st, t) {
        drive(this, st, t, 12, 1.2)
        const beat = st === 'idle' || st === 'entry' ? Math.sin(q(t) / 1.2 * Math.PI * 2) : 0
        // the wings: raised in a V at rest, beating slowly; high on the wind-up, down on the strike
        const lift = st === 'death' ? -0.6 - B.die * 0.4 : st === 'attack' ? bz(0.55, 1, -1) : 0.55 + beat * 0.35
        const x = s.ax - 6 + B.lunge - B.kb + R(bz(0, -4, 6))
        const y = s.ay - 42 + R(bz(0, -4, 8)) - R(beat * 2) + R(B.die * 30)
        const a = -1.8 - (1 - lift) * 0.62
        const flare = B.glow
        // the far wing, behind everything
        rocWing(s, x + 2, y - 10, a + 0.45, 40, PLUME_FAR, C.night1, flare * 0.5)
        // the tail, a fan of long feathers barred pale at the tips
        for (let i = 0; i < 5; i++) {
            const ta = 2.55 - i * 0.12 + (st === 'attack' ? B.wind * 0.3 : 0)
            const ex = x - 13 + Math.cos(ta) * (18 + (i & 1) * 3)
            const ey = y + 4 + Math.sin(ta) * (18 + (i & 1) * 3)
            limbT(s, x - 13, y + 4, ex, ey, 5, 3, i & 1 ? PLUME : PLUME_FAR)
            px(s, R(ex), R(ey), C.steel3); px(s, R(ex) + 1, R(ey), C.white)
        }
        // the far leg
        const reachLeg = st === 'attack' ? bz(1.7, 2.3, 0.5) : 1.75 + B.die * 0.6
        const open = st === 'attack' ? (B.strike ? 1 : B.rec * 0.6) : 0
        rocLeg(s, x + 1, y + 7, reachLeg + 0.15, open, true)
        // the body: storm-dark plumage in scalloped rows, the breast pale and barred
        ball(s, x, y, 16, 11, PLUME)
        for (let r = 0; r < 4; r++) {
            for (let i = 0; i < 6; i++) {
                const fx = x - 12 + i * 4 + (r & 1) * 2
                const fy = y - 7 + r * 4
                if (Math.hypot((fx - x) / 15, (fy - y) / 10) < 1) { px(s, fx, fy, PLUME[2]); px(s, fx + 1, fy + 1, PLUME[0]) }
            }
        }
        ellipse(s, x + 7, y + 3, 9, 8, BREAST[1])
        ellipse(s, x + 5, y + 1, 5, 5, BREAST[2])
        for (let r = 0; r < 4; r++) for (let i = 0; i < 3; i++) {
            // the chevron bars across the breast
            const bx = x + 2 + i * 4 + (r & 1) * 2
            const by = y + r * 3
            px(s, bx, by, BREAST[0]); px(s, bx + 1, by + 1, BREAST[0]); px(s, bx + 2, by, BREAST[0])
        }
        // the near leg, the talons open and reaching on the strike
        rocLeg(s, x + 6, y + 8, reachLeg, open, false)
        // the neck: white hackles swept back over the shoulders
        const hx = x + 16 + R(bz(0, -2, 4))
        const hy = y - 13 + R(bz(0, -3, 4))
        for (let i = 0; i < 5; i++) {
            const nx0 = hx - 3 - i
            const ny0 = hy - 2 + i * 3
            tri(s, nx0, ny0, nx0 + 2, ny0 + 3, nx0 - 9 - i, ny0 + 5 + i, i & 1 ? HEAD_WHITE[0] : HEAD_WHITE[1])
        }
        // the head, white, lit above
        ball(s, hx, hy, 7, 6, HEAD_WHITE)
        // the beak: a great gold hook, the lower bill dropping open on the strike and the roar
        const gape = B.strike || B.roar ? 3 : 0
        poly(s, [4, 1, 10, 2 + gape, 5, 4 + gape], hx, hy, C.gold1)
        poly(s, [4, -3, 10, -2, 13, 0, 14, 3, 12, 5, 11, 2, 4, 2], hx, hy, C.gold2)
        line(s, hx + 5, hy - 3, hx + 11, hy - 2, C.gold3)
        line(s, hx + 12, hy + 5, hx + 14, hy + 3, C.gold0)
        rect(s, hx + 3, hy - 3, 2, 5, C.gold1) // the cere
        px(s, hx + 6, hy - 1, C.gold0) // the nostril
        if (gape) quad(s, hx + 5, hy + 2, hx + 10, hy + 2, hx + 9, hy + 2 + gape, hx + 5, hy + 3, C.ink)
        // the eye under a heavy brow
        line(s, hx - 2, hy - 4, hx + 4, hy - 2, C.steel1, 2)
        rect(s, hx + 1, hy - 2, 2, 2, B.hurt ? C.white : C.gold3)
        px(s, hx + 2, hy - 1, C.ink)
        if (flare > 0.3 && !B.hurt) ditherDisc(s, hx + 2, hy - 1, 3, C.gold2, R(flare * 6))
        // the crown: a gold circlet, its own lightning rising out of it in spikes
        line(s, hx - 6, hy - 5, hx + 2, hy - 6, C.gold1, 2)
        line(s, hx - 6, hy - 6, hx + 2, hy - 7, C.gold3)
        px(s, hx - 2, hy - 6, C.cyan) // a storm-glass set in it
        const k = fr(t, 10, 3)
        for (let i = 0; i < 5; i++) {
            const cx = hx - 6 + i * 2
            const cy = hy - 7
            const h = (i & 1 ? 6 : 9) + (flare > 0.3 ? 4 : 0) - (i === 0 || i === 4 ? 2 : 0)
            const j = (k + i) % 3 - 1
            line(s, cx, cy, cx + j, cy - (h >> 1), C.gold3)
            line(s, cx + j, cy - (h >> 1), cx - j, cy - h, flare > 0.3 || (k + i) % 3 === 0 ? C.white : C.gold2)
        }
        // the near wing
        rocWing(s, x + 2, y - 8, a, 46, PLUME, C.steel3, flare)
        finish(s, Entry.Drop, 0)
    },
    fx(dst, st, t, x, y, dir) {
        if (st !== 'death' && (fr(t, 10, 7) === 0 || B.roar)) {
            // a crackle leaping off the crown
            let lx = x + dir * 10
            for (let yy = y - 72; yy > y - 96; yy--) { if ((yy & 3) === 0) lx += dir * (((yy * 7) & 2) - 1); dst.set(lx, yy, (yy & 1) ? C.gold3 : C.white) }
        }
        if (st === 'attack' && B.strike) {
            // the bolt: out of the crown's storm onto the front rank, a flash where it lands
            const gx = x + dir * 44
            let lx = gx - dir * 6
            for (let yy = y - 100; yy <= y; yy++) {
                if ((yy & 3) === 0) lx += ((yy * 13) & 4) ? 2 : -2
                dst.set(lx, yy, C.white); dst.set(lx + 1, yy, C.white); dst.set(lx - 1, yy, C.gold3); dst.set(lx + 2, yy, C.cyan)
            }
            for (let i = 0; i < 10; i++) {
                const a = i / 10 * Math.PI
                dst.set(R(lx + Math.cos(a) * (5 + (i & 1) * 3)), R(y - Math.sin(a) * (3 + (i & 1) * 2)), i & 1 ? C.gold3 : C.white)
            }
        }
    }
}

const SKYSCALE: Mat = [C.teal0, C.teal1, C.teal2]
const MANE: readonly number[] = [C.white, C.frost, C.steel3]

/** Zephyrax's mouth this frame, sprite-local from the anchor: where the breath leaves from. */
const ZM = { x: 0, y: 0 }

/** Catmull-Rom through `pts` (x, y pairs), `per` samples a segment, into `out` as x, y pairs. */
function spline(pts: readonly number[], per: number, out: number[]): void {
    out.length = 0
    const n = pts.length / 2
    for (let i = 0; i < n - 1; i++) {
        const i0 = Math.max(0, i - 1)
        const i3 = Math.min(n - 1, i + 2)
        for (let k = 0; k < per; k++) {
            const u = k / per
            const u2 = u * u
            const u3 = u2 * u
            for (let c = 0; c < 2; c++) {
                const p0 = pts[i0 * 2 + c]!
                const p1 = pts[i * 2 + c]!
                const p2 = pts[(i + 1) * 2 + c]!
                const p3 = pts[i3 * 2 + c]!
                out.push(0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3))
            }
        }
    }
    out.push(pts[pts.length - 2]!, pts[pts.length - 1]!)
}
const SPINE: number[] = []

/** A storm cloud bank at (x, y): billows dark underneath and lit on top, lightning flickering in it on `flash`. */
function stormBank(s: Surface, x: number, y: number, w: number, seed: number, flash: boolean): void {
    for (let i = 0; i < 6; i++) {
        const bx = x - w / 2 + hash2(seed, i) * w
        const by = y + (hash2(seed + 1, i) - 0.5) * 8
        const r = 7 + hash2(seed + 2, i) * 6
        disc(s, bx, by, r, C.night1)
        disc(s, bx - 1, by - 1.5, r - 1.5, flash ? C.night3 : C.night2)
        arc(s, bx - 1, by - 1.5, r - 1.5, Math.PI * 1.1, Math.PI * 1.7, flash ? C.frost : C.night3)
        px(s, R(bx - r * 0.45), R(by - r * 0.8), flash ? C.white : C.haze)
    }
}

/**
 * Zephyrax, Breaker of Heavens: a sky-dragon of the old tales, too long for the stage, pouring out
 * of the storm. Its tail comes down out of the clouds behind, its body loops low over the island
 * with a hind claw gripping the grass, rises in a crest and runs down a long neck to the head held
 * low and forward. Teal scales lit along the back, a ribbed belly of gold and bone, a white mane
 * streaming off its back and head, gold antlers, long whiskers trailing from the snout, eyes lit
 * white. Its fore-claw holds the dragon's pearl, a globe of lightning. It rears back as the pearl
 * charges, then lunges and breathes a torrent of lightning and wind onto the front rank.
 */
export const ZEPHYRAX: CreatureDef = {
    name: 'Zephyrax, Breaker of Heavens', size: 256, shadow: 0, accent: C.cyan,
    states: bossStates(1.5, 2.0, 2.4),
    draw(s, st, t) {
        drive(this, st, t, 3, 2.0)
        // set back so the head, held low and forward, stays clear of the party
        const x = s.ax - 20 + B.lunge - B.kb
        const y = s.ay + R(B.die * 30)
        const ph = q(t) / 2.0 * Math.PI * 2
        const k = fr(t, 10, 9)
        const flash = k === 0 || B.roar
        // the head: rest, reared back on the wind-up, thrust forward on the strike
        const hdx = R(bz(0, -9, 8)) + R(B.die * -6)
        const hdy = R(bz(0, -10, 6)) + R(B.die * 14)
        // the storm behind it
        stormBank(s, x - 104, y - 98, 56, 911, flash)
        stormBank(s, x - 50, y - 108, 44, 912, false)
        // the spine: out of the clouds, down to a low loop, up to the crest and down the neck
        const base = [-116, -106, -104, -80, -92, -42, -74, -18, -52, -24, -38, -54, -22, -74, 0, -72, 12, -60, 20, -52]
        const pts: number[] = []
        for (let i = 0; i < base.length / 2; i++) {
            const w = i >= 8 ? (i - 7) / 2 : 0
            const sway = i > 0 && i < 8 ? Math.sin(ph + i * 0.9) * 3 : 0
            pts.push(x + base[i * 2]! + hdx * w, y + base[i * 2 + 1]! + R(sway) + hdy * w)
        }
        spline(pts, 8, SPINE)
        const n = SPINE.length / 2
        const radius = (u: number) => u < 0.55 ? 4 + 9 * (u / 0.55) : 13 - 4 * ((u - 0.55) / 0.45)
        const nrm = (i: number) => {
            const a = Math.max(0, i - 1)
            const b = Math.min(n - 1, i + 1)
            const tx = SPINE[b * 2]! - SPINE[a * 2]!
            const ty = SPINE[b * 2 + 1]! - SPINE[a * 2 + 1]!
            const L = Math.hypot(tx, ty) || 1
            return [tx / L, ty / L] as const
        }
        // the hind claw, gripping the island under the low loop
        const hi = Math.round(n * 0.36)
        const hx0 = SPINE[hi * 2]!
        const hy0 = SPINE[hi * 2 + 1]!
        limbT(s, hx0, hy0, hx0 + 6, y - 7, 5, 4, SKYSCALE)
        for (let i = 0; i < 3; i++) { line(s, hx0 + 6, y - 5, hx0 + 3 + i * 4, y - 1, C.gold1, 2); px(s, hx0 + 4 + i * 4, y, C.ink) }
        // the body, in passes: the dark of it, the lit scales, the ribbed belly, the mane
        for (let i = 0; i < n; i++) disc(s, SPINE[i * 2]!, SPINE[i * 2 + 1]!, radius(i / (n - 1)), SKYSCALE[0])
        for (let i = 0; i < n; i++) {
            const [tx, ty] = nrm(i)
            const r = radius(i / (n - 1))
            disc(s, SPINE[i * 2]! + ty * 0.8, SPINE[i * 2 + 1]! - tx * 0.8, Math.max(1, r - 1.5), SKYSCALE[1])
        }
        for (let i = 0; i < n; i++) {
            const [tx, ty] = nrm(i)
            const r = radius(i / (n - 1))
            const X = SPINE[i * 2]!
            const Y = SPINE[i * 2 + 1]!
            // the belly, on the inside of the curl
            if (r > 4) line(s, R(X - ty * (r - 3.5)), R(Y + tx * (r - 3.5)), R(X - ty * (r - 0.8)), R(Y + tx * (r - 0.8)), i % 3 === 0 ? C.gold1 : i % 3 === 1 ? C.bone1 : C.gold2)
            // the scales along the back, lit
            if (i % 3 === 0 && r > 3) {
                px(s, R(X + ty * r * 0.35), R(Y - tx * r * 0.35), SKYSCALE[2])
                px(s, R(X + ty * r * 0.65), R(Y - tx * r * 0.65), C.teal3)
            }
        }
        for (let i = 4; i < n - 2; i += 3) {
            // the mane streaming off the back, swept toward the tail and fluttering
            const [tx, ty] = nrm(i)
            const r = radius(i / (n - 1))
            const X = SPINE[i * 2]! + ty * (r - 1)
            const Y = SPINE[i * 2 + 1]! - tx * (r - 1)
            const len = 5 + (i % 2) * 2 + R(Math.sin(ph * 2 + i) * 1)
            tri(s, X - tx * 2, Y - ty * 2, X + tx * 2, Y + ty * 2, X + ty * len - tx * 5, Y - tx * len - ty * 5, MANE[(i / 3) % 3 | 0]!)
        }
        // mist rolling round the low loop, and the bank the tail pours out of
        for (let i = 0; i < 4; i++) ditherEllipse(s, x - 92 + i * 16, y - 5, 12, 4, C.haze, 3)
        stormBank(s, x - 116, y - 88, 40, 913, flash)
        // the fore-claw holding the dragon's pearl
        const fi = Math.round(n * 0.86)
        const sx0 = SPINE[fi * 2]!
        const sy0 = SPINE[fi * 2 + 1]! + 4
        const pgx = x + 10 + R(bz(0, -4, 6))
        const pgy = y - 24 + R(bz(0, -4, 2))
        elbow(sx0, sy0, pgx - 3, pgy - 5, 10, 10, -1)
        limbT(s, sx0, sy0, P.x, P.y, 5, 4, SKYSCALE)
        limbT(s, P.x, P.y, pgx - 3, pgy - 5, 4, 3, SKYSCALE)
        const charge = st === 'attack' ? Math.max(B.wind, B.strike ? 1 : 0) : 0
        if (charge > 0.2) ditherDisc(s, pgx, pgy, 9, C.cyan, R(charge * 7))
        disc(s, pgx, pgy, 5, C.blue1)
        disc(s, pgx - 0.5, pgy - 0.5, 4, charge > 0.5 ? C.frost : C.cyan)
        const sw = q(t) * 6
        arc(s, pgx, pgy, 3, sw, sw + 2.2, C.white)
        arc(s, pgx, pgy, 2, sw + 3, sw + 4.6, C.blue2)
        px(s, pgx - 2, pgy - 2, C.white)
        for (let i = 0; i < 3; i++) {
            // the claws closed round it
            const ca = -2.2 + i * 0.9
            line(s, R(pgx + Math.cos(ca) * 3), R(pgy + Math.sin(ca) * 3 - 2), R(pgx + Math.cos(ca) * 6), R(pgy + Math.sin(ca) * 6), C.gold1, 2)
            px(s, R(pgx + Math.cos(ca) * 6), R(pgy + Math.sin(ca) * 6), C.ink)
        }
        // the head, low and forward at the end of the neck
        const hx = SPINE[(n - 1) * 2]! + 6
        const hy = SPINE[(n - 1) * 2 + 1]! + 2
        const open = B.strike ? 6 : B.roar ? 5 : st === 'attack' ? R(B.rec * 4) : 0
        // the far antler, darker
        line(s, hx - 5, hy - 8, hx - 12, hy - 16, C.gold0, 2)
        line(s, hx - 12, hy - 16, hx - 19, hy - 19, C.gold0, 2)
        line(s, hx - 11, hy - 15, hx - 10, hy - 22, C.gold0)
        // the mane streaming back off the head and jaw
        for (let i = 0; i < 6; i++) {
            const my = hy - 6 + i * 3
            const fl = R(Math.sin(ph * 2 + i * 1.3) * 2)
            tri(s, hx - 4, my - 2, hx - 4, my + 2, hx - 20 - (i & 1) * 5, my - 4 + i + fl, MANE[i % 3]!)
        }
        // the lower jaw, dropping open, a row of teeth, the throat lit on the breath
        poly(s, [2, 3, 19, 4 + open, 18, 7 + open, 2, 8], hx, hy, SKYSCALE[0])
        line(s, hx + 3, hy + 7, hx + 17, hy + 6 + open, C.bone1) // the pale underjaw
        if (open) {
            quad(s, hx + 4, hy + 2, hx + 19, hy + 1, hx + 18, hy + 3 + open, hx + 4, hy + 4, B.strike ? C.frost : C.ink)
            for (let i = 0; i < 5; i++) { px(s, hx + 6 + i * 3, hy + 2, C.white); px(s, hx + 7 + i * 3, hy + 3 + open, C.white) }
        }
        // the skull and the long snout, lit along the top
        ellipse(s, hx, hy, 9, 7, SKYSCALE[0])
        ellipse(s, hx - 1, hy - 1, 8, 6, SKYSCALE[1])
        poly(s, [3, -6, 20, -3, 23, 0, 22, 3, 4, 3], hx, hy, SKYSCALE[1])
        line(s, hx + 3, hy - 6, hx + 20, hy - 3, SKYSCALE[2])
        line(s, hx - 5, hy - 6, hx + 2, hy - 7, SKYSCALE[2])
        px(s, hx + 21, hy - 1, C.teal3)
        rect(s, hx + 19, hy - 2, 2, 1, C.ink) // the nostril
        for (let i = 0; i < 4; i++) px(s, hx + 6 + i * 4, hy + 1, C.teal0) // the scales along the lip
        line(s, hx + 4, hy + 3, hx + 21, hy + 3, C.gold2) // the gold of the lip
        // the eye under a heavy brow, lit white
        line(s, hx - 1, hy - 7, hx + 9, hy - 5, SKYSCALE[0], 2)
        rect(s, hx + 3, hy - 4, 4, 2, C.ink)
        rect(s, hx + 4, hy - 4, 2, 1, B.hurt ? C.ink : C.white)
        px(s, hx + 6, hy - 4, B.hurt ? C.ink : C.cyan)
        if (B.glow > 0.3 && !B.hurt) ditherDisc(s, hx + 5, hy - 4, 4, C.cyan, R(B.glow * 6))
        // the near antler, gold, branching back
        line(s, hx - 3, hy - 7, hx - 10, hy - 15, C.gold1, 2)
        line(s, hx - 10, hy - 15, hx - 18, hy - 18, C.gold1, 2)
        line(s, hx - 3, hy - 8, hx - 10, hy - 16, C.gold3)
        line(s, hx - 9, hy - 14, hx - 8, hy - 22, C.gold1, 2)
        line(s, hx - 15, hy - 17, hx - 16, hy - 24, C.gold1, 2)
        px(s, hx - 8, hy - 23, C.gold3); px(s, hx - 16, hy - 25, C.gold3); px(s, hx - 19, hy - 18, C.gold3)
        // the whiskers, trailing back from the snout and waving
        for (const [wx, wy, lift] of [[18, 2, 1], [16, -3, -1]] as const) {
            let ox = hx + wx
            let oy = hy + wy
            for (let j = 1; j < 16; j++) {
                const nx = hx + wx - j * 2.3
                const ny = hy + wy + j * 0.5 * lift + Math.sin(ph * 2 + j * 0.45) * 2 + (lift > 0 ? j * 0.3 : -j * 0.2)
                line(s, R(ox), R(oy), R(nx), R(ny), j < 11 ? C.gold3 : C.gold2)
                ox = nx
                oy = ny
            }
        }
        ZM.x = hx + 20 - s.ax
        ZM.y = hy + 3 - s.ay
        finish(s, Entry.Drop, 0)
    },
    fx(dst, st, t, x, y, dir) {
        if (!(st === 'attack' && (B.strike || B.rec > 0.6)) && !B.roar) return
        // the breath: a torrent of wind and lightning from the jaws onto the front rank
        const mx = x + dir * ZM.x
        const my = y + ZM.y
        const gx = x + dir * 44
        const gy = y - 4
        const k = fr(t, 20, 4)
        for (let i = 0; i < 3; i++) {
            let lx = mx
            let ly = my
            for (let j = 1; j <= 10; j++) {
                const u = j / 10
                const nx = mx + (gx - mx) * u + (j < 10 ? (((j * 7 + i * 5 + k) % 5) - 2) * 2 : 0)
                const ny = my + (gy - my) * u + (i - 1) * 4 * u + (j < 10 ? (((j * 3 + i + k) % 3) - 1) * 2 : 0)
                let sx = lx
                let sy = ly
                const steps = Math.max(Math.abs(nx - lx), Math.abs(ny - ly))
                for (let m = 0; m <= steps; m++) {
                    sx = R(lx + (nx - lx) * m / steps)
                    sy = R(ly + (ny - ly) * m / steps)
                    dst.set(sx, sy, i === 1 ? C.white : C.cyan)
                    if (i === 1) dst.set(sx, sy + 1, C.frost)
                }
                lx = nx
                ly = ny
            }
        }
        for (let i = 0; i < 12; i++) {
            // the wind streaks and the burst where it lands
            const a = i / 12 * Math.PI
            dst.set(R(gx + Math.cos(a) * (6 + (i & 1) * 4)), R(gy + 4 - Math.sin(a) * (4 + (i % 3) * 2)), i & 1 ? C.white : C.cyan)
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

