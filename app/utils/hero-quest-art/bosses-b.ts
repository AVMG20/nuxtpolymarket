// World bosses and super bosses, Worlds 6–10 — the walk past the Void's door and out through
// the edge of the world. See bosses-a.ts for the shared conventions.

import { C } from './palette'
import type { BossSpecial, CreatureDef } from './creature'
import { CF, fr, sm, span } from './creature'
import type { Mat } from './weapons'
import {
    B, Entry, ENTRY_SETTLED, bossStates, withSpecial, spAttack, drive, finish, shift, bz, ball, tentacle, glowEye,
    limbT, elbow, P, rect, px, line, disc, ellipse, tri, quad, dither, ditherEllipse, ring, arc, poly, q, wv, bayer, hash2
} from './boss-kit'
import { Surface, ditherDisc, ellipseRing } from './surface'
import { blast, shockRing } from './vfx-cinematic'
import { rune as runeGlyph, RUNES, bolt as boltFx, star as starFx } from './vfx-kit'
import { sq, sp, chest, debris, spike, crack, pit, drain, BONE6, STORM6, VOID6 } from './special-kit'

const R = Math.round

const VIOLET: Mat = [C.purple0, C.purple1, C.purple2]
const STONE: Mat = [C.stone1, C.stone2, C.stone3]

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
/**
 * Grimoire Storm: the grimoires orbiting him all fly open at once and fire, rune after rune, each
 * curving in along its own path onto the party, the books spinning faster as the storm builds.
 */
const GRIMOIRE_STORM: BossSpecial = {
    name: 'Grimoire Storm', tint: 'night0', hits: [1.0, 1.16, 1.32, 1.48, 1.64, 1.8], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const cx = st.bx + 2 * -d
        const cy = st.by - 40
        const cols = [C.pink, C.cyan, C.gold3]
        for (let i = 0; i < 12; i++) {
            const p = st.party[i % st.party.length]!
            const t0 = 0.55 + i * 0.1
            const land = t0 + 0.4
            const u = (q - t0) / (land - t0)
            if (u < 0 || u > 1) continue
            // leaving from a book on the orbit, bowing up or down as it comes in
            const a = i * 2.1 + t0 * 4
            const x0 = cx + Math.cos(a) * 26
            const y0 = cy + Math.sin(a) * 6
            const bow = (i & 1 ? -1 : 1) * 22
            const x = x0 + (p.x - x0) * u
            const y = y0 + (chest(p) - y0) * u + Math.sin(u * Math.PI) * bow
            const c = cols[i % 3]!
            for (let k = 1; k < 5; k++) {
                const v = Math.max(0, u - k * 0.04)
                s.set(R(x0 + (p.x - x0) * v), R(y0 + (chest(p) - y0) * v + Math.sin(v * Math.PI) * bow), k < 3 ? c : C.purple1)
            }
            runeGlyph(s, R(x) - 2, R(y) - 2, RUNES[i % RUNES.length]!, c)
            s.set(R(x), R(y), C.white)
        }
        st.party.forEach((p, i) => {
            for (const k of [i, i + 6]) blast(s, p.x, chest(p), t, 0.95 + k * 0.1, 6, 0.4, VOID6, 301 + k, 'arcane')
        })
    }
}

export const MAGISTER_HALVANE: CreatureDef = {
    name: 'Magister Halvane', size: 96, shadow: 12, hover: 1, accent: C.pink,
    // for the tip of his hat, and the bolt he looses from his orb
    room: 20,
    states: withSpecial(bossStates(1.2, 1.8, 1.8), 2.4),
    special: GRIMOIRE_STORM,
    draw(s, st, t) {
        drive(this, st, t, 4, 1.8)
        // the books flung open and held open while the storm lasts
        if (st === 'special') spAttack(0.22, 0.28, 0.8, 2)
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
        // one turn per idle loop; the storm whips them round three times as fast
        const spin = (Math.PI * 2) / this.states.idle!.dur * (st === 'special' ? 3 : 1)
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
    rift(s, dx, floor, rise, open, 112, 34, d => voidDoor(d, dx, floor, t, glow))
}

/**
 * A door painted by `paint` coming and going as a rift, `H` tall and `W` wide each side of `dx`:
 * the line of light rising with `rise`, the door opening out of it with `open`.
 */
function rift(s: Surface, dx: number, floor: number, rise: number, open: number, H: number, W: number, paint: (d: Surface) => void): void {
    if (open > 0.02) {
        const d = scratch('door', s)
        paint(d)
        const half = W * open
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

const ITHREN_STATES = withSpecial({ ...bossStates(1.5, 2.0, 2.6), death: { dur: 2.4, loop: false } }, 2.9)

/** A beam of the Void from (x0, y0) to (x1, y1), `fade` 0..1 thinning it: violet edges, a white core. */
function voidBeam(s: Surface, x0: number, y0: number, x1: number, y1: number, fade: number): void {
    // outermost first, so the white core is drawn last and stays on top
    for (const w of [-4, 4, -3, 3, -2, 2, -1, 1, 0]) {
        if (Math.abs(w) > 4 * fade) continue
        const c = w === 0 ? C.white : Math.abs(w) === 1 ? C.frost : Math.abs(w) === 2 ? C.pink : Math.abs(w) === 3 ? C.purple2 : C.purple1
        line(s, R(x0) + w, R(y0), R(x1) + w, R(y1), c)
    }
}

/** A point `u` 0..1 along a row of the party, walked through its bodies in order: where a beam is aimed. */
const AIM = { x: 0, y: 0 }
function alongRow(row: readonly { readonly x: number, readonly y: number }[], u: number): void {
    const k = Math.max(0, Math.min(1, u)) * (row.length - 1)
    const a = row[Math.floor(k)]!
    const b = row[Math.min(row.length - 1, Math.floor(k) + 1)]!
    const f = k - Math.floor(k)
    AIM.x = a.x + (b.x - a.x) * f
    AIM.y = a.y - 8 + (b.y - a.y) * f
}

/**
 * Void Nova: he raises his hand and the Void pours in to a point over it, a black star swelling in
 * a ring of pink fire; then it collapses and bursts into two beams that sweep the party, one along
 * the front row and one along the back row the other way, crossing as they go.
 */
const VOID_NOVA: BossSpecial = {
    // each beam crosses the middle of its row halfway through; the hits follow the beams
    name: 'Void Nova', tint: 'purple0', hits: [1.3, 1.32, 1.85, 1.87, 2.4, 2.42], spread: true, order: [1, 5, 0, 3, 2, 4],
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const sx = st.bx + d * 20
        const sy = st.by - 92
        // the Void pouring in to it
        if (q < 1.15) for (let i = 0; i < 18; i++) {
            const u = ((q * 1.4 + i / 18) % 1)
            const a = i * 2.4
            const r = 40 * (1 - u)
            s.set(R(sx + Math.cos(a) * r), R(sy + Math.sin(a) * r * 0.7), u > 0.7 ? C.pink : i & 1 ? C.purple2 : C.purple1)
        }
        // the star swelling, then collapsing to a point as it fires
        // the star swelling into a portal, held open while the beams pour out of it, closing after
        const grow = sp(t, 0.2, 1.1)
        const close = sp(t, 2.5, 2.8)
        const r = (3 + 9 * grow - (q > 1.2 ? 2 : 0)) * (1 - close)
        if (r > 0.5) {
            ditherDisc(s, sx, sy, r + 4, C.purple1, 6)
            disc(s, sx, sy, r + 1, C.pink)
            disc(s, sx, sy, r, C.ink)
            // the Void turning inside it, and the rim burning
            const spin = q * (q > 1.2 ? 9 : 5)
            arc(s, sx, sy, r * 0.6, spin, spin + 2.4, C.purple2)
            arc(s, sx, sy, r * 0.35, -spin, -spin + 2, C.pink)
            px(s, sx, sy, C.white)
            for (let i = 0; i < 8; i++) { const a = spin + i * 0.8; px(s, R(sx + Math.cos(a) * (r + 2)), R(sy + Math.sin(a) * (r + 2)), i & 1 ? C.white : C.pink) }
        }
        shockRing(s, sx, sy, t, 1.2, 0.4, 2, 26, C.white)
        // the two beams: the front row swept from its far rank to its near one, the back row the other way
        if (q >= 1.22 && q < 2.6) {
            const byX = [...st.party].sort((a, b) => b.x - a.x)
            const front = byX.slice(0, 3).sort((a, b) => a.y - b.y)
            const back = byX.slice(3).sort((a, b) => b.y - a.y)
            const u = (q - 1.3) / 1.1
            const fade = Math.min(1, (2.6 - q) / 0.2)
            for (const [row, seed] of [[front, 0], [back, 20]] as const) {
                alongRow(row, u)
                voidBeam(s, sx, sy, AIM.x, AIM.y, fade)
                blast(s, AIM.x, AIM.y, t, Math.floor(q * 10) / 10, 7, 0.3, VOID6, 311 + seed + Math.floor(q * 10), 'arcane')
            }
        }
    }
}

export const ARCHMAGE_ITHREN: CreatureDef = {
    name: 'Archmage Ithren, the Door-Opener', size: 128, shadow: 18, hover: 1, accent: C.purple2,
    // for the beam of the Void he throws at the front rank
    room: 9,
    states: ITHREN_STATES,
    // broken apart as the door snaps shut behind him, not while it is pulling him in
    shatterAt: 1.87,
    special: VOID_NOVA,
    draw(s, st, t) {
        drive(this, st, t, 4, 2.0)
        // the hand raised while the star gathers, thrown forward as it fires
        if (st === 'special') spAttack(0.4, 0.45, 0.86, 3)
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
/**
 * Gravelord's Toll: he lifts the bone sword high, point down, and drives it deep into the earth;
 * soul-fire runs out through the ground from the blade, and spikes of bone burst up out of it under
 * every one of the party, then sink back.
 */
const GRAVELORDS_TOLL: BossSpecial = {
    name: 'Gravelord\'s Toll', tint: 'night0', hits: [1.2, 1.28, 1.36, 1.44, 1.52, 1.6], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const bx = st.bx + d * 24
        shockRing(s, bx, st.by - 1, t, 1.08, 0.5, 4, 30, C.green4, true)
        debris(s, bx, st.by - 2, st.by, t, 1.08, 12, 90, 'bone', 401)
        st.party.forEach((p, i) => {
            const t0 = 1.16 + i * 0.08
            crack(s, bx, st.by - 1, p.x, p.y - 1, sp(t, 1.08, t0), 411 + i, C.green2, C.green4)
            const rise = sp(t, t0, t0 + 0.1) * (1 - sp(t, 2.1, 2.5))
            if (rise <= 0) return
            pit(s, p.x, p.y, 8, C.ink, C.purple0)
            for (let k = 0; k < 5; k++) {
                // a cluster of bone spikes, the tallest in the middle, leaning out
                const off = (k - 2) * 4
                const h = R(rise * (22 - Math.abs(k - 2) * 5 + hash2(i, k) * 4))
                spike(s, p.x + off, p.y, h, 2, off * 0.5, C.bone0, C.bone1, C.white)
            }
            if (q < t0 + 0.3) debris(s, p.x, p.y - 2, p.y, t, t0, 8, 90, 'bone', 421 + i, 0.5)
            blast(s, p.x, chest(p), t, t0 + 0.04, 7, 0.45, BONE6, 431 + i, 'nature')
            for (let k = 0; k < 3; k++) {
                const u = ((q - t0) * 1.2 + k / 3) % 1
                s.set(R(p.x - 6 + k * 6), R(p.y - 4 - u * 16), u < 0.5 ? C.green4 : C.green2)
            }
        })
    }
}

/** Where Korr's grip is held on the thrust: lifted high in front of him, and driven down with the blade buried. */
const KORR_RAISED = { dx: 32, dy: 4 }
const KORR_DRIVEN = { dx: 24, dy: 34 }

/** Korr's sword on the thrust, `u` 0 → 1 through the special, into KS: lift point-down, drive, hold, pull free. */
function korrThrust(x: number, top: number, u: number): void {
    const down = Math.PI / 2
    const lerp = (ax: number, ay: number, bx: number, by: number, r: number) => { KS.gx = x + ax + (bx - ax) * r; KS.gy = top + ay + (by - ay) * r }
    if (u < 0.34) {
        const r = sm(u / 0.34)
        lerp(KORR_REST.dx, KORR_REST.dy, KORR_RAISED.dx, KORR_RAISED.dy, r)
        KS.a = KORR_REST.a + (down - KORR_REST.a) * r
    } else if (u < 0.42) {
        lerp(KORR_RAISED.dx, KORR_RAISED.dy, KORR_DRIVEN.dx, KORR_DRIVEN.dy, sm((u - 0.34) / 0.08))
        KS.a = down
    } else if (u < 0.78) {
        lerp(KORR_DRIVEN.dx, KORR_DRIVEN.dy, KORR_DRIVEN.dx, KORR_DRIVEN.dy, 0)
        KS.a = down
    } else {
        const r = sm((u - 0.78) / 0.22)
        lerp(KORR_DRIVEN.dx, KORR_DRIVEN.dy, KORR_REST.dx, KORR_REST.dy, r)
        KS.a = down + (KORR_REST.a - down) * r
    }
}

export const GRAVE_MARSHAL_KORR: CreatureDef = {
    name: 'Grave Marshal Korr', size: 128, shadow: 0, accent: C.green4,
    // for the swoop of the bone sword out in front of him
    room: 12,
    states: withSpecial(bossStates(1.2, 1.6, 2.0), 2.6),
    special: GRAVELORDS_TOLL,
    draw(s, st, t) {
        drive(this, st, t, 8, 1.6)
        if (st === 'special') spAttack(0.34, 0.42, 0.78, 2)
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
        const swinging = st === 'attack'
        const u = swinging ? q(t) / this.states.attack!.dur : 0
        let swoop = -1
        if (st === 'special') {
            // the special is a thrust, not the swing: point down, driven deep into the ground
            korrThrust(x, top, B.sp)
        } else if (swinging && u >= 0.4 && u < 0.6) {
            swoop = sm(Math.min(1, (u - 0.4) / 0.1))
            korrSwoop(x, top, swoop)
        } else if (swinging && u >= 0.6) {
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
        if (st === 'special') {
            // driven in: whatever of the blade is below the ground is buried, soul-fire where it went in
            for (let yy = y; yy < s.h; yy++) for (let xx = gx - 8; xx <= gx + 8; xx++) s.set(xx, yy, 0)
            if (gy + 46 > y) { line(s, gx - 4, y - 1, gx + 4, y - 1, C.green3); px(s, gx, y - 2, C.green4) }
        }
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
/** A small skull tumbling at (x, y), rolled by `a`. */
function tumblingSkull(s: Surface, x: number, y: number, a: number): void {
    disc(s, x, y, 2.5, C.bone1)
    px(s, R(x + Math.cos(a) * 1.2), R(y + Math.sin(a) * 1.2), C.ink)
    px(s, R(x + Math.cos(a + 1.2) * 1.2), R(y + Math.sin(a + 1.2) * 1.2), C.ink)
    px(s, R(x - 1), R(y - 2), C.white)
}

/**
 * Bone Tide: his jaw drops wide and the thousand dead pour out of it, a torrent of bones and skulls
 * spilling down onto the ground and rolling on across it over the party, soul-fire in among them.
 */
const BONE_TIDE: BossSpecial = {
    name: 'Bone Tide', tint: 'night0', hits: [1.3, 1.42, 1.54, 1.66, 1.78, 1.9], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const mx = st.bx + d * 42
        const my = st.by - 40
        const far = st.party[st.party.length - 1]!.x + d * 12
        // the flood itself: a pale band of bone and dust along the ground under the tumbling dead
        const head = mx + d * 6 + (far - mx - d * 6) * sp(t, 0.95, 1.95)
        const ebb = sp(t, 2.1, 2.6)
        if (q > 0.95 && ebb < 1) {
            const x0 = Math.min(mx, head)
            const x1 = Math.max(mx, head)
            for (const p of st.party) dither(s, R(x0), p.y - 5, R(x1 - x0), 6, C.bone0, R(10 * (1 - ebb)))
        }
        for (let i = 0; i < 130; i++) {
            const t0 = 0.75 + (i % 43) * 0.024 + Math.floor(i / 43) * 0.01
            const life = 1.3
            const u = (q - t0) / life
            if (u < 0 || u > 1) continue
            const lane = st.party[i % st.party.length]!.y - (i % 3)
            let x: number
            let y: number
            if (u < 0.2) {
                // pouring out of the jaw, down to the ground
                const v = u / 0.2
                x = mx + d * 6 * v
                y = my + (lane - my) * v * v
            } else {
                // rolling on across the ground, bouncing, out past the party
                const v = (u - 0.2) / 0.8
                x = mx + d * 6 + (far - mx - d * 6) * v + (hash2(i, 1) - 0.5) * 8
                y = lane - Math.abs(Math.sin(v * 9 + i)) * 4 * (1 - v)
            }
            if (i % 5 === 0) tumblingSkull(s, R(x), R(y), q * 9 + i)
            else {
                // a long bone, knobbed at both ends, turning as it tumbles
                const a = q * 6 + i
                const ex = Math.cos(a) * 3
                const ey = Math.sin(a) * 1.5
                line(s, R(x - ex), R(y - ey), R(x + ex), R(y + ey), i % 3 ? C.bone1 : C.bone0)
                s.set(R(x - ex), R(y - ey) - 1, C.white); s.set(R(x + ex), R(y + ey) - 1, C.bone1)
            }
            if (i % 7 === 0) s.set(R(x), R(y) - 3, C.green4)
        }
        st.party.forEach((p, i) => blast(s, p.x, chest(p) + 4, t, 1.3 + i * 0.12, 7, 0.45, BONE6, 441 + i, 'bone'))
    }
}

export const OSSUAR: CreatureDef = {
    name: 'Ossuar, the Thousand-Bone Host', size: 256, shadow: 0, accent: C.green4,
    // too big to rise out of the ground: his back already runs off into the dark as he comes into view
    scrollsIn: true,
    states: withSpecial(bossStates(1.5, 2.0, 2.6), 2.6),
    special: BONE_TIDE,
    draw(s, st, t) {
        // barely lunges: at his size a lunge only pushes the skull into the front rank
        drive(this, st, t, 2, 2.0)
        if (st === 'special') {
            // the jaw dropped wide as the dead pour out of it, the sockets burning
            B.roar = B.sp > 0.25 && B.sp < 0.85
            B.glow = B.roar ? 1 : 0
        }
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
        // at rest the hand lies well short of the front rank; the slam still lands on it
        const wxr = x + 72 + R(bz(0, 10, 44))
        const wyr = y - 16 + R(bz(0, -70, 2)) // the raised hand stays under the top of the camera
        elbow(nsx, nsy, wxr, wyr, 48, 52, B.wind > 0.3 ? -1 : 1)
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
 * roots in scalloped rows, a lit leading edge and, unless `bolt` is off, a zigzag of lightning
 * down its length that flares with `flare`.
 */
function rocWing(s: Surface, sx: number, sy: number, a: number, L: number, m: Mat, tip: number, flare: number, bolt = true): void {
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
    if (!bolt) return
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
/**
 * Thunderstrike Dive: the Roc beats its way up out of sight, the sky crackling where it went; then
 * it drops out of the storm in a column of lightning onto the front rank, talons first, and the
 * lightning arcs on from body to body through the party.
 */
const THUNDERSTRIKE_DIVE: BossSpecial = {
    name: 'Thunderstrike Dive', tint: 'night0', hits: [1.3, 1.36, 1.42, 1.48, 1.54, 1.6], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        // the middle of the party, where the column comes down
        const mx = st.party.reduce((a, p) => a + p.x, 0) / st.party.length
        const my = st.party.reduce((a, p) => a + p.y, 0) / st.party.length
        // the sky crackling while it is up there, out of sight
        if (q > 0.6 && q < 1.05 && (Math.floor(q * 12) & 1)) boltFx(s, mx + 30, 0, mx + 20, 30, t, 501, C.white, C.gold3, 5)
        // the column of lightning it drops in
        if (q > 1.05 && q < 1.4) {
            const x = mx + (1.3 - Math.min(1.3, q)) * 40
            for (let k = 0; k < 3; k++) boltFx(s, x + (k - 1) * 6, 0, mx + (k - 1) * 3, my - 4, t + k * 0.1, 511 + k, C.white, k === 1 ? C.gold3 : C.cyan, 6)
            dither(s, R(x) - 9, 0, 18, my, C.frost, q > 1.25 ? 6 : 3)
        }
        blast(s, mx, my - 8, t, 1.28, 16, 0.6, STORM6, 521, 'storm', true)
        shockRing(s, mx, my - 1, t, 1.28, 0.55, 6, 48, C.white, true)
        // the lightning arcing out from where it struck to every one of them
        st.party.forEach((p, i) => {
            const t0 = 1.3 + i * 0.06
            if (q > t0 - 0.06 && q < t0 + 0.12) boltFx(s, mx, my - 8, p.x, chest(p), t, 531 + i, C.white, C.cyan, 4)
            blast(s, p.x, chest(p), t, t0, 7, 0.4, STORM6, 541 + i, 'storm')
        })
    }
}

export const STORMCROWN_ROC: CreatureDef = {
    name: 'Stormcrown Roc', size: 160, shadow: 20, hover: 1, accent: C.gold3,
    // for the top of the bolt its special calls down
    room: 1,
    states: withSpecial(bossStates(1.1, 1.2, 1.8), 2.4),
    special: THUNDERSTRIKE_DIVE,
    draw(s, st, t) {
        drive(this, st, t, 12, 1.2)
        const beat = st === 'idle' || st === 'entry' ? Math.sin(q(t) / 1.2 * Math.PI * 2) : 0
        // the dive: beat up out of sight, drop out of the storm onto the front rank, climb back
        let spx = 0
        let spy = 0
        let spLift = 0
        if (st === 'special') {
            const u = B.sp
            B.wind = 0; B.strike = false; B.rec = 0
            if (u < 0.28) { spy = -sm(u / 0.28) * 130; spLift = Math.sin(q(t) * 22) * 0.9 } else if (u < 0.44) { spy = -200 } else if (u < 0.54) {
                const v = sm((u - 0.44) / 0.1)
                spx = 34 * v; spy = -130 + 156 * v; spLift = -1; B.strike = true; B.rec = 1
            } else if (u < 0.68) { spx = 34; spy = 26; spLift = 0.9; B.strike = true; B.rec = 1 } else {
                const v = sm((u - 0.68) / 0.32)
                spx = 34 * (1 - v); spy = 26 * (1 - v); spLift = 0.55 + Math.sin(q(t) * 12) * 0.4
            }
            B.glow = u > 0.44 && u < 0.68 ? 1 : 0.4
        }
        // the wings: raised in a V at rest, beating slowly; high on the wind-up, down on the strike
        const lift = st === 'death' ? -0.6 - B.die * 0.4 : st === 'special' ? spLift : st === 'attack' ? bz(0.55, 1, -1) : 0.55 + beat * 0.35
        const x = s.ax - 6 + B.lunge - B.kb + R(bz(0, -4, 6)) + R(spx)
        const y = s.ay - 42 + R(bz(0, -4, 8)) - R(beat * 2) + R(B.die * 30) + R(spy)
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
        const swinging = st === 'attack' || st === 'special'
        const reachLeg = swinging ? bz(1.7, 2.3, 0.5) : 1.75 + B.die * 0.6
        const open = swinging ? (B.strike ? 1 : B.rec * 0.6) : 0
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
/** And the tip of his near antler, where the special's bolt climbs out of. */
const ZH = { x: 0, y: 0 }

/**
 * Break the Heavens: he rears back, lightning gathering and crackling in his antlers; a bolt climbs
 * out of them into the sky and the storm closes overhead; then the heavens break and lightning
 * rains down on each of the party.
 */
const BREAK_THE_HEAVENS: BossSpecial = {
    name: 'Break the Heavens', tint: 'night0', hits: [1.2, 1.34, 1.48, 1.62, 1.76, 1.9], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const px0 = st.bx + d * ZH.x
        const py0 = st.by + ZH.y
        // the storm closing overhead
        const dark = sp(t, 0.3, 0.9) * (1 - sp(t, 2.2, 2.6))
        if (dark > 0) dither(s, 0, 0, s.w, 34, C.night0, R(dark * 10))
        // the bolt climbing out of the antlers into the sky
        if (q > 0.35 && q < 1.1) boltFx(s, px0, py0, px0 + d * 10, 0, t, 601, C.white, C.cyan, 5)
        // the strikes, one onto each of them, with stray ones between
        st.party.forEach((p, i) => {
            const t0 = 1.2 + i * 0.14
            if (q > t0 - 0.06 && q < t0 + 0.1) {
                boltFx(s, p.x + 8 - i * 3, 0, p.x, chest(p), t, 611 + i, C.white, C.cyan, 6)
                boltFx(s, p.x + 8 - i * 3, 0, p.x - 1, chest(p), t + 0.05, 621 + i, C.frost, C.blue2, 7)
            }
            blast(s, p.x, chest(p), t, t0, 9, 0.5, STORM6, 631 + i, 'storm')
            if (q > t0) pit(s, p.x, p.y, 5 * (1 - sp(t, 2.2, 2.6)), C.stone0, C.stone1)
        })
        for (let k = 0; k < 4; k++) {
            const t0 = 1.27 + k * 0.2
            const x = st.party[0]!.x - 20 + k * 22
            if (q > t0 && q < t0 + 0.08) boltFx(s, x + 6, 0, x, st.party[0]!.y, t, 641 + k, C.frost, C.blue2, 6)
        }
    }
}

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
 * white. It rears back as lightning gathers and crackles in its antlers, then lunges and breathes a
 * torrent of lightning and wind onto the front rank.
 */
export const ZEPHYRAX: CreatureDef = {
    name: 'Zephyrax, Breaker of Heavens', size: 256, shadow: 0, accent: C.cyan,
    states: withSpecial(bossStates(1.5, 2.0, 2.4), 2.6),
    special: BREAK_THE_HEAVENS,
    draw(s, st, t) {
        drive(this, st, t, 3, 2.0)
        // the head reared back while the lightning gathers in the antlers
        if (st === 'special') spAttack(0.42, 0.48, 0.82, 2)
        const raise = st === 'special' ? sm(Math.min(1, Math.max(0, (B.sp - 0.05) / 0.3))) * (1 - sm(Math.min(1, Math.max(0, (B.sp - 0.85) / 0.15)))) : 0
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
        // lightning gathers in the antlers as he charges, for the breath and for the special
        const charge = st === 'attack' || st === 'special' ? Math.max(B.wind, B.strike ? 1 : 0, raise) : 0
        // the head, low and forward at the end of the neck
        const hx = SPINE[(n - 1) * 2]! + 6
        const hy = SPINE[(n - 1) * 2 + 1]! + 2
        const open = B.strike ? 6 : B.roar ? 5 : st === 'attack' ? R(B.rec * 4) : 0
        // the far antler, darker, lit blue while he charges
        const lit = charge > 0.3
        const farC = lit ? C.blue2 : C.gold0
        line(s, hx - 5, hy - 8, hx - 12, hy - 16, farC, 2)
        line(s, hx - 12, hy - 16, hx - 19, hy - 19, farC, 2)
        line(s, hx - 11, hy - 15, hx - 10, hy - 22, farC)
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
        // the near antler, gold, branching back; charging, it burns with lightning, sparks jumping its tines
        if (lit) ditherDisc(s, hx - 11, hy - 17, 12, C.cyan, R(charge * 6))
        const flick = fr(t, 20, 2) === 1
        const beam = lit ? (flick ? C.white : C.cyan) : C.gold1
        const edge = lit ? C.white : C.gold3
        line(s, hx - 3, hy - 7, hx - 10, hy - 15, beam, 2)
        line(s, hx - 10, hy - 15, hx - 18, hy - 18, beam, 2)
        line(s, hx - 3, hy - 8, hx - 10, hy - 16, lit ? C.frost : C.gold3)
        line(s, hx - 9, hy - 14, hx - 8, hy - 22, beam, 2)
        line(s, hx - 15, hy - 17, hx - 16, hy - 24, beam, 2)
        px(s, hx - 8, hy - 23, edge); px(s, hx - 16, hy - 25, edge); px(s, hx - 19, hy - 18, edge)
        if (lit) {
            // sparks jumping between the tines
            const k = fr(t, 20, 3)
            const tips = [[-8, -23], [-16, -25], [-19, -18]] as const
            const [ax, ay] = tips[k]!
            const [bx2, by2] = tips[(k + 1) % 3]!
            line(s, hx + ax, hy + ay - 2, R(hx + (ax + bx2) / 2), hy + Math.min(ay, by2) - 5, C.white)
            line(s, R(hx + (ax + bx2) / 2), hy + Math.min(ay, by2) - 5, hx + bx2, hy + by2 - 2, C.frost)
        }
        ZH.x = hx - 16 - s.ax
        ZH.y = hy - 25 - s.ay
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

// Stage 5: Sister Vesper, the Forgotten, who kept the last light at the edge of the world until no
// one remembered her. Stage 10: Liminus, the Last Door: the door Ithren opened, come alive.

const HABIT: Mat = [C.steel0, C.steel1, C.steel2]
const PORCELAIN: Mat = [C.steel2, C.steel3, C.white]
const SCAPULAR: Mat = [C.blue0, C.blue1, C.blue2]

/**
 * Sister Vesper, the Forgotten: a nun floating at the edge of the world, her face worn smooth as
 * porcelain by being forgotten, silver tears down it, a cracked halo behind her head with pieces
 * drifting off it. A white wimple, a black veil streaming back, a cold grey habit with a dark
 * scapular, its hem coming undone into threads with the stars showing through the holes. One hand
 * at her breast on a rosary, the other holding out a lantern of cold white light. She lifts the
 * lantern, her eyes open, and she swings it at the party, loosing a wave of its light.
 */
/** Vesper's lantern this frame, sprite-local from the anchor. */
const VL9 = { x: 0, y: 0 }

/**
 * Vigil of the Forgotten: she lifts the lantern high and its cold light spreads out over the party;
 * where it falls, their colour drains out of them as they are forgotten, and pale threads come
 * unwound from her hem and wind round each of them, binding them.
 */
const VIGIL_OF_THE_FORGOTTEN: BossSpecial = {
    name: 'Vigil of the Forgotten', tint: 'night0', hits: [1.3, 1.42, 1.54, 1.66, 1.78, 1.9], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const lx = st.bx + d * VL9.x
        const ly = st.by + VL9.y
        // the light spreading from the lantern
        const u = sp(t, 0.6, 1.4)
        const fade = 1 - sp(t, 2.1, 2.5)
        if (u > 0 && fade > 0) {
            for (let r = 0; r < 2; r++) shockRing(s, lx, ly, t, 0.6 + r * 0.3, 0.8, 4, 60, r ? C.steel3 : C.frost)
            ditherDisc(s, lx, ly, 6 + u * 12, C.frost, R(4 * fade))
        }
        st.party.forEach((p, i) => {
            const t0 = 1.2 + i * 0.12
            // their colour draining out as the light reaches them, coming back as it fades
            drain(s, p.x - 12, p.y - 36, 24, 38, R(sp(t, t0 - 0.15, t0 + 0.2) * 16 * fade))
            // the threads winding round them, back to her
            const wind = sp(t, t0, t0 + 0.4) * fade
            if (wind > 0) {
                for (let k = 0; k < 24 * wind; k++) {
                    const a = k * 0.9 + q * 3
                    s.set(R(p.x + Math.cos(a) * 7), R(p.y - 4 - k * 1.1 + Math.sin(a) * 1.5), Math.sin(a) > 0 ? C.bone1 : C.steel3)
                }
                for (let k = 0; k < 12; k++) {
                    const v = k / 12
                    if (hash2(i, k) < wind) s.set(R(p.x + (lx - p.x) * v), R(p.y - 20 + (ly - p.y + 20) * v + Math.sin(v * Math.PI) * 8), C.steel3)
                }
            }
            blast(s, p.x, chest(p), t, t0, 6, 0.45, STORM6, 701 + i, 'frost')
        })
    }
}

export const SISTER_VESPER: CreatureDef = {
    name: 'Sister Vesper, the Forgotten', size: 96, shadow: 10, hover: 1, accent: C.frost,
    states: withSpecial(bossStates(1.2, 2.0, 2.0), 2.6),
    special: VIGIL_OF_THE_FORGOTTEN,
    draw(s, st, t) {
        drive(this, st, t, 6, 2.0)
        // the lantern lifted high and held while its light spreads, the eyes opening
        if (st === 'special') spAttack(0.3, 0.36, 0.8, 3)
        const x = s.ax - 4 + B.lunge - B.kb
        const y = s.ay
        const hover = -12 + wv(t, 2.0, 2) + R(B.die * 12)
        const top = y - 62 + hover
        const ph = q(t) / 2.0 * Math.PI * 2
        const flut = R(Math.sin(ph * 2) * 1.5)
        const hx = x + 3
        const hy = top + 9
        // the cracked halo, pieces of it drifting off
        for (let a = 0; a < Math.PI * 2; a += 0.08) {
            if ((a > 0.5 && a < 0.9) || (a > 3.6 && a < 4.1)) continue
            px(s, R(hx - 2 + Math.cos(a) * 11), R(hy - 2 + Math.sin(a) * 11), a > 1 && a < 2.6 ? C.steel3 : C.frost)
        }
        for (let i = 0; i < 3; i++) {
            const k = (q(t) * 0.5 + i / 3) % 1
            px(s, R(hx + 6 + k * 6), R(hy - 10 - k * 8 - i), k < 0.6 ? C.frost : C.steel3)
        }
        // the black veil streaming back off her head, torn at its end
        poly(s, [-5, -8, -2, 4, -8, 30, -18, 34 + flut, -22, 20 + flut, -14, 2], hx, hy, C.night0)
        poly(s, [-5, -8, -8, -4, -16, 8 + flut, -12, 0], hx, hy, C.void)
        line(s, hx - 5, hy - 8, hx - 14, hy + 2, C.steel1) // the lit rim
        line(s, hx - 14, hy + 2, hx - 22, hy + 20 + flut, C.steel1)
        for (let i = 0; i < 3; i++) tri(s, hx - 18 + i * 4, hy + 32 + flut, hx - 15 + i * 4, hy + 32 + flut, hx - 18 + i * 3, hy + 38 + flut + (i & 1) * 2, C.night0)
        // the habit: a long bell from the shoulders, folds lit on the left with a sheen down them
        const hy0 = top + 16
        poly(s, [-8, 0, 8, 0, 12, 40, -14, 40], x, hy0, HABIT[1])
        poly(s, [-8, 0, -4, 0, -8, 40, -14, 40], x, hy0, HABIT[0])
        for (const [fx, c] of [[-6, HABIT[2]], [5, HABIT[0]], [9, HABIT[2]]] as const) line(s, x + fx, top + 20, x + fx + (fx < 0 ? -3 : 2), top + 55, c)
        dither(s, x - 7, top + 22, 3, 28, C.steel3, 3)
        // the hem band: gold lines and a run of embroidered diamonds between them
        line(s, x - 14, top + 50, x + 12, top + 50, C.gold1)
        line(s, x - 14, top + 54, x + 12, top + 54, C.gold1)
        for (let i = 0; i < 7; i++) {
            const bx = x - 12 + i * 4
            px(s, bx, top + 51, C.gold2); px(s, bx - 1, top + 52, C.gold2); px(s, bx + 1, top + 52, C.gold3); px(s, bx, top + 53, C.gold2)
            px(s, bx + 2, top + 52, C.steel3)
        }
        // the scapular, deep blue edged in gold, a lantern-star embroidered on it and stars below
        poly(s, [-1, 0, 5, 0, 6, 34, -3, 34], x, hy0, SCAPULAR[0])
        line(s, x + 4, hy0, x + 5, top + 50, SCAPULAR[1])
        line(s, x - 1, hy0, x - 3, top + 50, C.gold1)
        line(s, x + 5, hy0, x + 6, top + 50, C.gold1)
        line(s, x - 3, top + 50, x + 6, top + 50, C.gold2)
        const sgx = x + 2
        const sgy = top + 36
        const tw = fr(t, 4, 2)
        line(s, sgx, sgy - 3, sgx, sgy + 3, C.gold2); line(s, sgx - 3, sgy, sgx + 3, sgy, C.gold2)
        px(s, sgx - 1, sgy - 1, C.gold1); px(s, sgx + 1, sgy - 1, C.gold1); px(s, sgx - 1, sgy + 1, C.gold1); px(s, sgx + 1, sgy + 1, C.gold1)
        px(s, sgx, sgy, tw ? C.white : C.frost)
        for (const [ox, oy] of [[0, 42], [3, 45], [1, 47]] as const) px(s, x + ox, top + oy, C.steel3)
        // the hem coming undone: holes with the stars in them, threads drawn off it
        for (const [ox, oy, w, h] of [[-9, 32, 5, 4], [2, 35, 4, 5], [-2, 27, 3, 3]] as const) {
            ellipse(s, x + ox + w / 2, top + 16 + oy + h / 2, w / 2 + 0.5, h / 2, C.ink)
            voidFill(s, x + ox, top + 16 + oy, w, h, t, 17)
        }
        // the cincture, knotted at the hip, its cord hanging and swaying, a silver tassel on it
        line(s, x - 10, top + 31, x + 9, top + 31, C.gold1)
        line(s, x - 10, top + 30, x + 9, top + 30, C.gold2)
        const cs = R(Math.sin(ph) * 1)
        disc(s, x + 7, top + 31, 1.5, C.gold2)
        line(s, x + 7, top + 32, x + 8 + cs, top + 41, C.gold1)
        rect(s, x + 7 + cs, top + 41, 3, 3, C.steel3); px(s, x + 8 + cs, top + 44, C.steel2)
        for (let i = 0; i < 13; i++) {
            const tx = x - 14 + i * 2
            const len = 3 + ((i * 7) % 7) + fr(t, 3, 2)
            line(s, tx, top + 56, tx - 2 - (i & 1), top + 56 + len, i % 3 ? HABIT[1] : C.bone0)
        }
        for (let i = 0; i < 4; i++) {
            const k = (q(t) * 0.7 + i / 4) % 1
            line(s, x - 12 + i * 6 - R(k * 8), top + 54 - R(k * 14), x - 14 + i * 6 - R(k * 10), top + 52 - R(k * 18), i & 1 ? C.bone1 : C.steel3)
        }
        // the far hand at her breast on the rosary, a wide sleeve
        limbT(s, x - 5, top + 18, x, top + 27, 5, 5, HABIT)
        ellipse(s, x + 1, top + 27, 2, 1.5, PORCELAIN[1])
        for (let i = 0; i < 6; i++) px(s, x - 3 + i, top + 24 + (i === 2 || i === 3 ? 1 : 0), C.bone1)
        line(s, x + 1, top + 28, x + 1, top + 32, C.bone0); px(s, x, top + 30, C.bone0); px(s, x + 2, top + 30, C.bone0) // the cross
        // the capelet over her shoulders, blue edged in gold, a frost stone at its clasp
        poly(s, [-10, 0, 9, 0, 11, 7, 6, 9, 0, 8, -6, 9, -12, 7], x, top + 14, SCAPULAR[1])
        poly(s, [-10, 0, -4, 0, -6, 9, -12, 7], x, top + 14, SCAPULAR[0])
        line(s, x - 12, top + 21, x - 6, top + 23, C.gold2); line(s, x - 6, top + 23, x, top + 22, C.gold2); line(s, x, top + 22, x + 6, top + 23, C.gold2); line(s, x + 6, top + 23, x + 11, top + 21, C.gold2)
        line(s, x - 8, top + 15, x + 6, top + 15, SCAPULAR[2])
        disc(s, x + 3, top + 17, 1.5, C.gold1); px(s, x + 3, top + 17, C.frost)
        // the wimple and the face, worn smooth
        ellipse(s, hx - 1, hy + 1, 7, 8, C.white)
        ellipse(s, hx - 2, hy + 2, 6, 7, C.steel3)
        rect(s, hx - 6, hy + 6, 12, 5, C.white) // the wimple under the chin
        line(s, hx - 6, hy + 10, hx + 5, hy + 10, C.steel3)
        line(s, hx - 6, hy - 6, hx + 4, hy - 7, C.white) // the band across the brow
        ellipse(s, hx + 1, hy + 1, 3.5, 4.5, PORCELAIN[1])
        line(s, hx + 3, hy - 3, hx + 4, hy + 2, PORCELAIN[2])
        line(s, hx - 2, hy + 2, hx - 1, hy + 4, PORCELAIN[1]) // the shade of the cheek
        px(s, hx + 5, hy + 1, PORCELAIN[1]) // the nose
        const open = B.strike || B.roar || B.wind > 0.5
        if (open && !B.hurt) {
            // the eyes open, burning cold, and the mouth with them
            ditherDisc(s, hx + 2, hy, 3, C.frost, 3 + R(B.glow * 4))
            px(s, hx + 1, hy, C.white); px(s, hx + 4, hy, C.frost)
            rect(s, hx + 2, hy + 3, 2, 2 + (B.strike || B.roar ? 1 : 0), C.ink)
        } else {
            line(s, hx, hy, hx + 1, hy, PORCELAIN[0]); px(s, hx + 4, hy, PORCELAIN[0]) // the closed lids, barely there
            line(s, hx - 1, hy - 2, hx + 1, hy - 2, PORCELAIN[1]) // the brow
        }
        line(s, hx + 1, hy + 1, hx + 1, hy + 4, C.steel3) // the silver tear
        // the veil over the head
        poly(s, [-7, -4, -3, -9, 3, -9, 6, -6, 5, -4, -1, -6, -6, -1], hx, hy, C.night0)
        line(s, hx - 3, hy - 9, hx + 3, hy - 9, C.steel1)
        // the near arm and the lantern, swinging on its chain: held out, lifted, swung at the party
        const sx = x + 6
        const sy = top + 18
        const swing = st === 'idle' || st === 'entry' ? Math.sin(ph) * 0.15 : 0
        const lx = sx + R(st === 'special' ? bz(9, 2, 6) : bz(9, 2, 18))
        const ly = sy + R(st === 'special' ? bz(6, -14, -16) : bz(6, -14, 2))
        limbT(s, sx, sy, lx, ly, 5, 4, HABIT)
        VL9.x = lx - s.ax
        VL9.y = ly + 11 - s.ay
        line(s, R(sx + (lx - sx) * 0.8), R(sy + (ly - sy) * 0.8) - 2, R(sx + (lx - sx) * 0.8), R(sy + (ly - sy) * 0.8) + 2, C.gold2) // the gold cuff
        ellipse(s, lx, ly, 1.5, 1.5, PORCELAIN[1])
        const cx = lx + R(Math.sin(swing) * 6)
        const cy = ly + 6
        line(s, lx, ly, cx, cy, C.steel2)
        const lit = B.glow > 0.3 || fr(t, 5, 3) > 0
        ditherDisc(s, cx, cy + 6, 8 + R(B.glow * 4), C.frost, lit ? 4 + R(B.glow * 5) : 2)
        tri(s, cx - 3, cy + 1, cx + 3, cy + 1, cx, cy - 1, C.steel1) // the cap
        rect(s, cx - 3, cy + 1, 7, 9, C.steel0)
        rect(s, cx - 2, cy + 2, 5, 7, lit ? C.frost : C.cyan)
        line(s, cx, cy + 2, cx, cy + 8, C.steel0) // the frame
        px(s, cx - 1, cy + 6, C.white); px(s, cx + 1, cy + 5, C.white)
        rect(s, cx - 3, cy + 10, 7, 1, C.steel1)
        finish(s, Entry.Fade)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 16)
        for (let i = 0; i < 4; i++) dst.set(x - dir * (6 + ((i * 7 + k) % 16)), y - 12 - ((k * 3 + i * 11) % 40), i & 1 ? C.steel3 : C.bone1) // threads drifting off
        if ((st === 'attack' && B.strike) || B.roar) {
            // a wave of the lantern's cold light rolling at the party
            for (let r = 6; r < 34; r += 7) for (let a = -0.7; a <= 0.7; a += 0.12) {
                dst.set(x + dir * R(20 + Math.cos(a) * r), y - 38 + R(Math.sin(a) * r), r % 2 ? C.frost : C.white)
            }
        }
    }
}

// ── Liminus ──

/** Where Liminus's near hand is this frame and how it lies, set by `liminusBody` for `fx`. */
const LH = { x: 0, y: 0 }

/** One carved block of the door, its top-left at (x, y): lit on its top and left, shaded right and below. */
function block(s: Surface, x: number, y: number, w: number, h: number, rune: number): void {
    rect(s, x, y, w, h, STONE[1])
    line(s, x, y, x + w - 1, y, STONE[2])
    line(s, x, y, x, y + h - 1, STONE[2])
    line(s, x + w - 1, y + 1, x + w - 1, y + h - 1, STONE[0])
    line(s, x + 1, y + h - 1, x + w - 1, y + h - 1, STONE[0])
    if (rune) {
        const cx = x + (w >> 1)
        const cy = y + (h >> 1)
        px(s, cx, cy - 1, rune); px(s, cx - 1, cy, rune); px(s, cx + 1, cy, rune); px(s, cx, cy + 1, rune)
    }
}

/**
 * A hand of the door's stone floating free, the palm at (cx, cy), the fingers along `a`: a palm
 * block with a rune, four fingers of three knuckled stones each, curled by `curl` toward the palm,
 * and a thumb. `dim` shades it as the far one.
 */
function stoneHand(s: Surface, cx: number, cy: number, a: number, curl: number, spread: number, dim: boolean, rune: number): void {
    const z = 1.8
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const nx = -dy
    const ny = dx
    const m: Mat = dim ? [C.void, C.stone0, C.stone1] : STONE
    quad(s, cx - dx * 4 * z - nx * 5 * z, cy - dy * 4 * z - ny * 5 * z, cx + dx * 4 * z - nx * 5 * z, cy + dy * 4 * z - ny * 5 * z, cx + dx * 4 * z + nx * 5 * z, cy + dy * 4 * z + ny * 5 * z, cx - dx * 4 * z + nx * 5 * z, cy - dy * 4 * z + ny * 5 * z, m[1])
    line(s, R(cx - dx * 4 * z - nx * 5 * z), R(cy - dy * 4 * z - ny * 5 * z), R(cx + dx * 4 * z - nx * 5 * z), R(cy + dy * 4 * z - ny * 5 * z), m[2])
    line(s, R(cx - dx * 4 * z + nx * 5 * z), R(cy - dy * 4 * z + ny * 5 * z), R(cx + dx * 4 * z + nx * 5 * z), R(cy + dy * 4 * z + ny * 5 * z), m[0])
    if (rune) { px(s, R(cx), R(cy), rune); px(s, R(cx + nx), R(cy + ny), rune); px(s, R(cx - dx), R(cy - dy), rune) }
    for (let i = 0; i < 4; i++) {
        let fx = cx + dx * 4 * z + nx * (i - 1.5) * (2.8 + spread) * z
        let fy = cy + dy * 4 * z + ny * (i - 1.5) * (2.8 + spread) * z
        let fa = a + (i - 1.5) * spread * 0.2
        for (let j = 0; j < 3; j++) {
            // a finger of three stones, tapering, a dark seam at each knuckle
            const len = (i === 0 || i === 3 ? 2.6 : 3.2) * z
            const ex = fx + Math.cos(fa) * len
            const ey = fy + Math.sin(fa) * len
            limbT(s, fx, fy, ex, ey, 3.4 - j * 0.4, 3 - j * 0.4, m)
            px(s, R(ex), R(ey), m[0])
            fx = ex + Math.cos(fa) * 0.6
            fy = ey + Math.sin(fa) * 0.6
            fa += curl * 0.7
        }
    }
    const ta = a + 1.2
    const tx = cx - nx * 5 * z + Math.cos(ta) * 4 * z
    const ty = cy - ny * 5 * z + Math.sin(ta) * 4 * z
    // the thumb, two stones out from the side of the palm
    limbT(s, cx - nx * 4 * z, cy - ny * 4 * z, tx, ty, 3.6, 3.2, m)
    limbT(s, tx, ty, tx + Math.cos(ta + curl) * 3 * z, ty + Math.sin(ta + curl) * 3 * z, 3.2, 2.6, m)
}

/**
 * Liminus whole, sill on `y` and centred on `dx`: the door's arch of carved blocks floating a
 * little apart as the world lets go of them, runes pulsing up the pillars, the keystone an eye that
 * looks about and opens wide on the attack, the Void wheeling inside; its two hands floating at its
 * sides. `lift` 0..1 sets the blocks drifting up and apart as it dies.
 */
function liminusBody(s: Surface, st: string, dx: number, y: number, t: number, lift: number): void {
    const ph = q(t) / 2.0 * Math.PI * 2
    const dw = 30
    const archY = y - 74
    const drift = (i: number) => R(Math.sin(ph + i * 1.3) * 1 - lift * (6 + (i * 7) % 11) * (1 + i * 0.1))
    const spin = st === 'attack' ? 1.4 + B.glow * 3 : 1.4
    // the inside: the dark, the stars, the three-armed vortex round a glowing heart
    ellipse(s, dx, archY, dw, 16, C.ink)
    rect(s, dx - dw, archY, dw * 2 + 1, y - archY - 2, C.ink)
    voidFill(s, dx - dw, archY - 16, dw * 2 + 1, y - archY + 14, t, 23)
    const heartY = archY + 26
    for (let arm = 0; arm < 3; arm++) {
        for (let k = 0; k < 26; k++) {
            const r = k * (dw / 26) * 1.1 * (1 - lift)
            const a = q(t) * spin + arm * (Math.PI * 2 / 3) + k * 0.22
            const vx = dx + Math.cos(a) * r
            const vy = heartY + Math.sin(a) * r * 1.4
            if (Math.abs(vx - dx) > dw || vy < archY - 12) continue
            const c = k < 6 ? C.pink : k & 1 ? C.purple2 : C.purple1
            px(s, vx, vy, c); px(s, vx + 1, vy, c)
        }
    }
    ditherDisc(s, dx, heartY, 5 + R(B.glow * 5), C.pink, 5 + R(B.glow * 6))
    disc(s, dx, heartY, 2 + R(B.glow), C.white)
    // the pillars, block on block, a little apart and bobbing, a rune on every other one pulsing up
    const pulse = fr(t, 4, 4)
    for (const side of [-1, 1]) {
        const px0 = side < 0 ? dx - dw - 8 : dx + dw + 1
        for (let i = 0; i < 8; i++) {
            const by = y - 9 - i * 9
            if (by < archY - 2) break
            const rune = (i + (side < 0 ? 0 : 1)) % 2 === 0 ? ((i + pulse) % 4 === 0 ? C.pink : C.purple2) : 0
            block(s, px0 + (side * (i & 1)), by + drift(i + (side < 0 ? 0 : 9)), 8, 8, rune)
        }
    }
    // the arch: voussoirs round the top, each a block set on the curve and floating off it
    for (let k = 0; k < 9; k++) {
        if (k === 4) continue
        const a0 = Math.PI + (k / 9) * Math.PI
        const a1 = Math.PI + ((k + 1) / 9) * Math.PI - 0.04
        const f = drift(k + 20)
        const pts = [
            dx + Math.cos(a0) * dw, archY + Math.sin(a0) * 16 + f, dx + Math.cos(a0) * (dw + 8), archY + Math.sin(a0) * 23 + f,
            dx + Math.cos(a1) * (dw + 8), archY + Math.sin(a1) * 23 + f, dx + Math.cos(a1) * dw, archY + Math.sin(a1) * 16 + f
        ]
        poly(s, pts, 0, 0, STONE[1])
        line(s, R(pts[2]!), R(pts[3]!), R(pts[4]!), R(pts[5]!), STONE[2])
        line(s, R(pts[0]!), R(pts[1]!), R(pts[6]!), R(pts[7]!), STONE[0])
        if (k % 3 === 1) px(s, R((pts[0]! + pts[4]!) / 2), R((pts[1]! + pts[5]!) / 2), (k + pulse) % 4 === 0 ? C.pink : C.purple2)
    }
    // the plinth
    rect(s, dx - dw - 11, y - 3, dw * 2 + 23, 3, STONE[0])
    line(s, dx - dw - 11, y - 3, dx + dw + 11, y - 3, STONE[2])
    // the keystone, an eye cut in it that looks about and opens wide on the attack
    const ky = archY - 27 + drift(30)
    block(s, dx - 7, ky, 15, 13, 0)
    line(s, dx - 5, ky - 2, dx + 5, ky - 2, C.stone3)
    const open = st === 'death' ? R(3 * (1 - B.die)) : B.strike || B.roar ? 4 : B.wind > 0.3 ? 4 : B.hurt ? 1 : 3
    const ex = dx
    const ey = ky + 6
    if (B.glow > 0.3) ditherDisc(s, ex, ey, 9, C.pink, R(B.glow * 7))
    ellipse(s, ex, ey, 5, open + 0.5, C.ink)
    if (open > 0) {
        ellipse(s, ex, ey, 5, open, C.white)
        const look = st === 'idle' ? R(Math.sin(ph) * 2) : 2
        disc(s, ex + look, ey, Math.min(2.5, open), B.hurt ? C.ink : C.pink)
        rect(s, ex + look, ey - 1, 1, 3, C.ink)
        px(s, ex - 2, ey - 1, C.white)
    } else line(s, ex - 4, ey, ex + 4, ey, C.stone3)
    line(s, ex - 6, ey - open - 1, ex + 6, ey - open - 1, STONE[0]) // the lid
    // stones lifting off round it as the edge of the world lets go
    for (let i = 0; i < 5; i++) {
        const k = (q(t) * 0.3 + i / 5) % 1
        const sx = dx - dw - 16 + ((i * 29) % (dw * 2 + 32))
        const sy = y - 6 - k * 90 - lift * 20
        if (k < 0.85) { rect(s, sx, sy, 2 + (i & 1), 2, STONE[1]); px(s, sx, sy, STONE[2]) }
    }
    // the hands: the far one floating behind its side, the near one out at the party
    const bob = wv(t, 2.0, 2)
    stoneHand(s, dx - dw - 16, y - 48 + bob + drift(40), -1.9, 0.15, 0.3, true, 0)
    const lx = dx + dw + 18 + R(bz(0, -6, 2))
    const lyy = y - 42 + bob + R(bz(0, -34, 32)) + drift(41)
    const la = st === 'attack' ? bz(-1.4, -2.0, 0.1) : -1.4 + Math.sin(ph) * 0.1
    const curl = st === 'attack' ? bz(0.12, 0.9, -0.05) : 0.12
    stoneHand(s, lx, lyy, la, curl, B.strike ? 0.8 : 0.3, false, B.glow > 0.3 ? C.pink : C.purple2)
    LH.x = lx - s.ax
    LH.y = lyy - s.ay
}

const LIMINUS_STATES = withSpecial(bossStates(1.5, 2.0, 2.6), 2.8)

/**
 * The Door Opens: its eye opens wide and the vortex inside it races; a bomb of the Void swells in
 * its heart, a ball of the dark full of stars in a ring of pink fire, trembling and flaring as it
 * charges; then it shoots straight out and crashes into the middle of the party, leaving the dark
 * pooled under them.
 */
const THE_DOOR_OPENS: BossSpecial = {
    name: 'The Door Opens', tint: 'purple0', hits: [1.52, 1.56, 1.6, 1.64, 1.68, 1.72], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const hx0 = st.bx + d * -6
        const hy0 = st.by - 48
        const mx = st.party.reduce((a, p) => a + p.x, 0) / st.party.length
        const my = st.party.reduce((a, p) => a + p.y, 0) / st.party.length - 12
        // the bomb: swelling in the door's heart, trembling and flaring as it charges, then shot
        // straight out, fast, into the middle of them
        const grow = sp(t, 0.35, 1.2)
        const fly = sp(t, 1.36, 1.5) * sp(t, 1.36, 1.5)
        if (grow > 0 && q < 1.5) {
            const pulse = q < 1.36 && grow > 0.5 ? (Math.floor(q * 16) & 1) : 0
            const shake = q < 1.36 && grow > 0.7 ? (Math.floor(q * 30) % 3) - 1 : 0
            const r = 2 + grow * 11 + pulse
            const x = hx0 + (mx - hx0) * fly + shake
            const y = hy0 + (my - hy0) * fly
            if (fly <= 0) for (let i = 0; i < 12; i++) {
                // the Void spiralling into it as it swells
                const u = ((q * 1.5 + i / 12) % 1)
                const a = i * 2.4 + q * 4
                s.set(R(x + Math.cos(a) * (r + 18 * (1 - u))), R(y + Math.sin(a) * (r + 18 * (1 - u))), u > 0.7 ? C.pink : C.purple2)
            }
            if (pulse) ditherDisc(s, x, y, r + 9, C.pink, 5)
            if (fly > 0) for (let k = 1; k < 9; k++) {
                // the dark streaming off behind it
                const v = Math.max(0, fly - k * 0.08)
                disc(s, hx0 + (mx - hx0) * v, hy0 + (my - hy0) * v, r * (1 - k * 0.1), k < 3 ? C.purple0 : C.void)
            }
            ditherDisc(s, x, y, r + 5, C.purple1, 6)
            disc(s, x, y, r + 1.5, C.pink)
            disc(s, x, y, r, C.ink)
            for (let i = 0; i < r * 1.5; i++) {
                const a = hash2(i, 1) * Math.PI * 2
                const rr = hash2(i, 2) * (r - 1)
                if ((Math.floor(q * 8) + i) % 3) s.set(R(x + Math.cos(a) * rr), R(y + Math.sin(a) * rr), i & 1 ? C.white : C.pink)
            }
            arc(s, x, y, r - 1, Math.PI * 1.1, Math.PI * 1.5, C.purple2) // the dark lit on its top
        }
        // the burst on the middle of them, and the dark left pooled under them
        if (q > 1.5 && q < 1.58) disc(s, mx, my, 14, C.white)
        blast(s, mx, my, t, 1.5, 26, 0.7, VOID6, 721, 'shadow')
        shockRing(s, mx, my, t, 1.5, 0.6, 10, 64, C.white)
        shockRing(s, mx, my + 12, t, 1.52, 0.6, 8, 56, C.pink, true)
        const pool = sp(t, 1.5, 1.7) * (1 - sp(t, 2.3, 2.8))
        if (pool > 0) st.party.forEach(p => pit(s, p.x, p.y, 9 * pool, C.ink, C.purple0))
        st.party.forEach((p, i) => blast(s, p.x, chest(p), t, 1.52 + i * 0.04, 7, 0.45, VOID6, 731 + i, 'shadow'))
    }
}

export const LIMINUS: CreatureDef = {
    name: 'Liminus, the Last Door', size: 152, shadow: 0, accent: C.pink,
    states: LIMINUS_STATES,
    special: THE_DOOR_OPENS,
    draw(s, st, t) {
        drive(this, st, t, 0, 2.0)
        if (st === 'special') {
            // the eye wide and burning, the vortex racing, a hand lifted to beckon
            const on = sm(Math.min(1, B.sp / 0.25)) * (1 - sm(Math.max(0, (B.sp - 0.8) / 0.2)))
            B.wind = on * 0.6
            B.glow = on
        }
        const x = s.ax - 6 - B.kb
        const y = s.ay
        if (st === 'entry') {
            const u = q(t) / LIMINUS_STATES.entry.dur
            const rise = Math.min(1, u / 0.14)
            const open = sm(span(u, 0.14, 0.5))
            if (open < 1) rift(s, x, y, rise, open, 104, 68, d => liminusBody(d, 'idle', x, y, t, 0))
            else liminusBody(s, st, x, y, t, 0)
            B.ent = 1
        } else {
            liminusBody(s, st, x, y, t, B.die)
        }
        finish(s, Entry.Fade, 0)
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'attack' && B.strike) {
            // the hand comes down: the ground cracks with the Void's light and stone flies
            const gx = x + dir * LH.x
            for (let i = 0; i < 14; i++) {
                const a = i / 14 * Math.PI
                dst.set(R(gx + Math.cos(a) * (8 + (i & 1) * 5)), R(y - 2 - Math.sin(a) * (3 + (i % 3) * 2)), i & 1 ? C.stone2 : C.pink)
            }
            for (let i = 0; i < 8; i++) { dst.set(gx + dir * (i - 4) * 3, y, C.pink); dst.set(gx + dir * (i - 4) * 3 + 1, y - 1, C.white) }
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 10 · The Void

// Stage 5: the Void Herald, the winged thing that announces the end, sounding a horn. Stage 10:
// Nihil, the Hunger at the End, a mouth the size of the sky with eyes all round it.

const VOID_WING: Mat = [C.ink, C.void, C.purple0]
const VOID_WING_FAR: Mat = [C.ink, C.ink, C.void]

/** Stars pricked into whatever is already painted in the box at (x, y), a few of them pink. */
function sprinkle(s: Surface, x: number, y: number, w: number, h: number, t: number, seed: number, density: number): void {
    const tw = fr(t, 5, 3)
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            if (!s.get(xx, yy)) continue
            const r = hash2(xx * 7 + seed, yy * 13)
            if (r < density) s.set(xx, yy, (Math.floor(r * 1000) + tw) % 3 ? C.white : C.pink)
        }
    }
}

/** The Herald's horn bell this frame, sprite-local from the anchor, and where it points. */
const HB = { x: 0, y: 0, a: 0 }

/**
 * The Void Herald, the thing that announces the end: four great wings of the dark, feathered and
 * pricked with stars, their tips burning pink; a halo of black fire; a black cowl round a smooth
 * gold mask with no face on it but a slit of pink light; long robes of the starfield bound in gold
 * down the front and at the hem, trailing off into nothing. It holds a long horn of bone banded in
 * gold, lifts it to the mask as its wings rise, and sounds it at the party.
 */
/**
 * Last Trumpet: the Herald spreads its four wings wide and sounds the horn up at the sky; the call
 * rolls up into the dark, the stars answer, and they come down in a fast barrage, burning pink,
 * every one of the party struck twice.
 */
const LAST_TRUMPET: BossSpecial = {
    name: 'Last Trumpet', tint: 'purple0', hits: Array.from({ length: 12 }, (_, k) => 1.2 + k * 0.07), spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const bx = st.bx + d * HB.x
        const by = st.by + HB.y
        // the call rolling up out of the bell into the sky
        for (let r = 0; r < 3; r++) shockRing(s, bx, by, t, 0.45 + r * 0.16, 0.6, 3, 30, r & 1 ? C.pink : C.white)
        // the stars answering, twinkling up there, then coming down one after another
        for (let k = 0; k < 12; k++) {
            const p = st.party[k % st.party.length]!
            const hit = 1.2 + k * 0.07
            const sx0 = p.x - d * (34 + (k % 4) * 8) + (k % 3 - 1) * 5
            const sy0 = 4 + (k % 4) * 5
            if (q > 0.7 && q < hit - 0.25) starFx(s, R(sx0), sy0, Math.floor(q * 12 + k) & 1 ? 2 : 1, C.pink)
            const u = sp(t, hit - 0.25, hit)
            if (u > 0 && u < 1) {
                const x = sx0 + (p.x - sx0) * u
                const y = sy0 + (chest(p) - sy0) * u * u
                for (let j = 1; j < 7; j++) {
                    const v = Math.max(0, u - j * 0.035)
                    s.set(R(sx0 + (p.x - sx0) * v), R(sy0 + (chest(p) - sy0) * v * v), j < 3 ? C.pink : j < 5 ? C.purple2 : C.purple1)
                }
                starFx(s, R(x), R(y), 3, C.pink)
            }
            blast(s, p.x + (k < 6 ? -2 : 2), chest(p) - (k < 6 ? 0 : 3), t, hit, 7, 0.35, VOID6, 801 + k, 'shadow')
        }
    }
}

export const VOID_HERALD: CreatureDef = {
    name: 'Void Herald', size: 128, shadow: 12, hover: 1, accent: C.pink,
    states: withSpecial(bossStates(1.3, 1.6, 2.0), 2.6),
    special: LAST_TRUMPET,
    draw(s, st, t) {
        drive(this, st, t, 4, 1.6)
        // the wings flung wide and held, the horn lifted to the mask and raised to the sky
        if (st === 'special') spAttack(0.3, 0.34, 0.86, 0)
        const x = s.ax - 6 + B.lunge - B.kb
        const y = s.ay
        const hover = -10 + wv(t, 1.6, 2) + R(B.die * 14)
        const top = y - 74 + hover
        const beat = st === 'idle' || st === 'entry' ? Math.sin(q(t) / 1.6 * Math.PI * 2) : 0
        const lift = st === 'attack' ? bz(0, 0.6, 0.9) : st === 'special' ? bz(0, 0.6, 1.0) : beat * 0.25
        // the wings: an upper pair raised, a lower pair swept down, the far ones behind
        const wx = x - 3
        const wy = top + 19
        rocWing(s, wx + 2, wy - 1, -1.75 - 0.2 * (1 - lift) + 0.35, 34, VOID_WING_FAR, C.purple2, 0, false)
        rocWing(s, wx + 2, wy + 4, 2.55 - lift * 0.3 + 0.3, 24, VOID_WING_FAR, C.purple2, 0, false)
        rocWing(s, wx, wy, -1.95 - 0.25 * (1 - lift), 40, VOID_WING, C.pink, 0, false)
        rocWing(s, wx, wy + 6, 2.6 - lift * 0.35, 28, VOID_WING, C.pink, 0, false)
        sprinkle(s, x - 50, top - 30, 50, 90, t, 41, 0.035)
        // the halo of black fire, a thin ring of light inside it
        const hx = x + 3
        const hy = top + 8
        const fk = fr(t, 10, 4)
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2
            const len = 3 + ((i + fk) % 4 === 0 ? 3 : (i + fk) % 2)
            const bx = hx - 3 + Math.cos(a) * 12
            const by = hy - 2 + Math.sin(a) * 12
            line(s, R(bx), R(by), R(bx + Math.cos(a) * len), R(by + Math.sin(a) * len), (i + fk) % 3 ? C.void : C.purple0)
            px(s, R(bx + Math.cos(a) * len), R(by + Math.sin(a) * len), (i + fk) % 5 === 0 ? C.pink : C.purple0)
        }
        ring(s, hx - 3, hy - 2, 12, C.ink)
        ring(s, hx - 3, hy - 2, 11, (B.glow > 0.3 || fk === 0) ? C.white : C.pink)
        // the robes: the starfield bound in gold, trailing off into nothing
        const rt = top + 16
        const trail = R(Math.sin(q(t) / 1.6 * Math.PI * 2 + 1) * 2)
        poly(s, [-7, 0, 7, 0, 10, 36, 4, 44, -6, 48 + trail, -14, 52 + trail, -12, 36], x, rt, C.void)
        voidFill(s, x - 14, rt, 25, 53, t, 43)
        line(s, x - 7, rt, x - 12, rt + 36, C.purple2) // the rim of light
        line(s, x + 7, rt, x + 10, rt + 36, C.purple0)
        // the orphrey down the front, gold, a pink stone set in it
        poly(s, [2, 0, 6, 0, 8, 38, 3, 40], x, rt, C.gold1)
        line(s, x + 2, rt, x + 3, rt + 40, C.gold2)
        for (let i = 0; i < 4; i++) px(s, x + 5, rt + 8 + i * 8, C.gold3)
        disc(s, x + 5, rt + 5, 1.5, C.pink); px(s, x + 5, rt + 4, C.white)
        line(s, x - 12, rt + 36, x + 10, rt + 36, C.gold2) // the hem band
        line(s, x - 12, rt + 37, x + 10, rt + 37, C.gold1)
        for (let i = 0; i < 5; i++) tri(s, x - 14 + i * 3, rt + 46 + trail, x - 12 + i * 3, rt + 46 + trail, x - 16 + i * 2, rt + 54 + trail + (i & 1) * 3, C.void) // the tatters
        // the far arm hanging in its wide sleeve
        limbT(s, x - 5, rt + 2, x - 9, rt + 20, 5, 6, VOID_WING)
        line(s, x - 12, rt + 21, x - 6, rt + 21, C.gold1)
        // the cowl, and in it the gold mask with no face but a slit of light
        ellipse(s, hx - 1, hy, 7, 8, C.ink)
        ellipse(s, hx - 2, hy, 6, 7, C.void)
        line(s, hx - 7, hy - 3, hx - 3, hy - 8, C.purple2)
        ellipse(s, hx + 1, hy + 1, 4, 5.5, C.gold1)
        ellipse(s, hx + 1, hy, 3, 4.5, C.gold2)
        line(s, hx, hy - 4, hx + 2, hy - 4, C.gold3)
        line(s, hx + 4, hy - 2, hx + 4, hy + 3, C.gold0)
        const slit = B.hurt ? C.white : (B.glow > 0.3 ? C.white : C.pink)
        line(s, hx - 1, hy, hx + 4, hy, C.ink)
        line(s, hx, hy, hx + 3, hy, slit)
        if (B.glow > 0.3) ditherDisc(s, hx + 2, hy, 4, C.pink, R(B.glow * 6))
        // the near arm and the horn: held low, raised to the mask, sounded at the party
        const sx = x + 4
        const sy = rt + 3
        const hdx = x + R(bz(9, 7, 10))
        const hdy = rt + R(bz(16, -3, 0))
        limbT(s, sx, sy, hdx, hdy, 5, 5, VOID_WING)
        line(s, hdx - 1, hdy - 2, hdx + 1, hdy + 2, C.gold2) // the cuff
        const ha = st === 'special' ? bz(0.5, -0.75, -1.35) : bz(0.5, -0.75, -0.12)
        const L = 22
        HB.a = ha
        let bx = hdx
        let by = hdy
        for (let i = 0; i <= 12; i++) {
            // the horn curving from the mouthpiece to the bell, widening, banded in gold
            const u = i / 12
            const a = ha - 0.35 + u * 0.5
            const nx = hdx + Math.cos(ha) * L * u + Math.cos(a + Math.PI / 2) * Math.sin(u * Math.PI) * 3
            const ny = hdy + Math.sin(ha) * L * u + Math.sin(a + Math.PI / 2) * Math.sin(u * Math.PI) * 3
            const w = 1 + u * u * 4
            disc(s, nx, ny, w, i % 4 === 2 ? C.gold1 : C.bone0)
            disc(s, nx - 0.5, ny - 0.5, Math.max(0.5, w - 1), i % 4 === 2 ? C.gold2 : C.bone1)
            bx = nx
            by = ny
        }
        ellipse(s, bx, by, 2.5, 4, C.ink) // the mouth of the bell
        px(s, R(bx - 1), R(by - 3), C.white)
        disc(s, hdx + 1, hdy, 2, C.steel2) // the hand
        HB.x = bx - s.ax
        HB.y = by - s.ay
        finish(s, Entry.Drop, 0)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 10)
        for (let i = 0; i < 3; i++) dst.set(x + dir * (-20 + ((i * 13 + k * 3) % 40)), y - 30 - ((k * 5 + i * 9) % 50), i & 1 ? C.purple0 : C.pink) // embers of the black fire
        if ((st === 'attack' && (B.strike || B.rec > 0.4)) || B.roar) {
            // the horn's call rolling out from the bell at the party
            const bx = x + dir * HB.x
            const by = y + HB.y
            for (let r = 5; r <= 35; r += 7) {
                const rr = r + (k % 3) * 2
                for (let a = -0.6; a <= 0.6; a += 0.1) dst.set(bx + dir * R(Math.cos(a) * rr), by + R(Math.sin(a) * rr), r % 14 === 5 ? C.white : C.pink)
            }
        }
    }
}

// ── Nihil ──

/** Nihil's maw this frame, sprite-local from the anchor. */
const NM = { x: 0, y: 0 }

/**
 * One eye of Nihil's at (x, y), `r` across: white, a pink iris with a slit pupil looking toward
 * the party, a lid of the dark; `open` 0..1 widens it, 0 shuts it.
 */
function nihilEye(s: Surface, x: number, y: number, r: number, open: number): void {
    const h = Math.max(0, r * 0.65 * open)
    ellipse(s, x, y, r + 1, r * 0.65 + 1, C.ink)
    if (h < 0.5) { line(s, R(x - r), R(y), R(x + r), R(y), C.purple0); return }
    ellipse(s, x, y, r, h, C.white)
    const ir = Math.max(1, Math.min(r * 0.55, h))
    disc(s, x + r * 0.3, y, ir, C.pink)
    line(s, R(x + r * 0.35), R(y - ir + 1), R(x + r * 0.35), R(y + ir - 1), C.ink)
    px(s, R(x - r * 0.3), R(y - h * 0.5), C.white)
    arc(s, x, y - 1, r + 1, Math.PI * 1.1, Math.PI * 1.9, C.purple2) // the lid, lit
}

/**
 * Nihil whole, `x`/`y` its anchor: a hide of the starfield risen out of a pool of the dark, lumped
 * and rimmed in violet, cracks of pink light across it, eyes of every size opening all over it,
 * tendrils rising round it; on its front the maw, rings of teeth grinding round each other down
 * into a pink gullet and the black hole at its heart. `open` sizes the maw.
 */
/** Where Nihil's pool sits from the anchor: under its body at rest, and fixed there as the body lunges. */
const NIHIL_POOL_DX = -28

/**
 * The pool of the dark Nihil rises out of, a portal in the glass: it opens out of a point (`open`
 * 0 → 1) with its rim burning pink as it spreads, cracks of the Void running out across the glass
 * once it is open. Stays where it opened; the body over it lunges and bobs on its own.
 */
function nihilPool(s: Surface, x: number, y: number, open: number): void {
    if (open <= 0) return
    const px0 = x + NIHIL_POOL_DX
    const py = y - 1
    ditherEllipse(s, px0, py, 82 * open, Math.max(1, 7 * open), C.purple0, 6)
    ellipse(s, px0, py, 70 * open, Math.max(1, 5 * open), C.ink)
    if (open < 1) {
        // the rim of the opening, burning as it spreads
        ellipseRing(s, px0, py, 70 * open, Math.max(1, 5 * open), C.pink)
        ellipseRing(s, px0, py, 70 * open + 1, Math.max(1, 5 * open), C.white)
        return
    }
    for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI
        line(s, R(px0 + Math.cos(a) * 70), py, R(px0 + Math.cos(a) * (84 + (i % 3) * 6)), py + (i & 1), C.pink)
    }
}

function nihilBody(s: Surface, st: string, x: number, y: number, t: number, open: number): void {
    const ph = q(t) / 2.4 * Math.PI * 2
    const cx = x - 34
    // it floats clear of the glass, bobbing; its hide is squashed by V so the lift doesn't raise its top into the HUD
    const V = 0.86
    const cy = y - 58 + wv(t, 2.4, 2)
    // tendrils hanging from its underside, trailing down into nothing
    for (let i = 0; i < 5; i++) tentacle(s, cx - 56 + i * 20, cy + 30 - (i === 2 ? 4 : 0), Math.PI / 2 + 0.25 - i * 0.12, 16 + (i % 2) * 6, 6, ph + i * 1.3, [C.ink, C.void, C.purple0], C.purple2)
    // the mass: lumped, rimmed in violet toward the light, the starfield in it
    const lumps = ([[0, 0, 62, 46], [-30, -18, 34, 30], [18, -26, 32, 24], [-44, 14, 30, 30], [30, 16, 30, 28]] as const).map(([lx, ly, rx, ry]) => [lx, ly * V, rx, ry * V] as const)
    for (const [lx, ly, rx, ry] of lumps) ellipse(s, cx + lx, cy + ly, rx, ry, C.ink)
    for (const [lx, ly, rx, ry] of lumps) ellipse(s, cx + lx - 1, cy + ly - 1, rx - 2, ry - 2, C.void)
    voidFill(s, cx - 76, cy - 56, 140, 110, t, 29)
    // the rim of violet light along its top, which is all that shows it against the dark
    for (const [lx, ly, rx, ry] of lumps) {
        for (let an = Math.PI * 0.95; an < Math.PI * 2.05; an += 0.02) {
            const ex = R(cx + lx + Math.cos(an) * (rx - 2))
            const ey = R(cy + ly + Math.sin(an) * (ry - 2))
            if (s.get(ex, ey - 2) === 0 || s.get(ex, ey - 3) === 0) { s.set(ex, ey, C.purple2); s.set(ex, ey + 1, C.purple0) }
        }
    }
    // cracks of pink light across the hide
    for (let i = 0; i < 5; i++) {
        let kx = cx - 50 + i * 22
        let ky = cy + R((-30 + (i % 3) * 18) * V)
        for (let j = 0; j < 5; j++) {
            const nx = kx + 3 + R(hash2(i, j) * 4)
            const ny = ky + R((hash2(i + 9, j) - 0.4) * 6)
            line(s, kx, ky, nx, ny, (j + fr(t, 4, 5)) % 5 === 0 ? C.white : C.purple1)
            kx = nx
            ky = ny
        }
    }
    // eyes of every size opening all over it
    const wide = st === 'attack' || st === 'special' ? 1 + B.wind * 0.3 : 1
    const eyes = [[-8, -38, 5], [16, -44, 3], [-30, -30, 4], [-48, -10, 5], [-22, -8, 3], [-58, 16, 3], [8, -26, 2.5], [-40, 34, 4], [30, -20, 3], [-12, 30, 2.5], [-62, -22, 2.5], [22, 32, 3], [-2, -52, 2.5], [-26, 16, 6]] as const
    for (let i = 0; i < eyes.length; i++) {
        const [ex, ey, r] = eyes[i]!
        const blink = B.hurt || (fr(t, 3, 23) === i % 23 && st !== 'attack')
        nihilEye(s, cx + ex, cy + R(ey * V), r * 1.35, blink ? 0 : wide)
    }
    // the maw on its front, its lip rimmed in violet
    const mx = cx + 40
    const my = cy + 4
    const rx = 17 * open
    const ry = 28 * open
    ellipse(s, mx, my, rx + 4, ry + 4, C.void)
    ellipse(s, mx, my, rx + 2, ry + 2, C.purple1)
    arc(s, mx, my, Math.max(rx, ry) + 3, Math.PI * 1.2, Math.PI * 1.7, C.pink)
    ellipse(s, mx, my, rx, ry, C.ink)
    // the gullet glowing far down in it, the black hole at its heart
    ditherEllipse(s, mx, my, rx * 0.55, ry * 0.55, C.purple1, 8)
    ditherEllipse(s, mx, my, rx * 0.35, ry * 0.35, C.pink, 6 + R(B.glow * 6))
    disc(s, mx, my, Math.max(1, 3 * open), C.ink)
    const sw = q(t) * 5
    arc(s, mx, my, Math.max(2, 4 * open), sw, sw + 3.4, C.white)
    arc(s, mx, my, Math.max(2, 4 * open), sw + 3.4, sw + 5.4, C.pink)
    // rings of teeth grinding round each other, pointing in, dark throat between them
    for (let ringi = 0; ringi < 3; ringi++) {
        const k = [1, 0.62, 0.38][ringi]!
        const depth = [0.28, 0.16, 0.1][ringi]!
        const n = [13, 10, 7][ringi]!
        const spin = q(t) * (ringi & 1 ? -0.6 : 0.6) + ringi * 0.4
        for (let i = 0; i < n; i++) {
            const a = spin + (i / n) * Math.PI * 2
            const ox = mx + Math.cos(a) * rx * k
            const oy = my + Math.sin(a) * ry * k
            const ix = mx + Math.cos(a) * rx * (k - depth)
            const iy = my + Math.sin(a) * ry * (k - depth)
            const ta = a + Math.PI / 2
            const w = [2.4, 1.6, 1.1][ringi]!
            tri(s, ox + Math.cos(ta) * w, oy + Math.sin(ta) * w, ox - Math.cos(ta) * w, oy - Math.sin(ta) * w, ix, iy, ringi === 0 ? C.bone1 : ringi === 1 ? C.bone0 : C.stone3)
            if (ringi === 0) px(s, R(ix), R(iy), C.white)
        }
    }
    // tendrils rising in front at the sides of the maw, reaching for the party
    for (const [tx, ty, a] of [[mx - 22, cy + 30, 0.7], [mx + 6, cy + 26, 0.35]] as const) tentacle(s, tx, ty, a - (st === 'attack' ? B.wind * 0.4 : 0), 34, 4, ph + tx, [C.ink, C.void, C.purple0], C.pink)
    NM.x = mx - s.ax
    NM.y = my - s.ay
}

/** The fraction of Nihil's entry its pool takes to open, before the body starts rising out of it. */
const NIHIL_POOL_OPENS = 0.3
/** How far it rises out of its pool: about its own height above the glass, so it starts to show at once. */
const NIHIL_HEIGHT = 116

const NIHIL_STATES = withSpecial({ ...bossStates(1.6, 2.4, 2.8), death: { dur: 2.4, loop: false } }, 2.8)

/**
 * Devour: it gapes impossibly wide; the dark closes in on everything but its maw, and all of it
 * streams in, light and stars and the party's own colour torn off them; then the maw snaps shut on
 * the party and the dark lets go.
 */
const DEVOUR: BossSpecial = {
    name: 'Devour', tint: 'void', hits: [1.62, 1.67, 1.72, 1.77, 1.82, 1.87], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const mx = st.bx + d * NM.x
        const my = st.by + NM.y
        // the dark closing in on everything but the maw, then letting go after the bite
        const close = sp(t, 0.3, 1.5) * (1 - sp(t, 1.75, 2.4))
        if (close > 0) {
            const r = 320 - close * 210
            for (let y = 0; y < s.h; y++) {
                for (let x = 0; x < s.w; x++) {
                    const dd = Math.hypot(x - mx, (y - my) * 1.3) - r
                    if (dd > 0 && bayer(x, y, Math.min(16, R(dd / 3)))) s.set(x, y, C.ink)
                }
            }
        }
        // everything streaming in: stars, light, and wisps torn off the party
        if (q > 0.3 && q < 1.65) {
            for (let i = 0; i < 40; i++) {
                const u = ((q - 0.3) * 1.3 + i / 40) % 1
                const a = i * 2.39
                const r0 = 150
                const x = mx + Math.cos(a) * r0 * (1 - u)
                const y = my + Math.sin(a) * r0 * 0.6 * (1 - u)
                s.set(R(x), R(y), u > 0.8 ? C.white : i % 3 ? C.pink : C.purple2)
                s.set(R(x + Math.cos(a) * 2), R(y + Math.sin(a) * 1.2), C.purple1)
            }
            st.party.forEach((p, i) => {
                for (let k = 0; k < 4; k++) {
                    const u = ((q - 0.5) * 1.5 + k / 4 + i * 0.1) % 1
                    if (q < 0.5) continue
                    s.set(R(p.x + (mx - p.x) * u), R(chest(p) + (my - chest(p)) * u + Math.sin(u * 6 + i) * 3), k & 1 ? C.white : C.pink)
                }
            })
        }
        // the bite: a white flash in the maw and a shock rolling out over the party
        if (q > 1.6 && q < 1.68) disc(s, mx, my, 10, C.white)
        shockRing(s, mx, my, t, 1.6, 0.5, 8, 60, C.white)
        st.party.forEach((p, i) => blast(s, p.x, chest(p), t, 1.62 + i * 0.05, 8, 0.5, VOID6, 811 + i, 'shadow'))
    }
}

/**
 * Nihil, the Hunger at the End: what waits where every crack leads, a mouth the size of the sky.
 * It rises out of a pool of the dark in the glass, a hide of the starfield with eyes of every size
 * opening all over it and tendrils rising round it; its maw is rings of teeth grinding round each
 * other down to the black hole at its heart. It gapes wide and draws everything in, then lunges
 * and bites the front rank. When it dies it collapses into a single point and winks out, the way
 * each run ends before it begins again.
 */
export const NIHIL: CreatureDef = {
    name: 'Nihil, the Hunger at the End', size: 256, shadow: 0, accent: C.pink,
    states: NIHIL_STATES,
    // broken apart as the point it collapsed into winks out, after the whole collapse has played
    shatterAt: 2.04,
    special: DEVOUR,
    draw(s, st, t) {
        drive(this, st, t, 10, 2.4)
        const x = s.ax - 10 + B.lunge - B.kb
        const y = s.ay
        // the pool stays where it opened, whatever the body over it does
        const poolX = s.ax - 10
        if (st === 'special') spAttack(0.56, 0.6, 0.72, 10)
        // the special gapes it impossibly wide before the snap
        let open = st === 'attack' ? bz(0.8, 1.2, 0.35) : B.roar ? 1.2 : 0.8 + wv(t, 2.4, 1) * 0.04
        if (st === 'special') {
            if (B.sp < 0.56) open = 0.8 + 0.65 * sm(Math.min(1, B.sp / 0.4))
            else if (B.sp < 0.72) open = 0.35
            else open = 0.35 + 0.45 * sm((B.sp - 0.72) / 0.28)
        }
        if (st === 'death') {
            // it collapses into a point at the heart of its maw, then winks out
            CF.fade = 0
            const u = q(t) / NIHIL_STATES.death.dur
            const p = sm(span(u, 0.05, 0.75))
            const b = scratch('nihil', s)
            nihilBody(b, 'idle', x, y, t, 0.8)
            const fx0 = NM.x + s.ax
            const fy0 = NM.y + s.ay
            // the pool closes behind it as it goes
            nihilPool(s, poolX, y, 1 - p)
            if (p < 1) warp(s, b, fx0, fy0, fx0, fy0, 1 - p * 0.98, R(16 - p * 10))
            if (u > 0.7 && u < 0.86) {
                // the point it became, flaring
                const f = 1 - Math.abs(u - 0.78) / 0.08
                ditherDisc(s, fx0, fy0, 3 + f * 8, C.pink, R(4 + f * 8))
                disc(s, fx0, fy0, 1 + f * 2, C.white)
            }
        } else if (st === 'entry') {
            // the pool opens out of a point, then it rises out of it, cut off at the pool's surface
            const u = q(t) / NIHIL_STATES.entry.dur
            nihilPool(s, poolX, y, sm(span(u, 0, NIHIL_POOL_OPENS)))
            const rise = sm(span(u, NIHIL_POOL_OPENS * 0.8, ENTRY_SETTLED))
            if (rise > 0) {
                const b = scratch('nihil', s)
                nihilBody(b, st, x, y, t, open)
                shift(b, 0, R((1 - rise) * NIHIL_HEIGHT), b.ay)
                for (let i = 0; i < b.data.length; i++) if (b.data[i]) s.data[i] = b.data[i]!
            }
            // its rise is its own, so finish must not raise it again
            B.ent = 1
        } else {
            nihilPool(s, poolX, y, 1)
            nihilBody(s, st, x, y, t, open)
        }
        finish(s, Entry.Rise, 0)
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'death') return
        const mx = x + dir * NM.x
        const my = y + NM.y
        const k = fr(t, 10, 12)
        if (st === 'attack' && B.wind > 0.2) {
            // everything being drawn in toward the maw
            for (let i = 0; i < 16; i++) {
                const u = ((k / 12 + i / 16) * 2) % 1
                const sx = mx + dir * (70 - u * 64)
                const sy = my - 34 + ((i * 17) % 68) * (1 - u)
                dst.set(R(sx), R(sy), i & 1 ? C.white : C.pink)
                dst.set(R(sx + dir), R(sy), C.purple2)
            }
        }
        if (st === 'attack' && B.strike) {
            // the bite landing on the front rank: teeth-white shards and the dark thrown up
            const gx = x + dir * 44
            for (let i = 0; i < 14; i++) {
                const a = i / 14 * Math.PI * 2
                dst.set(R(gx + Math.cos(a) * (6 + (i & 1) * 5)), R(y - 16 + Math.sin(a) * (8 + (i % 3) * 3)), i & 1 ? C.white : C.pink)
            }
        } else if (st !== 'attack') {
            // matter drifting in toward the maw
            for (let i = 0; i < 5; i++) {
                const a = i * 1.3 + k * 0.2
                const r = 70 - ((k * 4 + i * 9) % 44)
                dst.set(mx + dir * R(Math.cos(a) * r), my + R(Math.sin(a) * r * 0.6), i & 1 ? C.purple2 : C.pink)
            }
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

