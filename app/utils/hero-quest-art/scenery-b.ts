// Worlds 6–10 on Thornwick Vale's layout (scenery-kit.ts), each painted on the scenery tier in
// hues chosen away from its own enemies. The later worlds have dark or colourless enemies, so
// their fields run lighter than the bodies standing on them rather than darker.

import { C } from './palette'
import type { Surface } from './surface'
import { rect, px, line, disc, ellipse, ellipseRing, tri, quad, dither, ditherDisc, ditherEllipse, hash2, bayer, poly, taper, ring, dome } from './surface'
import { clock } from './vfx-kit'
import {
    SW, SH, FLOOR_Y, GROUND, LIP, FRONT, type WorldScene, R, mod, vnoise, sky, ridge, band, drift,
    reflectWater, streakCloud, phase, loopFrame, framing, glow, scatter, flagstones, motes, strata, stars
} from './scenery-kit'

const TAU = Math.PI * 2

/** Dark birds crossing the sky on the live stage only, `every` seconds apart. */
function flock(s: Surface, t: number, sc: number, every: number, y: number, n: number, c: number): void {
    const k = Math.floor(t / every)
    const u = (t % every) / every
    const y0 = y + R(hash2(k, 71) * 24)
    for (let i = 0; i < n + (k & 1); i++) {
        const x = R(SW + 20 + i * 11 - u * (SW + 100) - sc * 0.08)
        const yy = y0 + i * 3 + R(Math.sin(t * 1.1 + i) * 2)
        const up = Math.floor(t * 5 + i * 1.7) & 1
        s.set(x, yy, c); s.set(x + 1, yy, c)
        s.set(x - 1, yy + (up ? -1 : 1), c); s.set(x + 2, yy + (up ? -1 : 1), c)
        if (up) { s.set(x - 2, yy - 1, c); s.set(x + 3, yy - 1, c) }
    }
}

// ── 6. Duskspire ───────────────────────────────────────────────────────────────────

const RIFT = { x: 160, y: 44 }

/** The Void door: a lens-shaped tear in the twilight, rimmed in violet, cracking the sky around it. */
function rift(s: Surface, x: number, y: number, ph: number): void {
    ditherEllipse(s, x, y, 30, 44, C.heather2, 2)
    ditherEllipse(s, x, y, 18, 38, C.heather3, 3)
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.4
        let cx = x
        let cy = y
        for (let k = 0; k < 4; k++) {
            const nx = cx + Math.cos(a + (hash2(i, k) - 0.5)) * 7
            const ny = cy + Math.sin(a + (hash2(i, k) - 0.5)) * 9
            if (k > 0) line(s, R(cx), R(cy), R(nx), R(ny), C.heather3)
            cx = nx
            cy = ny
        }
    }
    poly(s, [0, -40, 6, -18, 3, -4, 9, 10, 2, 24, 0, 40, -3, 22, -8, 6, -4, -8, -6, -24], x, y, C.purple2)
    poly(s, [0, -36, 4, -16, 1, -4, 6, 10, 0, 22, 0, 36, -2, 20, -6, 6, -2, -8, -4, -22], x, y, C.ink)
    line(s, x, y - 36, x, y + 36, C.void)
    // light being drawn in, spiralling round the door
    for (let i = 0; i < 18; i++) {
        const u = (ph + i / 18) % 1
        const a = u * TAU * 1.5 + i
        const r = (1 - u) * 26
        s.set(R(x + Math.cos(a) * r * 0.7), R(y + Math.sin(a) * r * 1.3), i % 3 ? C.pink : C.white)
    }
}

/** A mage tower: a shaft, a flared belvedere, a steep cone, a rune ring turning round it. */
function mageTower(s: Surface, x: number, base: number, h: number, ph: number, f: number, seed: number): void {
    const top = base - h
    rect(s, x - 6, top, 13, h, C.heather0)
    rect(s, x - 6, top, 3, h, C.dusk1)
    rect(s, x - 6, top, 1, h, C.dusk2)
    rect(s, x - 9, top - 3, 19, 3, C.heather1)
    rect(s, x - 9, top - 3, 19, 1, C.dusk2)
    tri(s, x - 8, top - 3, x + 9, top - 3, x, top - 24, C.heather0)
    line(s, x, top - 24, x + 8, top - 4, C.dusk1)
    for (let i = 0; i < 4; i++) {
        const lit = (f + seed + i * 3) % 7 !== 0
        rect(s, x - 2 + (i & 1) * 3, top + 8 + i * 12, 2, 3, lit ? C.sand3 : C.heather1)
    }
    const ry = top + 14
    for (let i = 0; i < 16; i++) {
        const a = (i / 16 + ph / 4) * TAU
        const rx = x + Math.cos(a) * 14
        const yy = ry + Math.sin(a) * 3
        if (Math.sin(a) < 0 && Math.abs(Math.cos(a)) < 0.45) continue
        s.set(R(rx), R(yy), i % 4 === 0 ? C.sand3 : C.heather3)
    }
    const bob = R(Math.sin(ph * TAU + seed) * 2)
    ditherDisc(s, x, top - 32 + bob, 4, C.heather3, 5)
    tri(s, x - 2, top - 32 + bob, x + 2, top - 32 + bob, x, top - 37 + bob, C.pink)
    tri(s, x - 2, top - 32 + bob, x + 2, top - 32 + bob, x, top - 28 + bob, C.purple2)
}

/**
 * Duskspire held at twilight: a plum sky burning rose and gold at the horizon, the Void door
 * torn open in it with light spiralling in, a skyline of spires and the great mage towers with
 * rune rings turning, a lamplit balustrade along the far edge of a paved plaza inlaid with a
 * glowing circle, obelisks framing it and a reflecting pool in front. The plaza is warm lit
 * stone, well above the Hollow Acolytes' near-black violets.
 */
export const duskspire: WorldScene = {
    id: 'world_duskspire',
    water: FRONT,
    tiered: true,
    draw(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        sky(s, [C.heather0, C.dusk0, C.dusk1, C.dusk2, C.dusk3, C.sand3], [0, 18, 40, 62, 82, 98])
        stars(s, t, 30, 601, 36, C.heather2, C.heather3)
        ditherEllipse(s, 160, 104, 150, 16, C.sand3, 4)
        for (let i = 0; i < 4; i++) {
            const wind = clock.smooth ? t * (0.8 + i * 0.3) : 0
            const x = mod(hash2(i, 602) * (SW + 80) - sc * 0.04 - wind, SW + 80) - 60
            streakCloud(s, R(x), 58 + i * 9, 30 + R(hash2(i, 603) * 40), C.dusk1, C.dusk3, C.dusk0)
        }
        rift(s, R(RIFT.x - sc * 0.02), RIFT.y, ph)
        // a skyline of needle spires, then the great towers
        band(sc * 0.08, 16, 604, (x, k, r) => {
            const h = 14 + R(r * 34)
            rect(s, x - 2, 104 - h, 5, h, C.dusk1)
            tri(s, x - 3, 104 - h, x + 3, 104 - h, x, 104 - h - 8, C.dusk1)
            if ((f + k) % 5 < 3) px(s, x, 104 - h + 5, C.sand3)
        })
        dither(s, 0, 92, SW, 14, C.dusk2, 3)
        band(sc * 0.22, 96, 605, (x, k, r) => mageTower(s, x, GROUND - 2, 56 + R(r * 26), ph, f, k))
        // the balustrade and its lamps along the far edge of the plaza
        rect(s, 0, GROUND - 7, SW, 2, C.rock2)
        rect(s, 0, GROUND - 7, SW, 1, C.rock3)
        rect(s, 0, GROUND - 2, SW, 2, C.rock2)
        band(sc * 0.45, 4, 606, (x) => rect(s, x, GROUND - 5, 2, 3, C.rock2))
        band(sc * 0.45, 58, 607, (x, k) => {
            rect(s, x - 1, GROUND - 22, 3, 22, C.rock2)
            rect(s, x - 2, GROUND - 24, 5, 2, C.rock3)
            const lit = (f + k * 5) % 16 < 14
            ditherDisc(s, x, GROUND - 27, 6, C.sand3, lit ? 5 : 3)
            disc(s, x, GROUND - 27, 2, lit ? C.sand3 : C.dusk3)
        })
        // the plaza: sunset-lit paving, a rune circle inlaid in it
        strata(s, GROUND, LIP, [C.dusk2, C.rock2, C.rock3], [0, 8, 34])
        flagstones(s, sc, GROUND + 1, LIP, 7, 30, C.rust1, C.rock3)
        dither(s, 0, GROUND, SW, 8, C.dusk3, 3)
        band(sc * 0.85, 260, 608, (x) => {
            const cy = FLOOR_Y - 12
            ellipseRing(s, x, cy, 46, 9, C.heather3)
            ellipseRing(s, x, cy, 38, 7, C.heather3)
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * TAU
                const on = (f + i) % 12 < 6
                px(s, R(x + Math.cos(a) * 42), R(cy + Math.sin(a) * 8), on ? C.sand3 : C.dusk3)
            }
            for (let i = 0; i < 3; i++) {
                const a = (i / 3 + ph / 3) * TAU
                line(s, R(x + Math.cos(a) * 38), R(cy + Math.sin(a) * 7), R(x + Math.cos(a + TAU / 3) * 38), R(cy + Math.sin(a + TAU / 3) * 7), C.heather3)
            }
        })
        // the pool's coping, then the water
        rect(s, 0, LIP, SW, FRONT - LIP, C.rock2)
        rect(s, 0, LIP, SW, 1, C.rock3)
        rect(s, 0, FRONT - 1, SW, 1, C.rust1)
        reflectWater(s, FRONT, t)
        motes(s, t, 18, 609, [C.heather3, C.dusk3], -6, 1, 30, FLOOR_Y)
        if (clock.smooth) drift(s, t, 14, 610, [C.pink, C.purple2], -10, 2, 20, GROUND)
    },
    front(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        // obelisks at both edges, runes climbing them and a crystal turning over each
        framing(sc, (o) => {
            for (const [x, h] of [[30, 118], [290, 128]] as const) {
                const tx = o + x
                const top = FLOOR_Y + 12 - h
                poly(s, [-9, 0, -6, -h, 0, -h - 10, 6, -h, 9, 0], tx, FLOOR_Y + 12, C.rock2)
                poly(s, [0, -h - 10, 6, -h, 9, 0, 2, 0], tx, FLOOR_Y + 12, C.rock3)
                line(s, tx, top - 10, tx, FLOOR_Y + 12, C.rock2)
                for (let i = 0; i < 7; i++) {
                    const on = (f + i * 2) % 16 < 9
                    rect(s, tx - 3, top + 10 + i * 14, 2, 3, on ? C.heather3 : C.dusk1)
                    rect(s, tx - 4, top + 11 + i * 14, 4, 1, on ? C.heather3 : C.dusk1)
                }
                const bob = R(Math.sin(ph * TAU + x) * 2)
                ditherDisc(s, tx, top - 22 + bob, 7, C.heather3, 4)
                poly(s, [0, -7, 4, 0, 0, 6, -4, 0], tx, top - 22 + bob, C.purple2)
                line(s, tx, top - 29 + bob, tx + 4, top - 22 + bob, C.pink)
            }
        })
    }
}

// ── 7. The Bonefields ──────────────────────────────────────────────────────────────

const RED_SUN = { x: 96, y: 86 }
/**
 * The giants' layer repeats on this period (at its own parallax). It must be at least the screen
 * plus the widest piece, so a piece only ever wraps while it is wholly off screen: at 440 the
 * fallen giant (240 px across) wrapped with half of itself in view and appeared out of nowhere.
 */
const GIANTS = 640

/** An arch of bone from ground to ground (a buried rib): thick, shaded inside, sunlit on the left. */
function boneArc(s: Surface, cx: number, base: number, rx: number, ry: number, w: number, body: number, shade: number, rim: number): void {
    const n = Math.max(12, R((rx + ry) * 0.8))
    let lx = cx - rx
    let ly = base
    for (let i = 1; i <= n; i++) {
        const a = Math.PI - (i / n) * Math.PI
        const nx = cx + Math.cos(a) * rx
        const ny = base - Math.sin(a) * ry
        const tw = Math.max(2, R(w * (0.75 + 0.25 * Math.sin(a))))
        line(s, R(lx), R(ly), R(nx), R(ny), body, tw)
        lx = nx
        ly = ny
    }
    for (let i = 1; i < n; i++) {
        const a = Math.PI - (i / n) * Math.PI
        px(s, cx + Math.cos(a) * (rx - w * 0.5), base - Math.sin(a) * (ry - w * 0.5), shade)
        if (a > Math.PI * 0.45) px(s, cx + Math.cos(a) * (rx + 0.5), base - Math.sin(a) * (ry + 0.5), rim)
    }
}

/** A skull, big-browed and eyeless: cranium, sockets, a nasal hole, a row of teeth. */
function giantSkull(s: Surface, x: number, y: number, r: number, body: number, shade: number, rim: number, hollow: number): void {
    ellipse(s, x, y, r, r * 0.82, body)
    ellipse(s, x + r * 0.15, y + r * 0.62, r * 0.62, r * 0.42, body)
    for (let a = Math.PI * 1.05; a < Math.PI * 1.7; a += 0.05) px(s, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.82, rim)
    ellipse(s, x + r * 0.35, y + r * 0.08, r * 0.5, r * 0.55, shade)
    ellipse(s, x - r * 0.25, y + r * 0.1, r * 0.26, r * 0.28, hollow)
    ellipse(s, x + r * 0.42, y + r * 0.1, r * 0.26, r * 0.28, hollow)
    tri(s, x + r * 0.05, y + r * 0.42, x + r * 0.25, y + r * 0.42, x + r * 0.15, y + r * 0.2, hollow)
    const ty = R(y + r * 0.78)
    for (let i = 0; i < 6; i++) rect(s, R(x - r * 0.28 + i * r * 0.14), ty, Math.max(1, R(r * 0.1)), R(r * 0.2), i & 1 ? shade : body)
    rect(s, R(x - r * 0.3), ty - 1, R(r * 0.9), 1, hollow)
}

/**
 * A skull lying on the back of its head with the face turned up to the sky. It is drawn as an
 * ordinary side-on skull facing right (local `a` forward, `b` up) turned a quarter to the left,
 * so the face points up, the crown rests toward the left and the neck meets the spine on the
 * right: cranium, brow, eye socket, nose, cheekbone, upper teeth and a jaw fallen open.
 */
function skullUp(s: Surface, x: number, y: number, r: number, body: number, shade: number, rim: number, hollow: number): void {
    const P = (pts: readonly number[]): number[] => {
        const out: number[] = []
        for (let i = 0; i < pts.length; i += 2) out.push(R(-pts[i + 1]! * r), R(-pts[i]! * r))
        return out
    }
    const E = (a: number, b: number, ra: number, rb: number, c: number) => ellipse(s, x - b * r, y - a * r, rb * r, ra * r, c)
    // the jaw first, fallen open, so the skull sits over its hinge
    poly(s, P([0.2, -0.55, 0.42, -0.66, 0.98, -1.28, 0.86, -1.42, 0.12, -0.86]), x, y, body)
    for (let i = 0; i < 4; i++) E(0.48 + i * 0.13, -0.76 - i * 0.15, 0.05, 0.04, i & 1 ? shade : rim)
    poly(s, P([0.12, -0.86, 0.86, -1.42, 0.8, -1.46, 0.08, -0.92]), x, y, shade)
    // cranium and face
    E(0, 0.15, 0.95, 0.8, body)
    poly(s, P([0.4, 0.3, 1.05, 0.15, 1.12, -0.3, 1.02, -0.52, 0.96, -0.74, 0.35, -0.72, 0.25, -0.3]), x, y, body)
    // the rest of the head in shade where it lies, the temple hollow, the cheekbone
    E(-0.55, 0, 0.35, 0.6, shade)
    E(0.2, 0.05, 0.25, 0.2, shade)
    poly(s, P([0.3, -0.3, 0.85, -0.28, 0.85, -0.4, 0.3, -0.45]), x, y, shade)
    // the eye socket and the nose, both open to the sky
    E(0.7, 0.02, 0.27, 0.25, hollow)
    E(0.62, 0.08, 0.1, 0.08, shade)
    poly(s, P([1.08, -0.18, 1.1, -0.42, 0.92, -0.36]), x, y, hollow)
    // the upper teeth
    for (let i = 0; i < 5; i++) E(0.45 + i * 0.12, -0.78, 0.05, 0.06, i & 1 ? shade : rim)
    // the lit edge: the top of the head, which faces the sun on the left
    for (let t = 0.1; t < 0.95; t += 0.03) {
        const a = Math.cos(t * Math.PI) * 0.95
        const b = 0.15 + Math.sin(t * Math.PI) * 0.8
        px(s, x - b * r, y - a * r, rim)
    }
}

/** A long bone between two points, knobbed at both ends, lit along its upper edge. */
function longBone(s: Surface, x0: number, y0: number, x1: number, y1: number, w: number, body: number, rim: number): void {
    line(s, R(x0), R(y0), R(x1), R(y1), body, w)
    disc(s, x0, y0, w * 0.8, body)
    disc(s, x1, y1, w * 0.8, body)
    line(s, R(x0 - 1), R(y0 - 1), R(x1 - 1), R(y1 - 1), rim)
}

/**
 * The colossal greatsword, planted at an angle: the blade buried at (x, ground), leaning `lean`
 * radians off upright, notched along its edges, with a long guard, a wrapped grip and a pommel.
 * Silhouetted against the sunset, the sun's edge lit.
 */
function greatsword(s: Surface, x: number, ground: number, len: number, lean: number, bw = len * 0.1, gw = len * 0.34): void {
    const dx = Math.sin(lean)
    const dy = -Math.cos(lean)
    const at = (u: number, side: number): [number, number] => [x + dx * u - dy * side, ground + dy * u + dx * side]
    const [b0x, b0y] = at(0, -bw)
    const [b1x, b1y] = at(0, bw)
    const [t0x, t0y] = at(len, -bw - 1)
    const [t1x, t1y] = at(len, bw + 1)
    quad(s, b0x, b0y, b1x, b1y, t1x, t1y, t0x, t0y, C.heather1)
    const [f0x, f0y] = at(4, 0)
    const [f1x, f1y] = at(len - 6, 0)
    line(s, R(f0x), R(f0y), R(f1x), R(f1y), C.heather0, 3)
    line(s, R(b0x), R(b0y), R(t0x), R(t0y), C.dusk3)
    // notches hacked out of the edges
    for (let i = 0; i < 4; i++) {
        const u = len * (0.2 + i * 0.19)
        const side = (i & 1 ? 1 : -1) * (bw + 1)
        const [nx, ny] = at(u, side)
        const [mx, my] = at(u + 4, side * 0.5)
        const [ox, oy] = at(u + 8, side)
        tri(s, nx, ny, mx, my, ox, oy, C.dusk2)
    }
    // the guard, the grip, the pommel
    const [g0x, g0y] = at(len, -gw)
    const [g1x, g1y] = at(len, gw)
    line(s, R(g0x), R(g0y), R(g1x), R(g1y), C.heather0, 6)
    line(s, R(g0x), R(g0y - 2), R(g1x), R(g1y - 2), C.dusk3)
    const [e0x, e0y] = at(len - 6, -gw - 2)
    const [e1x, e1y] = at(len - 6, gw + 2)
    disc(s, e0x, e0y, 3.5, C.heather0)
    disc(s, e1x, e1y, 3.5, C.heather0)
    const [h0x, h0y] = at(len + 3, 0)
    const [h1x, h1y] = at(len + 26, 0)
    line(s, R(h0x), R(h0y), R(h1x), R(h1y), C.rust0, 6)
    for (let u = 5; u < 26; u += 4) {
        const [wx, wy] = at(len + u, 0)
        line(s, R(wx - 3), R(wy), R(wx + 3), R(wy - 1), C.rust1)
    }
    const [p0x, p0y] = at(len + 32, 0)
    disc(s, p0x, p0y, 6, C.heather0)
    disc(s, p0x - 1, p0y - 1, 2, C.dusk3)
}

/**
 * The giants' battle, far off: a giant fallen on its back along the ridge, face to the sky and
 * knees raised, a greatsword driven through its ribcage into the ground and the fingertips of
 * its far hand still curled round the blade; a second giant's
 * helmed skull and a giant spear further along.
 */
function giants(s: Surface, ox: number, ground: number): void {
    // where a piece spanning [x - left, x + right] stands, wrapping only once it is out of view;
    // GIANTS covers SW + left + right for every piece, so this window never wraps one in view
    const place = (gx: number, _left: number, right: number) => R(mod(gx - ox + right, GIANTS) - right)
    const bone = C.rock3
    const shade = C.rock2
    const rim = C.sand3
    // the giant spear, driven in slantwise
    const sp = place(34, 6, 56)
    line(s, sp, ground, sp + 40, ground - 70, C.rust0, 3)
    poly(s, [0, 0, 5, -3, 12, -14, 2, -6], sp + 40, ground - 70, C.heather0)
    line(s, sp + 40, ground - 71, sp + 51, ground - 84, C.dusk3)
    // The fallen giant, on its back along the ridge: skull toward the sun, ribcage arching up
    // off the spine, knees raised, a greatsword driven down through its chest and one hand
    // still gripping the blade.
    const g = place(200, 150, 90)
    // the legs first, so the pelvis sits over the hip joints: thigh up to a raised knee, shin
    // down to the foot; the far leg a little lower
    for (const [kx, ky, fx, w] of [[34, -30, 58, 7], [50, -44, 74, 8]] as const) {
        longBone(s, g + 14, ground - 8, g + kx, ground + ky, w, w === 7 ? shade : bone, rim)
        longBone(s, g + kx, ground + ky, g + fx, ground - 3, w - 1, w === 7 ? shade : bone, rim)
        disc(s, g + kx, ground + ky, w * 0.9, w === 7 ? shade : bone)
        px(s, g + kx - 1, ground + ky - 2, rim)
        ellipse(s, g + fx + 4, ground - 2, 6, 2, w === 7 ? shade : bone)
    }
    // spine and pelvis
    rect(s, g - 94, ground - 5, 110, 3, shade)
    for (let x = g - 92; x < g + 14; x += 5) rect(s, x, ground - 7, 3, 3, bone)
    ellipse(s, g + 14, ground - 9, 10, 7, bone)
    ellipse(s, g + 15, ground - 9, 4, 3, shade)
    for (let a = Math.PI * 1.1; a < Math.PI * 1.7; a += 0.1) px(s, g + 14 + Math.cos(a) * 10, ground - 9 + Math.sin(a) * 7, rim)
    // The greatsword first: driven down through the chest into the ground, so the ribs and the
    // breastbone drawn over it read as the cage it passes through.
    const lean = 0.3
    const sx = g - 51
    const sy = ground - 2
    const on = (u: number, side: number): [number, number] => [sx + Math.sin(lean) * u + Math.cos(lean) * side, sy - Math.cos(lean) * u + Math.sin(lean) * side]
    // the far (left) arm reaching up behind the cage, drawn before the sword so the blade hides
    // the wrist and the hand closed round it
    const [hx, hy] = on(54, 0)
    longBone(s, g - 80, ground - 20, g - 64, ground - 56, 5, shade, rim)
    longBone(s, g - 64, ground - 56, hx, hy + 2, 4, shade, rim)
    greatsword(s, sx, sy, 87, lean, 6.4, 22)
    // the ribcage, rising off the spine, a breastbone along the top
    for (let i = 0; i < 7; i++) {
        const cx = g - 78 + i * 10
        const ry = 26 - Math.abs(i - 2.5) * 3
        boneArc(s, cx, ground - 4, 6, ry, 3, bone, shade, rim)
    }
    line(s, g - 84, ground - 26, g - 16, ground - 24, shade, 2)
    line(s, g - 84, ground - 27, g - 16, ground - 25, bone)
    // only the tips show: the thumb over one edge of the blade, the fingers round the other
    const [t0x, t0y] = on(57, -9)
    const [t1x, t1y] = on(56, -4)
    line(s, R(t0x), R(t0y), R(t1x), R(t1y), bone, 2)
    px(s, R(t1x), R(t1y) + 1, shade)
    px(s, R(t0x), R(t0y) - 1, rim)
    for (let i = 0; i < 4; i++) {
        const [ax, ay] = on(49 + i * 3.4, 2)
        const [bx, by] = on(48 + i * 3.4, 8)
        line(s, R(ax), R(ay), R(bx), R(by), bone, 2)
        px(s, R(bx), R(by) + 1, shade)
        px(s, R(ax), R(ay) - 1, rim)
    }
    // the near (right) arm flung out along the ground
    longBone(s, g - 88, ground - 8, g - 108, ground - 1, 5, bone, rim)
    longBone(s, g - 108, ground - 1, g - 132, ground - 3, 4, bone, rim)
    for (let i = 0; i < 4; i++) line(s, g - 132, ground - 3, g - 140 - i, ground - 7 + i * 2, bone, 2)
    // the head, lying on its crown's back with the face to the sky
    // the neck, then the head
    rect(s, g - 94, ground - 7, 8, 3, bone)
    skullUp(s, g - 112, ground - 16, 21, bone, shade, rim, C.heather0)
    // the second giant: a skull still in its horned helm, half sunk into the ridge
    const h = place(318, 28, 24)
    giantSkull(s, h, ground - 6, 12, bone, shade, rim, C.heather0)
    dome(s, h - 1, ground - 12, 14, 12, C.heather1)
    rect(s, h - 15, ground - 13, 30, 3, C.heather0)
    line(s, h - 12, ground - 20, h - 24, ground - 36, C.heather1, 3)
    line(s, h + 11, ground - 20, h + 20, ground - 38, C.heather1, 3)
    line(s, h - 12, ground - 22, h - 23, ground - 37, C.dusk3)
}

/** A giant's hand clawing up out of the earth, forearm first, fingers curled. */
function boneHand(s: Surface, x: number, base: number): void {
    const body = C.rock3
    const shade = C.rock2
    const rim = C.sand3
    longBone(s, x - 3, base, x - 1, base - 44, 4, body, rim)
    longBone(s, x + 4, base, x + 5, base - 42, 3, shade, rim)
    ellipse(s, x + 2, base - 50, 8, 6, body)
    for (let a = Math.PI * 1.1; a < Math.PI * 1.6; a += 0.1) px(s, x + 2 + Math.cos(a) * 8, base - 50 + Math.sin(a) * 6, rim)
    // four fingers, three joints each, curling forward; the thumb out to the side
    for (let k = 0; k < 4; k++) {
        let fx = x - 5 + k * 4.5
        let fy = base - 55
        let a = -Math.PI / 2 - 0.35 + k * 0.22
        const len = [7, 9, 8, 6][k]!
        for (let j = 0; j < 3; j++) {
            const nx = fx + Math.cos(a) * len * (1 - j * 0.2)
            const ny = fy + Math.sin(a) * len * (1 - j * 0.2)
            line(s, R(fx), R(fy), R(nx), R(ny), body, 3)
            disc(s, nx, ny, 1.5, shade)
            px(s, nx - 1, ny - 1, rim)
            fx = nx
            fy = ny
            a += 0.75
        }
    }
    longBone(s, x - 5, base - 48, x - 15, base - 58, 3, body, rim)
    line(s, x - 15, base - 58, x - 17, base - 64, body, 2)
}

/**
 * The Bonefields, where giants fought and fell: a blood sunset, a colossal greatsword planted
 * slantwise in the far ridge with its owner's skeleton slumped at its foot and ribs lying against
 * the sun, another giant's helmed skull and spear beyond, the small spears of a mortal host on
 * the near ridge for scale, a churned field with the giants' bones breaking through it, a buried
 * ribcage and a skeletal hand framing it and a trench of the dead in front. The field is dark
 * earth so the pale legionnaires stand out of it.
 */
export const bonefields: WorldScene = {
    id: 'world_the_bonefields',
    tiered: true,
    draw(s, sc, t) {
        const f = loopFrame(t)
        sky(s, [C.heather0, C.dusk0, C.dusk1, C.rust2, C.dusk2, C.dusk3], [0, 18, 38, 58, 76, 92])
        glow(s, RED_SUN.x, RED_SUN.y, 24, C.dusk3, C.red2, C.red3)
        disc(s, RED_SUN.x - 6, RED_SUN.y - 8, 7, C.gold3)
        for (let i = 0; i < 4; i++) rect(s, RED_SUN.x - 30 + i * 5, RED_SUN.y - 10 + i * 7, 50 - i * 6, 1 + (i & 1), C.dusk1)
        for (let i = 0; i < 5; i++) {
            const wind = clock.smooth ? t * (1 + i * 0.4) : 0
            const x = mod(hash2(i, 701) * (SW + 80) - sc * 0.05 - wind, SW + 80) - 60
            streakCloud(s, R(x), 16 + i * 11, 36 + R(hash2(i, 702) * 44), C.dusk1, C.dusk3, C.dusk0)
        }
        if (clock.smooth) flock(s, t, sc, 11, 30, 5, C.rust0)
        ridge(s, sc * 0.06, 100, 12, 90, 703, C.heather1, C.dusk2)
        giants(s, sc * 0.12, 104)
        // the near ridge buries the giants' feet; the mortal host's spears stand on it, tiny
        ridge(s, sc * 0.18, 108, 6, 60, 705, C.dusk0, C.dusk2)
        band(sc * 0.3, 4, 706, (x, k, r) => {
            const h = 6 + R(r * 7)
            const lean = R((hash2(k, 707) - 0.5) * 3)
            line(s, x, GROUND, x + lean, GROUND - h, C.rust0)
            px(s, x + lean, GROUND - h - 1, C.sand3)
            if (k % 13 === 0) {
                const wave = (f >> 2) & 1
                poly(s, [0, 0, 5, 1 + wave, 4, 3, 5, 5 - wave, 0, 5], x + lean + 1, GROUND - h + 1, C.rust1)
            }
        })
        rect(s, 0, GROUND - 3, SW, 3, C.rust0)
        // the field: churned earth, ruts, red-lit pools, and the giants' bones breaking through
        strata(s, GROUND, LIP, [C.rust1, C.rust0], [0, 26])
        rect(s, 0, GROUND, SW, 1, C.rust2)
        scatter(sc, GROUND + 3, FLOOR_Y + 8, 7, 22, 708, (x, y, k, r) => {
            rect(s, x, y, 6 + R(r * 10), 1, k & 1 ? C.rust2 : C.rust0)
        })
        scatter(sc, GROUND + 8, FLOOR_Y + 4, 4, 66, 709, (x, y, k, r) => {
            const w = 7 + R(r * 9)
            ellipse(s, x, y, w, 1.5, C.dusk2)
            rect(s, x - w + 2, y, w, 1, C.dusk3)
            if ((f + k * 3) % 16 < 8) px(s, x + 2, y, C.sand3)
        })
        scatter(sc, GROUND + 6, FLOOR_Y + 4, 3, 86, 710, (x, y, _k, r) => {
            const d = (y - GROUND) / (LIP - GROUND)
            if (r < 0.45) {
                // a giant's rib tips, breaking the surface in a row
                for (let i = 0; i < 3; i++) boneArc(s, x + i * R(5 + d * 4), y, 2 + d * 2, 4 + d * 5 - i, 2, C.rock3, C.rock2, C.sand3)
            } else if (r < 0.75) {
                // a vertebra the size of a shield
                ellipse(s, x, y - 2, 4 + d * 3, 2 + d * 2, C.rock3)
                rect(s, x - 1, R(y - 5 - d * 4), 3, R(3 + d * 3), C.rock3)
                px(s, x - 2, y - 2, C.rock2)
                px(s, x - 3, y - 3, C.sand3)
            } else {
                // a mortal spear, broken
                line(s, x - 6, y, x + 6, y - 3, C.rust2)
                px(s, x + 7, y - 4, C.rock3)
            }
        })
        scatter(sc, GROUND + 6, FLOOR_Y + 6, 4, 30, 711, (x, y) => {
            for (let i = 0; i < 3; i++) line(s, x + i * 2, y, x + i * 2 - 1, y - 2 - (i & 1), C.moss1)
        })
        // a trench of the dead in front
        strata(s, LIP, SH, [C.rust0, C.rock0], [0, 8])
        rect(s, 0, LIP, SW, 1, C.rust2)
        band(sc * 1.15, 9, 712, (x, k, r) => {
            const y = LIP + 6 + R(r * 12)
            if (k % 3 === 0) {
                disc(s, x, y, 3, C.bone1)
                rect(s, x - 2, y + 2, 5, 2, C.bone0)
                px(s, x - 1, y, C.ink); px(s, x + 1, y, C.ink)
            } else {
                line(s, x - 5, y, x + 5, y - 2 + (k & 3), C.bone0, 2)
                px(s, x - 5, y - 1, C.bone1); px(s, x + 5, y - 3 + (k & 3), C.bone1)
            }
        })
        dither(s, 0, LIP + 2, SW, SH - LIP, C.dusk1, 2)
        motes(s, t, 20, 713, [C.dusk3, C.sand3], -3, 4, 60, FLOOR_Y)
    },
    front(s, sc, _t) {
        // a giant's ribcage half-buried at one edge, both ends of each rib in the ground so it
        // reads whole; a skeletal hand clawing up at the other
        framing(sc, (o) => {
            const base = FLOOR_Y + 12
            for (let i = 0; i < 5; i++) boneArc(s, o + 10 + i * 11, base, 12 - i * 1.2, 70 - i * 11, 5 - (i >> 1), C.rock3, C.rock2, C.sand3)
            rect(s, o - 2, base - 4, 64, 5, C.rock2)
            for (let i = 0; i < 8; i++) {
                rect(s, o + i * 8, base - 6, 6, 4, C.rock3)
                px(s, o + i * 8, base - 6, C.sand3)
            }
            boneHand(s, o + 280, base)
            ellipse(s, o + 281, base, 14, 3, C.rust0)
        })
    }
}

// ── 8. The Shattered Sky ───────────────────────────────────────────────────────────

/** The colours of a floating island at one depth: nearer islands darker and greener, far ones hazed. */
interface IslePal { rock: number, dark: number, lit: number, earth: number, grass: number, grassLit: number, root: number }
const ISLE_FAR: IslePal = { rock: C.slate2, dark: C.slate1, lit: C.slate3, earth: C.slate1, grass: C.lagoon2, grassLit: C.lagoon3, root: C.slate1 }
const ISLE_MID: IslePal = { rock: C.rock2, dark: C.rock1, lit: C.rock3, earth: C.rust1, grass: C.moss2, grassLit: C.moss3, root: C.rock1 }
const ISLE_NEAR: IslePal = { rock: C.rock1, dark: C.rock0, lit: C.rock2, earth: C.rust1, grass: C.moss2, grassLit: C.moss3, root: C.rust0 }

/** What stands on an island. */
const enum Top { None, Pine, Tree, Ruin }

/**
 * A floating island torn loose from the ground: a grass cap spilling over its edges, a band of
 * earth, then layered rock hanging down in jagged spikes, lit on the sun's side (upper right) and
 * shaded on the other, roots dangling and loose rocks drifting beneath it. `fall` pours a
 * waterfall off its right edge.
 */
function island(s: Surface, x: number, y: number, w: number, ph: number, f: number, seed: number, pal: IslePal, fall: boolean, top: Top): void {
    const depth = w * 0.95
    let deepest = y
    let deepX = x
    for (let dx = -w; dx <= w; dx++) {
        const u = dx / w
        const g = Math.floor((dx + w) / 3)
        let d = depth * Math.pow(1 - Math.abs(u), 0.6) * (0.6 + 0.4 * hash2(seed, g >> 1))
        // stalactite spikes, each three columns wide and pointed
        if (hash2(seed + 1, g) > 0.62) d += depth * 0.3 * (1 - Math.abs(u)) * (1 - Math.abs(((dx + w) % 3) - 1) * 0.6)
        const bottom = R(y + 2 + d)
        if (bottom > deepest) { deepest = bottom; deepX = x + dx }
        for (let yy = y + 1; yy <= bottom; yy++) {
            const v = (yy - y) / (depth + 1)
            let c = pal.rock
            if (u < -0.15 + v * 0.5) c = pal.dark
            else if (u > 0.6 - v * 0.3) c = pal.lit
            // the rock is laid down in beds: a darker seam every few rows, offset per column group
            if ((yy - y + R(hash2(seed + 2, g) * 2)) % 4 === 0) c = c === pal.lit ? pal.rock : pal.dark
            if (yy >= bottom - 1) c = pal.dark
            if (yy <= y + 2) c = pal.earth
            s.set(x + dx, yy, c)
        }
    }
    // the grass cap, spilling a little over the edges
    rect(s, x - w - 1, y - 2, w * 2 + 3, 3, pal.grass)
    rect(s, x - w, y - 2, w * 2 + 1, 1, pal.grassLit)
    for (let dx = -w; dx <= w; dx += 2) if (hash2(seed + 3, dx) < 0.35) rect(s, x + dx, y + 1, 1, 1 + R(hash2(seed + 4, dx) * 3), pal.grass)
    px(s, x - w - 2, y - 1, pal.grass); px(s, x + w + 2, y - 1, pal.grass)
    // roots dangling from the underside, swaying on the loop
    for (let i = 0; i < 3; i++) {
        const rx = x + R((hash2(seed + 5, i) - 0.5) * w * 1.2)
        const len = 4 + R(hash2(seed + 6, i) * w * 0.4)
        const ry = R(y + depth * 0.45 * (1 - Math.abs(rx - x) / w))
        const sway = R(Math.sin(ph * TAU + i + seed) * 1.2)
        line(s, rx, ry, rx + sway, ry + len, pal.root)
    }
    // loose rocks drifting under it
    for (let i = 0; i < 2; i++) {
        const bx = deepX + (i ? 5 : -4) + R(hash2(seed + 7, i) * 3)
        const by = deepest + 4 + i * 3 + R(Math.sin(ph * TAU + i * 2 + seed) * 1.5)
        const r = Math.max(1, R(w * 0.08)) + i
        rect(s, bx - r, by - r + 1, r * 2, r, pal.rock)
        rect(s, bx - r, by - r, r * 2, 1, pal.grass)
        px(s, bx + r - 1, by, pal.dark)
    }
    // what stands on it
    if (top === Top.Pine) {
        const tx = x - R(w * 0.35)
        const h = 8 + R(w * 0.45)
        tri(s, tx - R(h * 0.35), y - 2, tx + R(h * 0.35), y - 2, tx, y - 2 - h, C.moss1)
        line(s, tx, y - 2 - h, tx + R(h * 0.3), y - 4, C.moss3)
        if (w > 10) {
            const t2 = tx + 6
            tri(s, t2 - 3, y - 2, t2 + 3, y - 2, t2, y - 2 - R(h * 0.6), C.moss1)
        }
    } else if (top === Top.Tree) {
        const tx = x + R(w * 0.2)
        line(s, tx, y - 2, tx, y - 9, C.rust0, 2)
        disc(s, tx, y - 12, 5, C.moss1)
        disc(s, tx + 1, y - 13, 3, C.moss2)
        px(s, tx + 3, y - 15, C.moss3); px(s, tx + 4, y - 13, C.moss3)
    } else if (top === Top.Ruin) {
        // two broken pillars and a fallen lintel
        rect(s, x - 9, y - 20, 5, 18, C.rock1)
        rect(s, x - 5, y - 20, 1, 18, C.rock2)
        rect(s, x - 10, y - 22, 7, 2, C.rock2)
        rect(s, x + 4, y - 13, 5, 11, C.rock1)
        rect(s, x + 8, y - 13, 1, 11, C.rock2)
        poly(s, [0, 0, 5, -2, 5, 0], x + 4, y - 13, C.rock1)
        rect(s, x - 2, y - 4, 12, 2, C.rock2)
    }
    if (fall) {
        const fx = x + w
        rect(s, fx - 1, y - 2, 3, 2, C.lagoon3)
        for (let yy = y; yy < y + 64; yy++) {
            const lv = R(13 - (yy - y) * 0.2)
            if (lv <= 0) break
            const sx = fx + (yy > y + 3 ? 1 : 0)
            if (bayer(sx, yy, lv)) s.set(sx, yy, mod(yy - f * 2, 6) < 2 ? C.ice3 : C.lagoon3)
            if (bayer(sx + 1, yy, lv - 3)) s.set(sx + 1, yy, C.lagoon3)
        }
    }
}

/**
 * A storm cumulus: lobes piled into a dome over a flat base, the underside in shadow, each lobe
 * lit toward the sun (upper right) with a bright rim. `rim` warms to gold near the sun; `flash`
 * lights the whole cloud when the lightning goes.
 */
function cumulus(s: Surface, cx: number, cy: number, w: number, seed: number, rim: number, flash: boolean): void {
    const n = 4 + Math.floor(w / 14)
    const LX = CUM_X
    const LY = CUM_Y
    const LR = CUM_R
    for (let i = 0; i < n; i++) {
        const u = i / (n - 1)
        const arch = Math.sin(u * Math.PI)
        LR[i] = w * 0.13 * (0.6 + 0.7 * arch) * (0.85 + 0.3 * hash2(seed, i))
        LX[i] = cx - w / 2 + u * w
        LY[i] = cy - LR[i]! * 0.35 - arch * w * 0.08
    }
    const body = flash ? C.slate2 : C.slate1
    const lit = flash ? C.slate3 : C.slate2
    // the shadowed base: a flat underside, lobes pressed down onto it
    for (let i = 0; i < n; i++) disc(s, LX[i]!, LY[i]! + 3, LR[i]!, C.slate0)
    rect(s, R(cx - w / 2), R(cy), R(w), 3, C.slate0)
    dither(s, R(cx - w / 2 + 3), R(cy + 3), R(w - 6), 2, C.slate0, 6)
    for (let i = 0; i < n; i++) disc(s, LX[i]!, LY[i]!, LR[i]!, body)
    for (let i = 0; i < n; i++) disc(s, LX[i]! + LR[i]! * 0.25, LY[i]! - LR[i]! * 0.3, LR[i]! * 0.62, lit)
    for (let i = 0; i < n; i++) {
        for (let a = -Math.PI * 0.95; a < -Math.PI * 0.05; a += 0.12) {
            const k = (a + Math.PI) / Math.PI
            if (k > 0.25) px(s, LX[i]! + Math.cos(a) * LR[i]!, LY[i]! + Math.sin(a) * LR[i]!, rim)
        }
    }
}
const CUM_X = new Float32Array(16)
const CUM_Y = new Float32Array(16)
const CUM_R = new Float32Array(16)

/** A lightning fork from (x, 0) to `bottom`, on the frames the storm strikes. */
function lightning(s: Surface, x: number, bottom: number, seed: number): void {
    let lx = x
    for (let y = 0; y < bottom; y += 4) {
        const nx = lx + R((hash2(seed, y) - 0.5) * 8)
        line(s, lx, y, nx, y + 4, C.white)
        line(s, lx + 1, y, nx + 1, y + 4, C.cyan)
        if (hash2(seed + 1, y) < 0.12) line(s, nx, y + 4, nx + 8, y + 12, C.frost)
        lx = nx
    }
}

/**
 * The Shattered Sky in a breaking storm: churning cloud split by a shaft of sun, lightning on
 * the loop, islands of torn-loose ground adrift at three depths with waterfalls pouring off into
 * nothing, and the party on a grassy island of its own whose broken underside hangs over the
 * clouds below. Wind-bent pines frame it. The island is green and earth, clear of the Wisps'
 * storm greys.
 */
export const shatteredSky: WorldScene = {
    id: 'world_the_shattered_sky',
    tiered: true,
    draw(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        const strike = f === 5 || f === 6
        sky(s, [C.ink, C.slate0, C.slate1, C.slate2, C.sky1, C.sky2], [0, 14, 34, 58, 82, 100])
        // the break in the storm and the sun pouring through it
        ditherDisc(s, 250, 20, 30, C.sand3, 3)
        glow(s, 250, 20, 9, C.sand3, C.gold3, C.white)
        // beams fanning down through the break: wide and faint, fading with distance, rather than
        // thin dotted lines across the fight
        for (let i = 0; i < 4; i++) {
            const a = Math.PI * (0.56 + i * 0.12)
            for (let r = 14; r < 140; r += 1) {
                const lv = R(3.4 - r / 45)
                const hw = 2 + r * 0.09
                if (lv > 0) dither(s, R(250 + Math.cos(a) * r - hw), R(20 + Math.sin(a) * r), R(hw * 2), 1, C.sand3, lv)
            }
        }
        // storm cumulus, lit toward the sun and rimmed gold near it, flaring when the lightning goes
        for (let i = 0; i < 7; i++) {
            const wind = clock.smooth ? t * (2 + i * 0.6) : 0
            const w = 44 + R(hash2(i, 815) * 40)
            const cx = mod(hash2(i, 801) * (SW + 160) - sc * 0.04 - wind, SW + 160) - 80
            const cy = 22 + (i % 4) * 11 + R(hash2(i, 816) * 4)
            const nearSun = Math.hypot(cx - 250, cy - 20) < 80
            cumulus(s, cx, cy, w, i * 7 + 3, strike ? C.ice3 : nearSun ? C.sand3 : C.slate3, strike)
        }
        if (strike) lightning(s, R(70 - sc * 0.02), 92, 802)
        // islands adrift at three depths
        band(sc * 0.06, 80, 803, (x, k, r) => island(s, x, R(56 + r * 26 + Math.sin(ph * TAU + k) * 1), 8 + R(r * 5), ph, f, k, ISLE_FAR, r > 0.6, r > 0.35 ? Top.Pine : Top.None))
        band(sc * 0.14, 120, 804, (x, k, r) => island(s, x, R(70 + r * 16 + Math.sin(ph * TAU + k * 2) * 1.5), 15 + R(r * 6), ph, f, k + 30, ISLE_MID, r > 0.4, k % 3 === 0 ? Top.Tree : Top.Pine))
        band(sc * 0.26, 200, 805, (x, k) => {
            const y = R(86 + Math.sin(ph * TAU + k) * 2)
            island(s, x, y, 26, ph, f, k + 60, ISLE_NEAR, true, Top.Ruin)
            for (let i = 0; i < 10; i++) px(s, x + 26 + i * 3, y + 2 + R(Math.sin(i * 0.5) * 3) + i, C.rock0)
        })
        // our island: a grassy top combed by the wind
        strata(s, GROUND, LIP, [C.moss2, C.moss1], [0, 30])
        rect(s, 0, GROUND - 1, SW, 2, C.moss3)
        band(sc * 0.6, 3, 806, (x, k) => { if (k % 4 !== 0) px(s, x, GROUND - 2, C.moss3) })
        scatter(sc, GROUND + 3, FLOOR_Y + 8, 7, 8, 807, (x, y, k, r) => {
            const sway = ((f >> 1) + k) & 3
            line(s, x, y, x - 2 - (sway === 0 ? 1 : 0), y - 2 - R(r * 2), r < 0.5 ? C.moss3 : C.moss1)
            if (r > 0.94) px(s, x - 2, y - 3, C.sand3)
        })
        scatter(sc, GROUND + 8, FLOOR_Y + 4, 3, 90, 808, (x, y, k) => {
            ellipse(s, x, y - 1, 4 + (k & 1), 2.5, C.rock1)
            rect(s, x - 3, y - 3, 5, 1, C.moss3)
        })
        // the island's broken underside, hanging over the clouds far below
        strata(s, LIP, SH, [C.sky1, C.slate2], [0, 12])
        for (let i = 0; i < 6; i++) {
            const x = mod(hash2(i, 809) * (SW + 60) - sc * 0.3, SW + 60) - 30
            ellipse(s, x, SH - 2, 26, 6, C.slate3)
            ellipse(s, x + 4, SH, 22, 4, C.sky2)
        }
        // Built like the islands behind: a grass lip, a band of earth with stones in it, then bedded
        // rock with seams and cracks, lit toward the sun, breaking off into hanging spikes.
        const isc = R(sc)
        for (let x = 0; x < SW; x++) {
            const wx = x + isc
            const g = Math.floor(wx / 3)
            let d = 8 + R(vnoise(wx, 14, 810) * 11) + R(vnoise(wx, 5, 811) * 4)
            if (hash2(g, 817) > 0.68) d += R(6 * (1 - Math.abs(mod(wx, 3) - 1) * 0.6))
            const crack = hash2(g, 818) < 0.1
            // the beds undulate along the cliff rather than running as straight stripes
            const off = R(vnoise(wx, 26, 825) * 5)
            for (let k = 1; k < d && LIP + k < SH; k++) {
                let c: number
                if (k < 5) c = hash2(wx, k * 7 + 819) < 0.12 ? C.rust2 : C.rust1
                else {
                    const kk = k + off
                    c = Math.floor(kk / 4) & 1 ? C.rock1 : C.rock2
                    // a broken seam between beds, and the ledge under it catching the light
                    if (kk % 4 === 0 && hash2(g, kk) < 0.75) c = C.rock0
                    else if (kk % 4 === 1 && hash2(g + 1, kk) < 0.3) c = C.rock3
                    if (crack && k > 6) c = C.rock0
                }
                if (k >= d - 2) c = C.rock0
                s.set(x, LIP + k, c)
            }
        }
        // stones set in the earth
        band(sc, 17, 821, (x, k) => {
            const y = LIP + 2 + (k % 3)
            rect(s, x - 1, y, 3 + (k & 1), 2, C.rock2)
            px(s, x - 1, y, C.rock3)
        })
        // the grass lip, dripping over the edge
        rect(s, 0, LIP, SW, 1, C.moss2)
        band(sc, 4, 822, (x, k, r) => rect(s, x, LIP + 1, 1, 1 + R(r * 3), k & 1 ? C.moss1 : C.moss2))
        // roots swaying under it, and loose rocks drifting below
        band(sc, 23, 823, (x, k, r) => {
            const len = 5 + R(r * 9)
            const top = LIP + 12
            const sway = R(Math.sin(ph * TAU + k) * 1.2)
            line(s, x, top, x + sway, top + len, k % 3 ? C.rust0 : C.moss1)
        })
        band(sc * 1.05, 70, 824, (x, k, r) => {
            const y = SH - 5 + R(Math.sin(ph * TAU + k * 2) * 1.5) - R(r * 4)
            rect(s, x - 2, y, 5, 3, C.rock1)
            rect(s, x - 2, y, 5, 1, C.rock2)
            px(s, x + 2, y + 2, C.rock0)
        })
        motes(s, t, 16, 812, [C.moss3, C.sand3], 4, -30, 20, FLOOR_Y)
        if (clock.smooth) {
            for (let i = 0; i < 10; i++) {
                const x = R(mod(hash2(i, 813) * SW - t * 160, SW + 40) - 20)
                const y = R(20 + hash2(i, 814) * (FLOOR_Y - 20))
                rect(s, x, y, 8 + (i % 3) * 4, 1, C.ice3)
            }
        }
    },
    front(s, sc, t) {
        const ph = phase(t)
        // wind-bent pines at the edges, a loose boulder drifting over each
        framing(sc, (o) => {
            for (const [x, h, lean] of [[14, 100, 14], [40, 60, 8], [300, 110, 16]] as const) {
                const tx = o + x
                taper(s, tx, FLOOR_Y + 12, tx + lean, FLOOR_Y + 12 - h, 4, 2, C.rust0)
                const tiers = Math.floor(h / 10)
                for (let k = 0; k < tiers; k++) {
                    const u = k / tiers
                    const cx = tx + lean * (1 - u) + 2
                    const cy = FLOOR_Y + 12 - h + k * 9
                    const w = 4 + k * 1.8
                    tri(s, cx - w * 0.5, cy + 8, cx + w * 1.4, cy + 8, cx + 2, cy, C.moss0)
                    line(s, cx + 2, cy + 1, cx + w * 1.2, cy + 7, C.moss2)
                }
            }
            const by = R(40 + Math.sin(ph * TAU) * 2)
            poly(s, [-10, 0, 10, 0, 6, 8, 0, 12, -7, 7], o + 60, by, C.rock1)
            rect(s, o + 50, by - 1, 21, 2, C.moss2)
        })
    }
}

// ── 9. The Brink ───────────────────────────────────────────────────────────────────

/** The Void on the far horizon, small: what World 10 arrives at. Everything here falls toward it. */
const VOID_FAR = { x: 232, y: 60 }

/** The Void seen from afar: a small black hole, its disk turning on the loop, a haze of light. */
function distantHole(s: Surface, x: number, y: number, ph: number): void {
    ditherDisc(s, x, y, 44, C.heather0, 4)
    ditherDisc(s, x, y, 26, C.dusk0, 5)
    ditherDisc(s, x, y, 14, C.heather1, 6)
    const RX = 26
    const RY = 5
    const disk = (front: boolean) => {
        for (let dy = -RY; dy <= RY; dy++) {
            if (front ? dy < 0 : dy >= 0) continue
            for (let dx = -RX; dx <= RX; dx++) {
                const e = Math.sqrt((dx / RX) ** 2 + (dy / RY) ** 2)
                if (e > 1 || e < 0.3) continue
                const a = Math.atan2(dy / RY, dx / RX)
                const v = Math.sin(a * 8 - ph * TAU + e * 6)
                if (!bayer(x + dx, y + dy, R((1 - e) * 18 + v * 3))) continue
                s.set(x + dx, y + dy, e < 0.45 ? C.white : e < 0.65 ? (v > 0 ? C.pink : C.heather3) : C.purple2)
            }
        }
    }
    disk(false)
    for (let a = Math.PI * 1.05; a < Math.PI * 1.95; a += 0.05) s.set(R(x + Math.cos(a) * 8), R(y + Math.sin(a) * 7), a > Math.PI * 1.3 && a < Math.PI * 1.7 ? C.white : C.pink)
    disc(s, x, y, 6, C.ink)
    ring(s, x, y, 7, C.pink)
    disk(true)
}

/**
 * A stream of debris falling toward the Void along a curve from (x0, y0) through (cx, cy) to
 * the hole. `n` evenly spaced motes each advance one slot per loop, so the stream flows and the
 * loop still closes; they shrink and brighten as they near the hole.
 */
function debrisStream(s: Surface, x0: number, y0: number, cx: number, cy: number, hx: number, hy: number, ph: number, n: number, chunk: boolean): void {
    for (let i = 0; i < n; i++) {
        const u = (i + ph) / n
        const a = (1 - u) * (1 - u)
        const b = 2 * (1 - u) * u
        const c = u * u
        const x = R(a * x0 + b * cx + c * hx)
        const y = R(a * y0 + b * cy + c * hy)
        if (chunk && u < 0.75) {
            const r = u < 0.3 ? 3 : u < 0.55 ? 2 : 1
            rect(s, x - r, y - r + 1, r * 2, r * 2 - 1, C.rock1)
            rect(s, x - r, y - r, r * 2, 1, C.rock2)
            px(s, x + r - 1, y - r, C.heather3)
        } else {
            s.set(x, y, u > 0.75 ? C.pink : u > 0.4 ? C.heather3 : C.rock3)
            s.set(x - 1, y, u > 0.6 ? C.purple2 : C.rock2)
            if (u < 0.3) s.set(x, y + 1, C.rock2)
        }
    }
}

/** A slab of torn-off ground adrift: rock beds hanging under a dead crust, lit toward the Void. */
function shard9(s: Surface, x: number, y: number, w: number, tilt: number, seed: number): void {
    for (let dx = -w; dx <= w; dx++) {
        const u = dx / w
        const top = R(y + dx * tilt)
        const d = R(w * 0.7 * Math.pow(1 - Math.abs(u), 0.6) * (0.6 + 0.4 * hash2(seed, (dx + w) >> 1)) + 2)
        for (let yy = top; yy <= top + d; yy++) {
            let c = (yy - top) % 3 === 0 ? C.rock0 : C.rock1
            if (u > 0.55) c = C.heather1
            if (yy === top) c = C.rock2
            s.set(x + dx, yy, c)
        }
        if (u > 0.3) s.set(x + dx, top, C.heather3)
    }
}

/**
 * The Brink, the last ground at the edge of the world: the storm of the Shattered Sky burned out
 * to a few torn rags, the sky gone to stars, and on the far horizon the Void itself, small and
 * turning, with everything left streaming toward it: dust, stones, whole slabs of land. The party fights on cracked
 * ground lit violet from the horizon, pebbles lifting off it as gravity fails, a slab of ground
 * peeling up at one edge and a broken pillar ringed with hovering stones at the other, and the
 * near edge crumbling away into the stars. The ground is dark rock and violet light, clear of the
 * Unravelled Knights' cold greys.
 */
export const brink: WorldScene = {
    id: 'world_the_brink',
    tiered: true,
    draw(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        sky(s, [C.ink, C.void, C.night0, C.heather0, C.dusk0], [0, 34, 62, 84, 100])
        stars(s, t, 130, 901, 104, C.night3, C.white)
        // the last rags of the storm, torn thin and drawn toward the Void
        for (let i = 0; i < 4; i++) {
            const wind = clock.smooth ? t * (1 + i * 0.3) : 0
            const x = mod(hash2(i, 902) * (SW + 80) - sc * 0.03 - wind, SW + 80) - 60
            streakCloud(s, R(x), 14 + i * 9, 30 + R(hash2(i, 903) * 40), C.slate0, C.heather1, C.void)
        }
        const hx = R(VOID_FAR.x - sc * 0.02)
        // the Void's light along the whole horizon: building toward the ground and strongest under
        // the hole, plum high up, warming to rose at the edge of the world
        for (let y = 56; y < 108; y++) {
            const v = (y - 56) / 52
            const c = v > 0.8 ? C.dusk2 : v > 0.55 ? C.dusk1 : C.heather1
            for (let x = 0; x < SW; x++) {
                const lv = R(v * 11 * Math.max(0, 1 - Math.abs(x - hx) / 300))
                if (lv > 0 && bayer(x, y, lv)) s.set(x, y, c)
            }
        }
        distantHole(s, hx, VOID_FAR.y, ph)
        // broken land adrift far off, slabs tilting toward the hole
        band(sc * 0.06, 70, 904, (x, k, r) => shard9(s, x, R(78 + r * 22 + Math.sin(ph * TAU + k) * 1), 5 + R(r * 6), 0.1 + r * 0.15, k))
        // debris streaming in: dust, then stones, off the far ground and into the hole
        for (const [x0, y0, cx, cy, n, chunk] of [
            [-20, 102, 90, 34, 22, false], [40, 106, 120, 50, 18, false], [120, 104, 170, 70, 16, false],
            [340, 98, 300, 30, 20, false], [300, 106, 280, 80, 14, false],
            [10, 106, 110, 44, 7, true], [70, 108, 150, 58, 6, true], [320, 104, 270, 70, 6, true]
        ] as const) debrisStream(s, x0, y0, cx, cy, hx, VOID_FAR.y, ph, n, chunk)
        // the ground ends in a broken edge, slabs lifting away beyond it
        ridge(s, sc * 0.16, 106, 7, 30, 905, C.rock0, C.heather1, SH, 0.8)
        band(sc * 0.3, 44, 906, (x, k, r) => shard9(s, x, R(96 + r * 6 - Math.abs(Math.sin(ph * TAU + k)) * 2), 3 + R(r * 4), -0.2 + r * 0.4, k + 40))
        // the field: cracked dark rock, lit violet from the horizon, cracks glowing with the Void
        strata(s, GROUND, LIP, [C.heather1, C.dusk0, C.rock1], [0, 10, 30])
        rect(s, 0, GROUND, SW, 1, C.heather3)
        dither(s, 0, GROUND + 1, SW, 4, C.heather3, 4)
        // the Void's light laid across the stone in long streaks, strongest under the hole
        for (let y = GROUND + 3; y < FLOOR_Y + 4; y += 3) {
            const d = (y - GROUND) / (FLOOR_Y - GROUND)
            const w = 90 - d * 50
            for (let x = R(hx - w); x < hx + w; x++) {
                if (x < 0 || x >= SW) continue
                if (hash2(x >> 2, y) < 0.55 && bayer(x, y, R(7 - d * 5 - Math.abs(x - hx) / w * 5))) s.set(x, y, C.heather3)
            }
        }
        scatter(sc, GROUND + 4, FLOOR_Y + 8, 6, 18, 907, (x, y, k, r) => {
            rect(s, x, y, 4 + R(r * 7), 1, k & 1 ? C.rock0 : C.dusk0)
        })
        scatter(sc, GROUND + 8, FLOOR_Y + 6, 3, 96, 908, (x, y, k) => {
            const on = (f + k * 5) % 16 < 10
            let cx = x
            let cy = y
            for (let i = 0; i < 6; i++) {
                const nx = cx + 3 + R(hash2(k, i) * 4)
                const ny = y + R((hash2(k + 1, i) - 0.5) * 4)
                line(s, cx, cy + 1, nx, ny + 1, C.rock0)
                line(s, cx, cy - 1, nx, ny - 1, C.heather1)
                line(s, cx, cy, nx, ny, on || i === 3 ? C.ice3 : C.heather3)
                if (i === 2) line(s, nx, ny, nx + 2, ny + 3, C.heather3)
                cx = nx
                cy = ny
            }
        })
        // pebbles lifting off the ground as gravity fails, each over its own shadow
        scatter(sc, GROUND + 6, FLOOR_Y + 6, 4, 34, 909, (x, y, k, r) => {
            const lift = 3 + R(r * 5) + R(Math.sin(ph * TAU + k) * 1.5)
            ellipse(s, x, y, 2, 1, C.dusk0)
            const sz = 1 + (k % 2 === 0 ? 1 : 0)
            rect(s, x - sz, y - lift - sz, sz * 2, sz * 2, C.rock0)
            px(s, x + sz - 1, y - lift - sz, C.heather3)
        })
        // the near edge crumbling into the stars
        rect(s, 0, LIP, SW, SH - LIP, C.ink)
        stars(s, t, 30, 910, SH - LIP, C.night3, C.heather3)
        const isc = R(sc)
        for (let x = 0; x < SW; x++) {
            const wx = x + isc
            const g = Math.floor(wx / 3)
            let d = 6 + R(vnoise(wx, 12, 911) * 9)
            if (hash2(g, 912) > 0.7) d += R(5 * (1 - Math.abs(mod(wx, 3) - 1) * 0.6))
            for (let k = 0; k < d && LIP + k < SH; k++) {
                let c = (k + R(vnoise(wx, 20, 913) * 3)) % 3 === 0 ? C.rock0 : C.rock1
                if (k === 0) c = C.heather1
                if (k >= d - 1) c = C.rock0
                s.set(x, LIP + k, c)
            }
        }
        // chunks falling away beneath, and dust rising off everything
        band(sc * 1.05, 40, 914, (x, k, r) => {
            const y = SH - 6 - R(r * 6) + R(Math.sin(ph * TAU + k) * 1.5)
            rect(s, x - 2, y, 4, 3, C.rock1)
            px(s, x + 1, y, C.heather3)
        })
        motes(s, t, 26, 915, [C.heather3, C.dusk3], -8, 3, 20, FLOOR_Y)
        if (clock.smooth) drift(s, t, 16, 916, [C.pink, C.purple2], -14, 6, 20, GROUND)
    },
    front(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        framing(sc, (o) => {
            // a slab of the ground peeling up at the left edge, its underside hanging in the air
            const lx = o + 18
            const lift = R(Math.sin(ph * TAU) * 1)
            poly(s, [-22, 0, 26, -12, 30, -6, -18, 8], lx, FLOOR_Y + 6 + lift, C.rock1)
            poly(s, [-18, 8, 30, -6, 18, 14, -8, 18], lx, FLOOR_Y + 6 + lift, C.rock0)
            line(s, lx - 22, FLOOR_Y + 6 + lift, lx + 26, FLOOR_Y - 6 + lift, C.heather3)
            line(s, lx - 21, FLOOR_Y + 7 + lift, lx + 25, FLOOR_Y - 5 + lift, C.heather1)
            for (let i = 0; i < 5; i++) line(s, lx - 12 + i * 8, FLOOR_Y + 12 - i + lift, lx - 13 + i * 8, FLOOR_Y + 18 - i + R(hash2(i, 917) * 4) + lift, C.rust0)
            // a broken pillar at the right edge, stones hovering round it
            const px0 = o + 290
            rect(s, px0 - 6, FLOOR_Y - 70, 13, 82, C.rock1)
            rect(s, px0 - 6, FLOOR_Y - 70, 3, 82, C.heather1)
            rect(s, px0 - 6, FLOOR_Y - 70, 1, 82, C.heather3)
            poly(s, [-6, 0, -1, -7, 3, -2, 7, -9, 7, 0], px0, FLOOR_Y - 70, C.rock1)
            for (let k = 0; k < 6; k++) rect(s, px0 - 6, FLOOR_Y - 60 + k * 12, 13, 1, C.rock0)
            for (let i = 0; i < 4; i++) {
                const on = (f + i * 4) % 16 < 10
                rect(s, px0 - 1, FLOOR_Y - 58 + i * 14, 2, 4, on ? C.heather3 : C.heather1)
            }
            rect(s, px0 - 9, FLOOR_Y + 8, 19, 4, C.rock1)
            for (let i = 0; i < 5; i++) {
                const a = (ph + i / 5) * TAU
                const sx = R(px0 + Math.cos(a) * 16)
                const sy = R(FLOOR_Y - 40 + i * 9 + Math.sin(a) * 3)
                rect(s, sx - 1, sy - 1, 3, 2 + (i & 1), C.rock0)
                px(s, sx + 1, sy - 1, C.heather3)
            }
        })
    }
}

// ── 10. The Void ───────────────────────────────────────────────────────────────────

const HOLE = { x: 150, y: 56 }
/** How much larger than its first cut the black hole is drawn. */
const HOLE_SCALE = 1.35
/** The accretion disk's tilt off level, in radians: its right side dips. */
const HOLE_TILT = 0.2

/**
 * The hunger at the end: a black hole whose accretion disk turns on the loop (its streaks are a
 * twelve-fold pattern that advances one arm per loop, so it closes), tilted `tilt` radians off
 * level, the far side of the disk bent up over the hole, and a photon ring round the dark. `k`
 * scales the whole of it.
 */
function blackHole(s: Surface, x: number, y: number, ph: number, k: number, tilt: number): void {
    const RX = R(64 * k)
    const RY = R(13 * k)
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    const span = R(RX * Math.abs(st) + RY * ct) + 1
    // every pixel is taken back into the disk's own frame (u along it, v across it), so the
    // pattern, the front and back halves and the lensed arc all tilt together
    const disk = (front: boolean) => {
        for (let dy = -span; dy <= span; dy++) {
            for (let dx = -RX - 1; dx <= RX + 1; dx++) {
                const u = dx * ct + dy * st
                const v = -dx * st + dy * ct
                if (front ? v < 0 : v >= 0) continue
                const e = Math.sqrt((u / RX) ** 2 + (v / RY) ** 2)
                if (e > 1 || e < 0.26) continue
                const a = Math.atan2(v / RY, u / RX)
                const inner = e < 0.55
                const w = Math.sin(a * 12 - (inner ? 2 : 1) * ph * TAU + e * 9)
                const lv = R((1 - e) * 16 + w * 3)
                if (!bayer(x + dx, y + dy, lv)) continue
                s.set(x + dx, y + dy, e < 0.36 ? C.white : e < 0.5 ? (w > 0 ? C.pink : C.heather3) : e < 0.72 ? C.purple2 : C.purple1)
            }
        }
    }
    ditherDisc(s, x, y, 40 * k, C.purple0, 4)
    ditherDisc(s, x, y, 26 * k, C.purple0, 7)
    disk(false)
    // the far side of the disk, lensed up and over the hole, tilted with it
    for (let i = 0; i < 4; i++) {
        for (let a = Math.PI * 1.02; a < Math.PI * 1.98; a += 0.015) {
            const r = (17 + i * 1.6) * k
            const u = Math.cos(a) * r
            const v = Math.sin(a) * r * 0.9
            const w = Math.sin(a * 12 + ph * TAU)
            s.set(R(x + u * ct - v * st), R(y + u * st + v * ct), i === 0 ? C.white : w > 0 ? C.pink : C.purple2)
        }
    }
    disc(s, x, y, 14 * k, C.ink)
    ring(s, x, y, R(15 * k), C.pink)
    disk(true)
}

/** Each earlier world's ground, as its fragment carries it: the island palette in its own colours. */
const FRAGMENT_PAL: readonly IslePal[] = [
    { rock: C.brown1, dark: C.brown0, lit: C.brown2, earth: C.brown1, grass: C.green2, grassLit: C.green3, root: C.brown0 },
    { rock: C.teal0, dark: C.void, lit: C.teal1, earth: C.brown0, grass: C.olive1, grassLit: C.olive2, root: C.olive0 },
    { rock: C.stone0, dark: C.ink, lit: C.red1, earth: C.stone0, grass: C.stone1, grassLit: C.stone2, root: C.lava0 },
    { rock: C.steel1, dark: C.steel0, lit: C.steel2, earth: C.steel0, grass: C.frost, grassLit: C.white, root: C.steel0 },
    { rock: C.teal1, dark: C.teal0, lit: C.teal2, earth: C.bone0, grass: C.bone0, grassLit: C.bone1, root: C.green1 },
    { rock: C.night1, dark: C.night0, lit: C.purple1, earth: C.night0, grass: C.night2, grassLit: C.night3, root: C.night0 },
    { rock: C.brown1, dark: C.brown0, lit: C.red0, earth: C.brown0, grass: C.olive0, grassLit: C.olive1, root: C.bone0 },
    { rock: C.stone1, dark: C.stone0, lit: C.stone2, earth: C.brown1, grass: C.green2, grassLit: C.green3, root: C.brown0 },
    { rock: C.stone1, dark: C.stone0, lit: C.purple1, earth: C.night1, grass: C.night1, grassLit: C.night2, root: C.stone0 }
]

/**
 * The Bonefields fragment's giant skull, 13 by 12: a domed cranium lit from the upper left, heavy
 * brows over deep sockets, a nasal hole, cheekbones, a row of teeth over the jaw and a crack
 * running down from the crown where the sword went in.
 */
const SKULL = [
    '....wwwww....',
    '..wwbbbbbbb..',
    '.wbbbbbkbbbs.',
    'wbbbbbbkbbbbs',
    'bbbbbbbbkbbbs',
    'bddddbbbdddds',
    'bkkkkdbdkkkks',
    'bkkkkbbbkkkks',
    '.bkkbbkbbkks.',
    '..sbbkkkbbs..',
    '..btbtbtbts..',
    '...sssssss...'
] as const
const SKULL_KEY: Readonly<Record<string, number>> = { w: C.white, b: C.bone1, s: C.bone0, d: C.bone0, k: C.ink, t: C.ink }

/**
 * A fragment of one of the nine worlds before this one, adrift: a torn-off island of that world's
 * ground (built like the Shattered Sky's) with its landmark standing on it.
 */
function fragment(s: Surface, x: number, y: number, k: number, w: number, ph: number, f: number): void {
    const n = mod(k, 9)
    island(s, x, y, w, ph, f, k * 7 + 3, FRAGMENT_PAL[n]!, n === 7, Top.None)
    const b = y - 2
    switch (n) {
        case 0: { // Thornwick's windmill, its sails turning a quarter per loop
            poly(s, [-4, 0, 4, 0, 3, -12, -3, -12], x, b, C.bone1)
            poly(s, [1, 0, 4, 0, 3, -12, 1, -12], x, b, C.bone0)
            tri(s, x - 4, b - 12, x + 4, b - 12, x, b - 17, C.brown2)
            rect(s, x - 1, b - 3, 2, 3, C.brown1)
            const a = ph * Math.PI / 2
            for (let i = 0; i < 4; i++) {
                const ca = Math.cos(a + i * Math.PI / 2)
                const sa = Math.sin(a + i * Math.PI / 2)
                line(s, x, b - 13, R(x + ca * 9), R(b - 13 + sa * 9), C.bone1)
                line(s, R(x + ca * 3 - sa * 1.5), R(b - 13 + sa * 3 + ca * 1.5), R(x + ca * 9 - sa * 1.5), R(b - 13 + sa * 9 + ca * 1.5), C.brown2)
            }
            break
        }
        case 1: // a Mirewood cypress hung with moss
            rect(s, x - 1, b - 12, 3, 12, C.void)
            tri(s, x - 5, b, x + 5, b, x, b - 5, C.void)
            ellipse(s, x, b - 13, 7, 2, C.teal0)
            ellipse(s, x + 3, b - 15, 4, 2, C.teal0)
            for (let i = 0; i < 6; i++) line(s, x - 6 + i * 2, b - 12, x - 6 + i * 2, b - 9 + (i & 1) * 2, C.olive1)
            break
        case 2: // a Cinderpass cone with lava running down it
            poly(s, [-9, 0, -2, -11, 2, -11, 9, 0], x, b, C.stone0)
            poly(s, [2, -11, 9, 0, 4, 0], x, b, C.stone1)
            rect(s, x - 2, b - 12, 5, 1, C.gold2)
            for (let i = 0; i < 10; i++) px(s, x - 1 - (i >> 1), b - 10 + i, (i + f) % 5 === 0 ? C.gold2 : C.lava1)
            ditherDisc(s, x, b - 14, 4, C.lava0, 5)
            break
        case 3: // two Rimeholt pines under snow
            for (const [dx, h] of [[-3, 13], [4, 9]] as const) {
                tri(s, x + dx - 4, b, x + dx + 4, b, x + dx, b - h, C.green0)
                for (let i = 3; i < h; i += 3) line(s, x + dx, b - h + i - 2, x + dx - R(i * 0.35), b - h + i, C.white)
            }
            break
        case 4: // drowned Amarath columns under a broken arch
            rect(s, x - 6, b - 12, 3, 12, C.bone1)
            rect(s, x + 3, b - 9, 3, 9, C.bone1)
            rect(s, x - 7, b - 13, 5, 1, C.bone1)
            rect(s, x - 6, b - 14, 8, 2, C.bone0)
            px(s, x - 5, b - 6, C.teal2); px(s, x + 4, b - 4, C.teal2)
            break
        case 5: { // a Duskspire mage tower, its crystal turning above it
            rect(s, x - 2, b - 14, 5, 14, C.night1)
            rect(s, x - 2, b - 14, 1, 14, C.purple1)
            tri(s, x - 3, b - 14, x + 3, b - 14, x, b - 21, C.purple1)
            px(s, x, b - 9, C.gold2); px(s, x, b - 5, (f & 4) ? C.gold2 : C.night2)
            const cy = b - 25 + R(Math.sin(ph * TAU) * 1)
            tri(s, x - 2, cy, x + 2, cy, x, cy - 3, C.pink)
            tri(s, x - 2, cy, x + 2, cy, x, cy + 3, C.purple2)
            break
        }
        case 6: { // the Bonefields' greatsword driven into a giant's skull
            // the sword first, so the crown closes over the blade where it goes in
            line(s, x + 1, b - 8, x + 6, b - 25, C.steel2, 2)
            line(s, x + 1, b - 9, x + 5, b - 25, C.steel3)
            line(s, x + 1, b - 21, x + 10, b - 23, C.gold1, 2)
            px(s, x + 1, b - 22, C.gold2)
            line(s, x + 6, b - 25, x + 7, b - 29, C.brown1, 2)
            disc(s, x + 7, b - 31, 1.5, C.gold2)
            for (let r = 0; r < SKULL.length; r++) {
                const row = SKULL[r]!
                for (let c = 0; c < row.length; c++) {
                    const k2 = SKULL_KEY[row[c]!]
                    if (k2 !== undefined) s.set(x - 6 + c, b - SKULL.length + r, k2)
                }
            }
            // the Void looking out of the sockets
            if ((f & 7) < 5) { px(s, x - 3, b - 5, C.pink); px(s, x + 3, b - 5, C.pink) }
            px(s, x - 4, b - 6, C.purple2); px(s, x + 2, b - 6, C.purple2)
            break
        }
        case 7: // a Shattered Sky pine, water pouring off the edge
            tri(s, x - 7, b, x - 1, b, x - 4, b - 12, C.green1)
            line(s, x - 4, b - 12, x - 2, b - 3, C.green3)
            break
        default: { // a slab of the Brink, shedding stones toward the hole
            line(s, x - 5, b - 1, x + 6, b - 3, C.purple2)
            for (let i = 0; i < 4; i++) {
                const u = (ph + i / 4) % 1
                rect(s, R(x + 2 + u * 10), R(b - 4 - u * 12), 2, 2, i & 1 ? C.stone1 : C.stone2)
            }
        }
    }
}

/** A shard of pale crystal standing at `base`: a lit face, a shaded face, a bright edge. */
function shard(s: Surface, x: number, base: number, h: number, w: number, lean: number): void {
    poly(s, [-w, 0, lean - 2, -h, lean + 2, -h + 4, w, 0], x, base, C.heather2)
    poly(s, [lean, -h + 2, lean + 2, -h + 4, w, 0, R(w * 0.2), 0], x, base, C.slate2)
    line(s, x - w, base, x + lean - 2, base - h, C.heather3)
    line(s, x - w + 2, base, x + lean - 1, base - h + 3, C.ice3)
}

/**
 * A river of void along the near edge: the dark itself flowing past in bands of violet and rose,
 * with stars caught in it, drifting and winking. It flows on the loop, so the strip closes.
 */
function voidRiver(s: Surface, top: number, sc: number, ph: number, f: number): void {
    for (let y = top; y < SH; y++) {
        const d = y - top
        for (let x = 0; x < SW; x++) {
            const wx = x + sc * 1.1
            const v = Math.sin(wx * 0.07 - d * 0.55 + ph * TAU) + Math.sin(wx * 0.023 + d * 0.35 - ph * TAU) * 0.7
            s.set(x, y, v > 1.35 ? C.pink : v > 0.9 ? C.purple2 : v > 0.3 ? C.purple1 : v > -0.4 ? C.purple0 : v > -1.1 ? C.void : C.ink)
        }
    }
    // stars caught in the current
    for (let i = 0; i < 26; i++) {
        const x = R(mod(hash2(i, 1007) * SW - sc * 1.1 + Math.sin(ph * TAU + i) * 2, SW))
        const y = top + 1 + R(hash2(i, 1008) * (SH - top - 2))
        const tw = (f + i * 5) % 16
        if (tw < 12) s.set(x, y, tw < 3 ? C.white : C.haze)
    }
    // the bank's shadow on the water, and the glow where the dark meets it
    rect(s, 0, top, SW, 1, C.ink)
    dither(s, 0, top + 1, SW, 2, C.purple2, 3)
}

/**
 * The Void: stars pressing in, a black hole turning over the field, fragments of every world so
 * far drifting past it, each carrying its own ground and landmark, and the party on a plain of
 * pale glass that holds the disk's glow, with crystal shards framing it and a river of void
 * flowing past in front. Everything here is the dark the Thralls are made of, so the ground they
 * stand on is the one light thing left.
 */
export const theVoid: WorldScene = {
    id: 'world_the_void',
    tiered: true,
    draw(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        rect(s, 0, 0, SW, SH, C.ink)
        for (let i = 0; i < 3; i++) ditherEllipse(s, mod(60 + i * 120 - sc * 0.02, SW + 80) - 40, 40 + i * 16, 60, 16, i === 1 ? C.purple0 : C.night0, 5)
        stars(s, t, 90, 1001, 104, C.night3, C.white)
        const hx = R(HOLE.x - sc * 0.01)
        blackHole(s, hx, HOLE.y, ph, HOLE_SCALE, HOLE_TILT)
        band(sc * 0.1, 56, 1002, (x, k, r) => fragment(s, x, R(66 + r * 24 + Math.sin(ph * TAU + k) * 2), k, 9, ph, f))
        band(sc * 0.2, 96, 1003, (x, k, r) => fragment(s, x, R(86 + r * 10 + Math.sin(ph * TAU + k * 2) * 1.5), k + 4, 13, ph, f))
        // the far edge of the glass, catching the disk's light
        strata(s, GROUND, LIP, [C.heather3, C.heather2, C.slate2], [0, 3, 22])
        for (let y = GROUND + 1; y < FLOOR_Y + 6; y++) {
            const d = y - GROUND
            const w = Math.max(0, 20 - d * 0.5)
            if (w > 0) dither(s, R(hx - w - sc * 0.4), y, R(w * 2), 1, d < 10 ? C.ice3 : C.heather3, R(10 - d * 0.25))
        }
        flagstones(s, sc, GROUND + 3, LIP, 6, 44, C.dusk1, C.heather3)
        scatter(sc, GROUND + 8, FLOOR_Y + 4, 3, 100, 1004, (x, y, k) => {
            const on = (f + k * 5) % 16 < 10
            let cx = x
            for (let i = 0; i < 4; i++) {
                const nx = cx + 4 + R(hash2(k, i) * 3)
                const ny = y + R((hash2(k + 1, i) - 0.5) * 3)
                line(s, cx, y, nx, ny, on ? C.ice3 : C.heather3)
                cx = nx
            }
        })
        rect(s, 0, LIP, SW, FRONT - LIP, C.slate2)
        rect(s, 0, LIP, SW, 1, C.ice3)
        rect(s, 0, FRONT - 1, SW, 1, C.dusk1)
        voidRiver(s, FRONT, sc, ph, f)
        motes(s, t, 20, 1005, [C.heather3, C.dusk3], -6, 0, 20, FLOOR_Y)
        if (clock.smooth) drift(s, t, 24, 1006, [C.pink, C.purple2, C.white], -12, 0, 10, GROUND)
    },
    front(s, sc, t) {
        const ph = phase(t)
        // crystal shards at the edges, a smaller one drifting over each
        framing(sc, (o) => {
            shard(s, o + 16, FLOOR_Y + 12, 110, 12, 6)
            shard(s, o + 38, FLOOR_Y + 12, 60, 7, -3)
            shard(s, o + 300, FLOOR_Y + 12, 120, 13, -5)
            const by = R(50 + Math.sin(ph * TAU) * 3)
            shard(s, o + 58, by, 14, 4, 2)
            shard(s, o + 276, R(70 - Math.sin(ph * TAU) * 3), 12, 3, -1)
        })
    }
}
