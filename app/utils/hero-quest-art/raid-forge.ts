// Forge Raid: three bosses back to back, the forge's own ranks, each walking out as the last falls.
//
//   The Apprentice    a hulking ogre striker in a scorched apron, all belly and arm, swinging an
//                     oversized sledgehammer he can barely control
//   The Journeyman    a clockwork automaton the forge built, a brass boiler on piston legs, its
//                     hammer arm a piston that fires
//   The Forgemaster   the giant master smith, ember-braided beard, a hammer glowing from the fire,
//                     tongs holding a white-hot blade
//
// Each is drawn facing the party as the other raid bosses are: its parts lit as volumes, back to
// front, limbs solved from shoulder or hip to hand or foot so the joints bend where they should.

import { C } from './palette'
import type { BossSpecial, CreatureDef } from './creature'
import { CF, fr } from './creature'
import { Surface, StampStyle, stamp, bayer, rect } from './surface'
import { B, ENTRY_SETTLED, bossStates, withSpecial, drive, finish, Entry, shift, bz, elbow, P, px, line, disc, ellipse, poly, taper, q, sm, hash2 } from './boss-kit'
import { mask, vol, eachPx, selOut, rot, T, type Mat5 } from './raid-kit'
import { sp, sq, hitTarget, chest, debris, crack, spike, FIRE6, DUST6 } from './special-kit'
import { blast, shockRing, type Ramp6 } from './vfx-cinematic'

const R = Math.round

const OGRE: Mat5 = { ramp: [C.olive0, C.olive1, C.olive2, C.bone1], hi: C.bone1, rim: C.olive1 }
const LEATHER: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.brown3, rim: C.brown1 }
const CLOTH: Mat5 = { ramp: [C.stone0, C.stone1, C.stone2, C.stone3], hi: C.stone3, rim: C.stone1 }
const IRON: Mat5 = { ramp: [C.steel0, C.steel1, C.steel2, C.steel3], hi: C.white, rim: C.steel1 }
const WOOD: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.bone1, rim: C.brown1 }

/**
 * A limb through the points in \`pts\` (x, y pairs), \`w\` wide at each, lit as one volume with its
 * joints rounded, outlined on its shadowed side in \`dark\`.
 */
function limb(s: Surface, key: string, pts: readonly number[], w: readonly number[], mat: Mat5, bias: number, dark: number): Surface {
    const m = mask(s, key)
    for (let i = 0; i + 3 < pts.length; i += 2) {
        const k = i / 2
        taper(m, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!, w[k]!, w[k + 1]!, 1)
        disc(m, pts[i + 2]!, pts[i + 3]!, w[k + 1]! * 0.5, 1)
    }
    disc(m, pts[0]!, pts[1]!, w[0]! * 0.5, 1)
    vol(s, m, mat, 10, bias)
    selOut(s, m, dark)
    return m
}

/**
 * Where a walking entrance has carried it at \`t\`: how far it still has to come (px, to shift by)
 * and the phase of its stride (−1 once it has arrived).
 */
function walkIn(t: number, dur: number, from: number, strides: number): { off: number, stride: number } {
    const k = Math.min(1, q(t) / (dur * ENTRY_SETTLED))
    const left = (1 - k) * (1 - k)
    return { off: -R(from * left), stride: k < 1 ? (strides * (1 - left)) % 1 : -1 }
}

// ═══════════════════════════════════════════════════════════════ 1 · The Apprentice

/**
 * Runaway Hammer, in seconds: he hauls the hammer up and it slams down at each of RUN_SLAMS, too
 * heavy for him, bouncing and dragging him a stumbling step forward (RUN_STEP px) after the first
 * two; the third sticks in the ground, he tugs it free and backs off to his mark.
 */
const RUN_DUR = 2.8
const RUN_SLAMS = [0.75, 1.3, 1.85] as const
const RUN_STEP = 14
/** Where the hammer's head lands, in front of his feet, on the slam. */
const RUN_REACH = 84
/**
 * The Apprentice's size on the gauntlet's ladder, the bottom rung: he is laid out at full size and
 * drawn this much smaller about his feet, every part with him, so the three step up clearly.
 */
const AP_SCALE = 0.83
/** The apron's bib top, where it leaves the belly to hang straight down, and its hem, from his feet. */
const APRON_TOP = -94
const APRON_DROP = -62
const APRON_HEM = -21
/** The sledge's haft from his near hand: the butt just behind it, the far hand this far along, the head at its end. */
const HAND_GAP = 18
const HAFT_BUTT = 6
const HAFT_HEAD = 70

/** Clamp `v` through [a, b] to 0..1 (a plain, unquantized span, for times already quantized). */
const span = (a: number, b: number, v: number): number => Math.min(1, Math.max(0, (v - a) / (b - a)))

/**
 * The Runaway Hammer's pose at `t`, on his own attack's poses: B.wind hauls it up, B.rec holds the
 * slam, B.lunge is the stumble. Returns how hard he is tugging at the stuck hammer.
 */
function runawayPose(t: number): number {
    const q0 = q(t)
    B.wind = 0; B.rec = 0; B.strike = false
    let tug = 0
    let k = -1
    for (let i = 0; i < RUN_SLAMS.length; i++) if (q0 >= RUN_SLAMS[i]!) k = i
    if (k < 0) B.wind = sm(span(0.2, RUN_SLAMS[0] - 0.02, q0))
    else {
        const ts = RUN_SLAMS[k]!
        const next = RUN_SLAMS[k + 1]
        if (q0 < ts + 0.08) { B.rec = 1; B.strike = true } else if (next !== undefined) {
            // it bounces up off the ground, and he hauls it up again
            if (q0 < ts + 0.22) B.rec = 1 - sm(span(ts + 0.08, ts + 0.22, q0))
            else B.wind = sm(span(ts + 0.22, next - 0.02, q0))
        } else if (q0 < ts + 0.5) {
            // stuck in the ground: he tugs at it
            B.rec = 1
            B.strike = true
            tug = Math.sin(span(ts + 0.08, ts + 0.5, q0) * Math.PI * 3) * 4
        } else B.rec = 1 - sm(span(ts + 0.5, RUN_DUR - 0.1, q0))
    }
    // a stumbling step after each of the first two slams, then back off to his mark
    let step = 0
    for (let i = 0; i < RUN_SLAMS.length - 1; i++) step += sm(span(RUN_SLAMS[i]! + 0.08, RUN_SLAMS[i]! + 0.35, q0))
    const back = sm(span(RUN_SLAMS[2] + 0.5, RUN_DUR - 0.05, q0))
    B.lunge = R(RUN_STEP * step * (1 - back))
    B.glow = Math.max(B.wind, B.strike ? 1 : B.rec * 0.6)
    return tug
}

/**
 * A sledge coming down on the ground at (x, y) at `t0`, `big` times its first size, and the damage
 * it leaves: a white flash and two shockwaves along the ground, a crater, cracks branching out
 * from it, slabs of stone jutting up round its rim, chunks of rock thrown up that bounce and come to
 * rest, and dust rolling out both ways. The crater, cracks and fallen rock stay until `until`, then
 * fade, so the ground shows every slam of the special.
 */
function groundImpact(s: Surface, x: number, y: number, t: number, t0: number, big: number, until: number, seed: number): void {
    const u = sq(t) - t0
    if (u < 0) return
    // the damage left behind fades once the special is done with it
    const stay = 1 - sp(sq(t), until, until + 0.3)
    if (stay <= 0) return
    const fade = R(16 * stay)
    // the flash, a white star on the ground for the first frames
    if (u < 0.07) {
        const r = R(9 * big * (1 - u / 0.07) + 3)
        disc(s, x, y - 2, r * 0.55, C.white)
        line(s, x - r * 1.8, y - 1, x + r * 1.8, y - 1, C.white)
        line(s, x, y - r * 1.4, x, y + 1, C.white)
    }
    shockRing(s, x, y, t, t0, 0.5, 6, 64 * big, C.white, true)
    shockRing(s, x, y, t, t0 + 0.05, 0.45, 4, 44 * big, C.bone1, true)
    // the crater: a lit far rim, a dark hollow, a rubble lip
    const cr = 10 * big * sm(Math.min(1, u / 0.06))
    for (let yy = -R(cr * 0.35) - 1; yy <= R(cr * 0.35) + 1; yy++) {
        for (let xx = -R(cr) - 2; xx <= R(cr) + 2; xx++) {
            const e = (xx * xx) / ((cr + 2) * (cr + 2)) + (yy * yy) / ((cr * 0.35 + 1) * (cr * 0.35 + 1))
            if (e > 1 || !bayer(x + xx, y + yy, fade)) continue
            const inner = (xx * xx) / (cr * cr) + (yy * yy) / (cr * cr * 0.12) < 1
            s.set(x + xx, y + yy, !inner ? (yy < 0 ? C.stone3 : C.stone2) : yy < -1 ? C.ink : C.stone0)
        }
    }
    // cracks branching out across the ground, white-hot for a moment as they open
    const grow = sp(sq(t), t0, t0 + 0.14)
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + hash2(seed, i) * 0.6
        const len = (18 + hash2(seed + 1, i) * 20) * big
        const ex = x + Math.cos(a) * len
        const ey = y + Math.sin(a) * len * 0.3
        if (!bayer(R(ex), R(ey), fade)) continue
        const hot = u < 0.12
        crack(s, x, y, ex, ey, grow, seed * 7 + i, hot ? C.gold3 : C.stone0, hot ? C.white : C.ink)
        // a branch off the longer ones
        if (len > 24 * big) {
            const mx = x + (ex - x) * 0.6
            const my = y + (ey - y) * 0.6
            const b = a + (hash2(seed + 2, i) > 0.5 ? 0.7 : -0.7)
            crack(s, mx, my, mx + Math.cos(b) * len * 0.35, my + Math.sin(b) * len * 0.1, sp(sq(t), t0 + 0.06, t0 + 0.18), seed * 11 + i, C.stone0, C.ink)
        }
    }
    // slabs of stone forced up round the rim, then settling back
    const jut = sm(Math.min(1, u / 0.06)) * (1 - 0.6 * sp(sq(t), t0 + 0.2, t0 + 0.6))
    for (let i = 0; i < 5; i++) {
        const sx = x + (i - 2) * 6 * big + (hash2(seed + 3, i) - 0.5) * 4
        const sy = y + 1 + (i & 1)
        const h = R((5 + hash2(seed + 4, i) * 5) * big * jut)
        if (h > 1 && bayer(R(sx), sy, fade)) spike(s, R(sx), sy, h, 3, R((i - 2) * 2), C.stone1, C.stone3, C.bone1)
    }
    // chunks of rock thrown up, bouncing once and lying where they land
    for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (hash2(seed + 5, i) - 0.5) * 2.4
        const v = (60 + hash2(seed + 6, i) * 70) * big
        const ground = y + (hash2(seed + 7, i) - 0.5) * 10
        const vy = Math.sin(ang) * v
        // time to come down to its ground, then a small bounce
        const tf = (-vy + Math.sqrt(vy * vy + 2 * 260 * (ground - y))) / 260
        let cx: number
        let cy: number
        if (u < tf) { cx = x + Math.cos(ang) * v * u; cy = y + vy * u + 130 * u * u } else {
            const b = u - tf
            const bx = x + Math.cos(ang) * v * tf
            const bt = Math.min(b, 0.18)
            cx = bx + Math.cos(ang) * v * 0.25 * bt
            cy = Math.min(ground, ground - 40 * bt + 130 * bt * bt)
        }
        if (!bayer(R(cx), R(cy), fade)) continue
        const sz = 1 + (i % 3 === 0 ? 1 : 0)
        rect(s, R(cx), R(cy) - sz, sz + 1, sz + 1, i & 1 ? C.stone2 : C.stone3)
        s.set(R(cx), R(cy) - sz, C.bone1)
    }
    // dust rolling out low both ways, thinning
    const dd = u / 0.9
    if (dd < 1) {
        for (const side of [-1, 1]) {
            for (let k = 0; k < 3; k++) {
                const px0 = R(x + side * (8 + dd * (30 + k * 14) * big))
                const py0 = R(y - 3 - k * 2 - dd * 6)
                const r0 = (4 + dd * 9 + k * 2) * big
                const level = R(12 * (1 - dd))
                for (let yy = -R(r0 * 0.6); yy <= R(r0 * 0.6); yy++) {
                    for (let xx = -R(r0); xx <= R(r0); xx++) {
                        if (xx * xx + yy * yy * 2.6 > r0 * r0 || !bayer(px0 + xx, py0 + yy, level)) continue
                        s.set(px0 + xx, py0 + yy, yy < -r0 * 0.2 ? C.bone1 : C.bone0)
                    }
                }
            }
        }
    }
}

/** Runaway Hammer: three slams, each dragging him on into the party, the nearest three struck in turn. */
const RUNAWAY_HAMMER: BossSpecial = {
    name: 'Runaway Hammer', tint: 'dusk0', hits: RUN_SLAMS.map(t0 => t0 + 0.01), spread: true,
    fx(s, t, st) {
        const d = st.dir
        RUN_SLAMS.forEach((t0, k) => {
            // where the head comes down, a step further on each time, each slam harder than the last
            const gx = st.bx + d * (RUN_REACH * AP_SCALE + RUN_STEP * k)
            groundImpact(s, R(gx), st.by, t, t0, 1 + k * 0.22, RUN_DUR - 0.3, 31 + k * 13)
            debris(s, gx, st.by - 4, st.by, t, t0, 10, 150, 'spark', 41 + k, 0.5)
            const pt = hitTarget(st, k, true)
            blast(s, pt.x, chest(pt), t, t0 + 0.01, 11, 0.45, DUST6, 71 + k, 'dust')
        })
    }
}

export const FORGE_APPRENTICE: CreatureDef = {
    // the smallest of the three: he stands in closer, so his slams land on the party
    name: 'The Apprentice', size: 256, room: 24, shadow: 34, accent: C.orange, advance: 24,
    states: withSpecial(bossStates(1.7, 2.0, 2.4), RUN_DUR),
    special: RUNAWAY_HAMMER,
    draw(s, st, t) {
        drive(this, st, t, 18, 2.0)
        // the Runaway Hammer plays on his own attack's poses
        const tug = st === 'special' ? runawayPose(t) : 0
        // he is laid out at full size and drawn at AP_SCALE: positions, part sizes and the gaps
        // between them all through `k`, so every part keeps its fit
        const k = (v: number): number => v * AP_SCALE
        const x = s.ax - k(10) + B.lunge - B.kb
        const y = s.ay
        const br = B.breath
        // stomping in: a heavy rolling stride
        let off = 0
        let stride = -1
        if (st === 'entry') ({ off, stride } = walkIn(t, this.states.entry!.dur, 150, 3))
        const step = stride >= 0 ? Math.sin(stride * Math.PI * 2) : 0
        const bob = stride >= 0 ? -R(Math.abs(step) * 3) : 0
        // the whole of him leans into the swing and topples backward when he falls
        const tilt = bz(0, -0.08, 0.12) - B.die * 0.9
        const at = (lx: number, ly: number): [number, number] => { rot(x + k(lx), y + k(ly) + bob, x - k(14), y, tilt); return [T.x, T.y] }
        // the upper body sways further than the hips: a lean on top of the tilt
        const lean = bz(0, -6, 10) - tug
        const up = (lx: number, ly: number): [number, number] => at(lx + lean * Math.max(0, -ly - 50) / 50, ly + br)

        // the hammer's grip and angle: resting on its head in front of him, hauled up over his
        // shoulder with his hands behind his head (so they never cross his face), slammed down on
        // the party. Both hands hold it as a sledge is held, near the end of the haft: the near hand
        // at the top (Gx, Gy), just under the butt, the far hand lower down, where his near arm
        // never covers it.
        const gx = bz(24, -16, 26)
        const gy = bz(-72, -116, -62)
        const ga = bz(0.95, -2.7, 0.62)
        const [Gx, Gy] = up(gx, gy)
        const ca = Math.cos(ga + tilt)
        const sa = Math.sin(ga + tilt)
        const Fx = Gx + ca * k(HAND_GAP)
        const Fy = Gy + sa * k(HAND_GAP)

        // ── his far arm, behind him, reaching round for the haft below his near hand ──
        {
            const [sx, sy] = up(-18, -90)
            // long enough to reach round his belly to the lower grip
            elbow(sx, sy, Fx, Fy, k(36), k(36), 1)
            limb(s, 'farm', [sx, sy, P.x, P.y, Fx, Fy], [k(18), k(14), k(12)], OGRE, -0.3, C.ink)
        }

        // ── legs, in trousers, clogs on his feet ──
        const leg = (hx: number, fx: number, far: boolean, phase: number): void => {
            const lift = stride >= 0 ? Math.max(0, Math.sin((stride + phase) * Math.PI * 2)) * 7 : 0
            const swing = stride >= 0 ? Math.sin((stride + phase) * Math.PI * 2) * 8 : 0
            const [a, b] = at(hx, -46)
            const [f, g] = at(fx + swing, -7 - lift)
            elbow(a, b, f, g, k(22), k(20), -1)
            limb(s, far ? 'fleg' : 'nleg', [a, b, P.x, P.y, f, g], [k(22), k(18), k(15)], CLOTH, far ? -0.3 : 0, C.ink)
            // the clog
            const cm = mask(s, 'clog')
            ellipse(cm, f + k(5), g + k(3), k(12), k(5.5), 1)
            vol(s, cm, LEATHER, 5, far ? -0.3 : 0)
            selOut(s, cm, C.ink)
            line(s, f - k(6), g + k(7), f + k(16), g + k(7), far ? C.ink : C.brown0)
        }
        leg(-8, -10, true, 0.5)
        leg(6, 10, false, 0)

        // ── the body: a great belly, a barrel chest, a hump of shoulder ──
        const body = mask(s, 'body')
        {
            const [bx, by] = up(4, -62)
            ellipse(body, bx, by, k(30), k(26), 1)
            const [cx, cy] = up(-2, -88)
            ellipse(body, cx, cy, k(28), k(18), 1)
            const [hx, hy] = up(-6, -96)
            disc(body, hx, hy, k(16), 1)
            vol(s, body, OGRE, 20)
            // soot smudged over his chest
            eachPx(body, (px_, py) => { if (hash2(px_, py) < 0.05 && py < by - k(18)) s.set(px_, py, C.olive0) })
            selOut(s, body, C.ink)
        }
        // the apron: scorched leather, a bib up his chest on a strap round his neck, pulled over the
        // belly and hanging straight down off it to his knees, tied round his waist
        {
            // the front of him it lies on, a pixel out: his chest, then his belly
            const front = (ly: number): number => {
                let fx = -99
                for (const [cx, cy, rx, ry] of [[-2, -88, 28, 18], [4, -62, 30, 26]] as const) {
                    const v = (ly - cy) / ry
                    if (Math.abs(v) < 1) fx = Math.max(fx, cx + rx * Math.sqrt(1 - v * v))
                }
                return fx + 1 / AP_SCALE
            }
            const out = front(APRON_DROP)
            const outline: number[] = []
            for (let ly = APRON_TOP; ly <= APRON_DROP; ly += 3) outline.push(...up(front(ly), ly))
            // off the belly it hangs straight, flaring a little to the hem; back across his knees,
            // and up his flank to the tie and the bib
            for (const [a, b] of [[out + 1, -40], [out + 3, APRON_HEM], [14, APRON_HEM + 2], [-2, APRON_HEM], [-4, -40], [-2, -58], [4, -76], [6, APRON_TOP + 1]] as const) outline.push(...up(a, b))
            const am = mask(s, 'apron')
            poly(am, outline, 0, 0, 1)
            vol(s, am, LEATHER, 10, 0.05)
            selOut(s, am, C.brown0)
            eachPx(am, (px_, py) => { if (hash2(px_, py) < 0.03) s.set(px_, py, C.brown0) })
            // where it is pulled over the belly it catches the light
            for (let ly = APRON_TOP + 8; ly < APRON_DROP; ly++) { const [a, b] = up(front(ly) - 2 / AP_SCALE, ly); if (am.get(R(a), R(b))) px(s, a, b, C.brown3) }
            // folds falling from the belly to the hem, where it hangs free
            for (const [fx, sway] of [[out - 3, 1], [out - 13, -1], [out - 24, 1]] as const) {
                for (let ly = APRON_DROP + 10; ly < APRON_HEM - 1; ly++) {
                    const [a, b] = up(fx + Math.sin((ly - APRON_DROP) * 0.18) * sway, ly)
                    if (!am.get(R(a), R(b)) || !am.get(R(a) + 1, R(b))) continue
                    px(s, a, b, C.brown0)
                    px(s, a + 1, b, C.brown2)
                }
            }
            // a scorched, ragged hem
            for (let i = 0; i < 6; i++) { const [a, b] = up(2 + i * 6, APRON_HEM + 1); px(s, a, b, C.ink); px(s, a + 1, b - 1, C.brown0) }
            // scorch and burn holes, each rimmed with the glow still in it
            for (const [bx, by] of [[22, -46], [8, -36], [24, -72]] as const) {
                const [a, b] = up(bx, by)
                disc(s, a, b, 2, C.ink)
                px(s, a - 2, b, C.orange); px(s, a + 1, b - 2, C.lava1)
            }
            // the pocket, low on the front where it hangs, a wrench and a pair of tongs in it
            const [p0x, p0y] = up(out - 16, -38)
            const pm = mask(s, 'pocket')
            poly(pm, [p0x - k(8), p0y, p0x + k(8), p0y - 1, p0x + k(7), p0y + k(10), p0x - k(7), p0y + k(10)], 0, 0, 1)
            vol(s, pm, LEATHER, 4, -0.1)
            line(s, p0x - k(8), p0y, p0x + k(8), p0y - 1, C.brown3)
            line(s, p0x - k(3), p0y, p0x - k(5), p0y - k(9), C.steel2, 2)
            disc(s, p0x - k(5), p0y - k(10), 2, C.steel2); px(s, p0x - k(5), p0y - k(10), C.steel0)
            line(s, p0x + k(3), p0y, p0x + k(5), p0y - k(8), C.steel1)
            line(s, p0x + k(4), p0y, p0x + k(7), p0y - k(7), C.steel1)
            // the tie round his waist, knotted at his back, its ends hanging
            const [t0x, t0y] = up(-2, -58)
            const [t1x, t1y] = up(-24, -60)
            line(s, t0x, t0y, t1x, t1y, C.brown1, 3)
            line(s, t0x, t0y - 1, t1x, t1y - 1, C.brown2)
            disc(s, t1x, t1y, k(2.5), C.brown1)
            line(s, t1x, t1y, t1x - k(3), t1y + k(9), C.brown1, 2)
            line(s, t1x + 1, t1y, t1x + k(3), t1y + k(8), C.brown0, 2)
            // the strap from the bib up round his neck, under his jaw
            const [n0x, n0y] = up(7, APRON_TOP + 1)
            const [n1x, n1y] = up(18, -104)
            line(s, n0x, n0y, n1x, n1y, C.brown1, 3)
            const [n2x, n2y] = up(front(APRON_TOP) - 2, APRON_TOP)
            const [n3x, n3y] = up(front(APRON_TOP) + 2, -99)
            line(s, n2x, n2y, n3x, n3y, C.brown1, 3)
            px(s, n0x, n0y, C.steel2)
        }

        // ── his head: small for him, heavy-jawed, two tusks, a big nose, a tuft under a cloth cap ──
        {
            const hx = 32
            const hy = -102 + R(bz(0, -3, 4))
            const [cx, cy] = up(hx, hy)
            const open = st === 'attack' || st === 'special' ? Math.max(B.strike ? 1 : 0, B.rec * 0.6) : B.roar ? 1 : 0
            // the jaw, jutting
            const jm = mask(s, 'jaw')
            const [jx, jy] = up(hx + 5, hy + 8 + open * 3)
            ellipse(jm, jx, jy, k(11), k(7), 1)
            vol(s, jm, OGRE, 6, -0.05)
            selOut(s, jm, C.ink)
            // the skull
            const m = mask(s, 'head')
            disc(m, cx, cy, k(15), 1)
            ellipse(m, cx + k(3), cy + k(3), k(14), k(11), 1)
            vol(s, m, OGRE, 10, 0.05)
            selOut(s, m, C.ink)
            // the ear
            disc(s, cx - k(10), cy + 1, k(3.5), C.olive1); px(s, cx - k(10), cy + 1, C.olive0)
            // the mouth: a gap between jaw and skull, open on the swing and the bellow
            const [mx, my] = up(hx + 8, hy + 5)
            line(s, mx - k(6), my, mx + k(7), my - 1 + open, C.ink, 1 + R(open * 2))
            if (open > 0.5) line(s, mx - k(4), my + 1, mx + k(5), my + 1, C.red1)
            // tusks jutting up from the underbite
            for (const [tx, h] of [[hx + 4, 6], [hx + 12, 5]] as const) {
                const [ax, ay] = up(tx, hy + 7 + open * 3)
                poly(s, [ax - 1.5, ay, ax + 1.5, ay, ax + 0.5, ay - k(h)], 0, 0, C.bone1)
                px(s, ax + 0.5, ay - k(h), C.white)
            }
            // the nose, a knob; a heavy brow and a small eye under it
            const [nx, ny] = up(hx + 13, hy - 1)
            disc(s, nx, ny, k(4), C.olive2); px(s, nx - 1, ny - 2, C.bone1); px(s, nx + 2, ny + 2, C.olive0)
            const [ex, ey] = up(hx + 6, hy - 4)
            line(s, ex - k(4), ey - 3, ex + k(4), ey - 2, C.olive0, 2)
            px(s, ex, ey, C.ink); px(s, ex + 1, ey, B.hurt ? C.white : C.bone1)
            // soot smudged on his cheek
            for (let i = 0; i < 6; i++) px(s, cx - 2 + (i % 3) * 2, cy + 3 + (i >> 1), C.olive0)
            // the cap: a slouched cloth cap on the back of his head, a tuft of hair out from under it
            const [c0x, c0y] = up(hx - 12, hy - 8)
            const capm = mask(s, 'cap')
            poly(capm, [c0x, c0y + k(2), c0x + k(6), c0y - k(10), c0x + k(18), c0y - k(9), c0x + k(20), c0y - k(3), c0x + k(10), c0y + k(1)], 0, 0, 1)
            vol(s, capm, { ramp: [C.red0, C.red1, C.red2, C.red3], hi: C.red3, rim: C.red0 }, 5)
            selOut(s, capm, C.ink)
            for (let i = 0; i < 4; i++) line(s, c0x + k(16) + i, c0y - 2, c0x + k(19) + i * 1.5, c0y + 3, i & 1 ? C.brown2 : C.brown1)
        }

        // ── the sledgehammer: a long haft, iron-banded, a dented iron head too big for it ──
        {
            const bx = Gx - ca * k(HAFT_BUTT)
            const by = Gy - sa * k(HAFT_BUTT)
            const hx = Gx + ca * k(HAFT_HEAD)
            const hy = Gy + sa * k(HAFT_HEAD)
            const hm = mask(s, 'haft')
            taper(hm, bx, by, hx, hy, k(6), k(5), 1)
            vol(s, hm, WOOD, 3)
            selOut(s, hm, C.brown0)
            // iron bands up the haft, and the butt capped in iron above his near hand
            for (const d of [HAND_GAP + 12, HAFT_HEAD - 16]) { const cx = Gx + ca * k(d); const cy = Gy + sa * k(d); line(s, cx - sa * k(3), cy + ca * k(3), cx + sa * k(3), cy - ca * k(3), C.steel1, 2) }
            disc(s, bx, by, k(3.5), C.steel1)
            px(s, bx - 1, by - 1, C.steel3)
            // the head: a block set across the haft
            const nx = -sa
            const ny = ca
            const hw = k(15)
            const hl = k(9)
            const im = mask(s, 'hhead')
            poly(im, [hx + nx * hw - ca * hl, hy + ny * hw - sa * hl, hx + nx * hw + ca * hl, hy + ny * hw + sa * hl, hx - nx * hw + ca * hl, hy - ny * hw + sa * hl, hx - nx * hw - ca * hl, hy - ny * hw - sa * hl], 0, 0, 1)
            vol(s, im, IRON, 8)
            selOut(s, im, C.steel0)
            // its striking faces, battered, and a dent
            for (const d of [-1, 1]) line(s, hx + nx * hw * d - ca * hl, hy + ny * hw * d - sa * hl, hx + nx * hw * d + ca * hl, hy + ny * hw * d + sa * hl, d > 0 ? C.steel3 : C.steel0, 2)
            disc(s, hx + nx * k(4) + ca * 2, hy + ny * k(4) + sa * 2, 2, C.steel1)
            px(s, hx - nx * k(6), hy - ny * k(6), C.steel3)
        }

        // ── his far hand, closed round the haft below his near hand: in front of the haft it grips,
        //    though the arm it is on is behind him ──
        {
            const gm = mask(s, 'fglove')
            disc(gm, Fx, Fy, k(6.5), 1)
            vol(s, gm, LEATHER, 5, -0.2)
            selOut(s, gm, C.ink)
        }

        // ── his near arm over the haft, the glove closed on it ──
        {
            const [sx, sy] = up(4, -88)
            elbow(sx, sy, Gx, Gy, k(28), k(28), 1)
            limb(s, 'narm', [sx, sy, P.x, P.y, Gx, Gy], [k(21), k(17), k(14)], OGRE, 0, C.ink)
            // the heavy work glove and its cuff
            const gm = mask(s, 'glove')
            disc(gm, Gx, Gy, k(7.5), 1)
            const cx = P.x + (Gx - P.x) * 0.7
            const cy = P.y + (Gy - P.y) * 0.7
            disc(gm, cx, cy, k(7), 1)
            vol(s, gm, LEATHER, 6)
            selOut(s, gm, C.ink)
            line(s, cx - k(5), cy - k(3), cx + k(4), cy + k(4), C.brown3)
        }

        if (off) shift(s, off, 0, s.h)
        B.ent = 1
        finish(s, Entry.Walk, 18)
        void fr
    },
    fx(dst, st, t, x, y, dir) {
        // the slam: stone and sparks thrown up where the hammer lands
        if (st === 'attack' && B.strike) {
            const gx = x + dir * RUN_REACH * AP_SCALE
            for (let i = 0; i < 18; i++) {
                const a = i / 18 * Math.PI
                dst.set(R(gx + Math.cos(a) * (8 + (i & 1) * 8)), R(y - 2 - Math.sin(a) * (6 + (i % 3) * 5)), i % 3 === 0 ? C.gold3 : i & 1 ? C.stone3 : C.bone1)
            }
        }
        // stomping in: dust off each footfall
        if (st === 'entry' && q(t) < this.states.entry!.dur * ENTRY_SETTLED) {
            const k = fr(t, 10, 6)
            for (let i = 0; i < 6; i++) dst.set(x - dir * (14 + ((i * 11 + k * 7) % 30)), y - ((i + k) % 3), C.stone3)
        }
        void sm
    }
}

// ═══════════════════════════════════════════════════════════════ 2 · The Journeyman

/** The cyclops's hide, a deep sea-teal, after the user's reference (cyclops-smith.png, top left). */
const CYCLOPS: Mat5 = { ramp: [C.teal0, C.teal0, C.teal1, C.teal2], hi: C.steel2, rim: C.teal0 }
/** Seconds into his entrance at which he lands, and how far above he falls from. */
const JM_LAND = 0.6
const JM_FALL = 240

/**
 * Quench, in seconds: he raises the red-hot bar in his tongs until it blazes white (QUENCH_RAISE),
 * lifts the pail up before him in his other hand, lowers the tongs until the bar hangs straight
 * down over it (QUENCH_OVER), dips it in (QUENCH_IN; it touches the water at QUENCH_PLUNGE), holds
 * it under, stirring, and lifts it out dripping at QUENCH_OUT. A geyser of steam bursts up out of
 * the pail and rolls out over the whole party. The bar comes out cold grey and glows back to red.
 */
const QUENCH_DUR = 2.8
const QUENCH_RAISE = 0.7
const QUENCH_LOWER = 0.85
const QUENCH_OVER = 1.05
const QUENCH_IN = 1.17
const QUENCH_OUT = 1.8
const QUENCH_PLUNGE = 1.09
const STEAM6: Ramp6 = [C.white, C.white, C.frost, C.bone1, C.stone3, C.stone2]
/** How many puffs the steam is made of, and how long each lives. */
const QUENCH_PUFFS = 40
const QUENCH_PUFF_LIFE = 1.0

/** His shoulders, the front one (toward the party) and the back one, from his mark. */
const FRONT_SHOULDER = [28, -90] as const
const BACK_SHOULDER = [-26, -90] as const
/** The top of his apron's bib, a hand below his chin so the straps show up his neck. */
const BIB_TOP = -92
/** His head's middle; how far along the tongs the bar sits. */
const HEAD_X = 4
const HEAD_Y = -114
const BILLET_MID = 44
/** The tongs' length from his fist to their jaws, and the bar's half-length and thickness. */
const TONGS_LEN = 38
const BAR_HALF = 11
const BAR_W = 7

/**
 * His front hand with the tongs, and the tongs' angle, in his layout: at rest raised before him, the
 * bar held up; drawn back over his head for the sweep and swept down through the front rank. Quench
 * moves his whole arm (below).
 */
const TONGS_REST = [52, -72, -1.4] as const
const TONGS_WIND = [36, -126, -2.4] as const
const TONGS_STRIKE = [56, -58, 0.5] as const
/** The pail held up before him through the quench, its rim's middle; and at rest, hanging from his back hand. */
const PAIL_UP = [16, -46] as const
const PAIL_REST = [-38, -32] as const
/**
 * Through Quench his fist, his elbow and the tongs move together: the tongs stay in line with his
 * forearm, turning over with his arm as he lifts his elbow, never twisting at the wrist. Raised
 * high, forearm and tongs pointing up; over the pail, the elbow lifted and forearm and tongs
 * pointing down into it; dipped, the whole arm lowered a hand's breadth. Each is [fist, elbow].
 */
const DIP_HIGH = [[42, -114], [54, -80]] as const
const DIP_OVER = [[35, -93], [47, -114]] as const
const DIP_IN = [[35, -81], [50, -105]] as const

const mix3 = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k, (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * k]

type Dip = readonly (readonly [number, number])[]
const lerpDip = (a: Dip, b: Dip, u: number): [number, number, number, number] => [
    a[0]![0] + (b[0]![0] - a[0]![0]) * u, a[0]![1] + (b[0]![1] - a[0]![1]) * u,
    a[1]![0] + (b[1]![0] - a[1]![0]) * u, a[1]![1] + (b[1]![1] - a[1]![1]) * u
]

/**
 * His front fist with the tongs and their own angle, in his layout; then his elbow through Quench,
 * and how far the dip sets it and lays the tongs along his forearm (0 at rest, the arm solved and
 * the tongs at their own angle; 1 through the dip).
 */
function tongsPose(st: string, t: number): [number, number, number, number, number, number] {
    if (st === 'special') {
        const q0 = q(t)
        const REST: Dip = [[TONGS_REST[0], TONGS_REST[1]], DIP_HIGH[1]]
        const out = (p: [number, number, number, number], w: number): [number, number, number, number, number, number] => [p[0], p[1], TONGS_REST[2], p[2], p[3], w]
        if (q0 < QUENCH_RAISE) { const u = sm(span(0.1, QUENCH_RAISE, q0)); return out(lerpDip(REST, DIP_HIGH, u), u) }
        if (q0 < QUENCH_LOWER) return out(lerpDip(DIP_HIGH, DIP_HIGH, 0), 1)
        // lowered over the pail: the elbow comes up and the tongs turn over with the forearm
        if (q0 < QUENCH_OVER) return out(lerpDip(DIP_HIGH, DIP_OVER, sm(span(QUENCH_LOWER, QUENCH_OVER, q0))), 1)
        // and dipped: the whole arm lowered, straight down
        if (q0 < QUENCH_IN) return out(lerpDip(DIP_OVER, DIP_IN, sm(span(QUENCH_OVER, QUENCH_IN, q0))), 1)
        if (q0 < QUENCH_OUT) {
            // held under, stirred a little
            const w = Math.sin((q0 - QUENCH_IN) * 14) * (1 - span(QUENCH_IN, QUENCH_OUT, q0))
            const p = lerpDip(DIP_IN, DIP_IN, 0)
            return out([p[0] + w, p[1], p[2] + w, p[3]], 1)
        }
        if (q0 < QUENCH_OUT + 0.15) return out(lerpDip(DIP_IN, DIP_OVER, sm(span(QUENCH_OUT, QUENCH_OUT + 0.15, q0))), 1)
        const u = sm(span(QUENCH_OUT + 0.15, QUENCH_DUR - 0.1, q0))
        return out(lerpDip(DIP_OVER, REST, u), 1 - u)
    }
    return [bz(TONGS_REST[0], TONGS_WIND[0], TONGS_STRIKE[0]), bz(TONGS_REST[1], TONGS_WIND[1], TONGS_STRIKE[1]), bz(TONGS_REST[2], TONGS_WIND[2], TONGS_STRIKE[2]), 0, 0, 0]
}

/** Angle `a` turned `w` of the short way round toward `b`. */
function turnToward(a: number, b: number, w: number): number {
    const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    return a + d * w
}

/** Where the pail's rim is at `t`: hanging at his side, or lifted up before him for the quench. */
function pailAt(st: string, t: number): [number, number] {
    if (st !== 'special') return [PAIL_REST[0], PAIL_REST[1]]
    const q0 = q(t)
    const k = sm(span(0.35, QUENCH_OVER - 0.1, q0)) * (1 - sm(span(QUENCH_OUT + 0.15, QUENCH_DUR - 0.15, q0)))
    const [x, y] = mix3(PAIL_REST, PAIL_UP, k)
    return [x, y]
}

/** How hot the bar is at `t`: 1 glowing at rest, more on the raise, cold after the quench and heating back. */
function billetHeat(st: string, t: number): number {
    if (st !== 'special') return 1
    const q0 = q(t)
    if (q0 < QUENCH_PLUNGE) return 1 + 0.6 * sp(q0, 0.2, QUENCH_RAISE)
    return sp(q0, 1.6, QUENCH_DUR - 0.1)
}

/** The bar's colours, cold steel to white-hot, by heat. */
function billetColours(heat: number): readonly [number, number, number] {
    if (heat > 1.3) return [C.gold3, C.white, C.white]
    if (heat > 0.8) return [C.lava1, C.orange, C.gold2]
    if (heat > 0.5) return [C.lava0, C.lava1, C.orange]
    if (heat > 0.2) return [C.steel0, C.lava0, C.lava1]
    return [C.steel0, C.steel1, C.steel2]
}

/** A puff of steam at (x, y), `r` across, `level` of 16 through the dither: a white core in grey. */
function puff(s: Surface, x: number, y: number, r: number, level: number): void {
    const cx = R(x)
    const cy = R(y)
    const rr = R(r)
    for (let yy = -rr; yy <= rr; yy++) {
        for (let xx = -rr; xx <= rr; xx++) {
            const d2 = xx * xx + yy * yy
            if (d2 > r * r || !bayer(cx + xx, cy + yy, level)) continue
            s.set(cx + xx, cy + yy, d2 < r * r * 0.3 && yy < 0 ? C.white : yy < 0 ? C.bone1 : C.stone3)
        }
    }
}

/** Quench: the bar dipped into the pail, a geyser of steam rolling out over all six of them. */
const QUENCH: BossSpecial = {
    name: 'Quench', tint: 'night1', hits: [1.25, 1.3, 1.35, 1.45, 1.5, 1.55], spread: true,
    fx(s, t, st) {
        const d = st.dir
        const u = sq(t)
        // the bar blazing as he holds it high
        const g = sp(u, 0.25, QUENCH_RAISE) * (1 - sp(u, QUENCH_LOWER, QUENCH_OVER))
        if (g > 0) {
            const ha = Math.atan2(DIP_HIGH[0][1] - DIP_HIGH[1][1], DIP_HIGH[0][0] - DIP_HIGH[1][0])
            const hx = st.bx + d * (-8 + DIP_HIGH[0][0] + Math.cos(ha) * BILLET_MID)
            const hy = st.by + DIP_HIGH[0][1] + Math.sin(ha) * BILLET_MID
            const r = 6 + g * 6
            for (let yy = -R(r); yy <= R(r); yy++) {
                for (let xx = -R(r); xx <= R(r); xx++) {
                    if (xx * xx + yy * yy > r * r || !bayer(R(hx) + xx, R(hy) + yy, R(g * 6))) continue
                    s.set(R(hx) + xx, R(hy) + yy, xx * xx + yy * yy < r * r * 0.3 ? C.gold3 : C.orange)
                }
            }
        }
        // the pail held up before him, in the scene
        const tx = st.bx + d * (-8 + PAIL_UP[0])
        const ty = st.by + PAIL_UP[1]
        if (u >= QUENCH_PLUNGE && u < QUENCH_PLUNGE + 0.07) disc(s, tx, ty, 9, C.white)
        shockRing(s, tx, ty, t, QUENCH_PLUNGE, 0.3, 6, 36, C.white)
        // water thrown up out of it
        for (let i = 0; i < 14; i++) {
            const a = u - QUENCH_PLUNGE - hash2(i, 3) * 0.05
            if (a <= 0 || a > 0.6) continue
            const ang = -Math.PI / 2 + (hash2(i, 5) - 0.5) * 1.6
            const v = 80 + hash2(i, 7) * 70
            px(s, tx + d * Math.cos(ang) * v * a, ty + Math.sin(ang) * v * a + 200 * a * a, a < 0.25 ? C.frost : C.cyan)
        }
        // drips off the bar as it comes up out of the water
        for (let i = 0; i < 6; i++) {
            const a = u - QUENCH_OUT - i * 0.06
            if (a <= 0 || a > 0.35) continue
            px(s, tx + d * ((i % 3) - 1), ty - 4 + 260 * a * a, a < 0.15 ? C.frost : C.cyan)
        }
        // the geyser: steam shooting up out of the pail
        for (let j = 0; j < 14; j++) {
            const a = (u - QUENCH_PLUNGE - j * 0.03) / 0.8
            if (a < 0 || a >= 1) continue
            puff(s, tx + (hash2(j, 9) - 0.5) * 10 * a, ty - a * 70 - j * 2, 4 + a * 10, R(15 * (1 - a)))
        }
        // and the cloud rolling out low over the party
        for (let j = 0; j < QUENCH_PUFFS; j++) {
            const t0 = QUENCH_PLUNGE + 0.05 + j * 0.012
            const a = (u - t0) / QUENCH_PUFF_LIFE
            if (a < 0 || a >= 1) continue
            const px1 = st.bx + d * (60 + hash2(j, 23) * 90)
            const py1 = st.by - 6 - hash2(j, 29) * 30
            const e = 1 - (1 - a) * (1 - a)
            const py0 = ty - 6 + (hash2(j, 31) - 0.5) * 10
            puff(s, tx + (px1 - tx) * e, py0 + (py1 - py0) * e - Math.sin(a * Math.PI) * 12, 5 + a * 15, R(15 * (1 - a * a)))
        }
        for (let i = 0; i < QUENCH.hits.length; i++) {
            const pt = hitTarget(st, i, true)
            blast(s, pt.x, chest(pt), t, QUENCH.hits[i]!, 10, 0.45, STEAM6, 81 + i, 'frost')
        }
    }
}

/**
 * The Journeyman: a cyclops smith, one of the giant-kin who were the smiths of myth, after the
 * user's reference (cyclops-smith.png, top left). Drawn three-quarters to the front, facing the
 * party. A deep sea-teal hide, massive in the shoulder and arm, standing wide on bare feet; a big
 * bald head, one yellow eye in the middle of his face under a heavy brow, small tusks up from his
 * lower jaw, pointed ears. A brown leather apron, its bib with a pocket, straps over his shoulders,
 * tied at the waist, hanging to his knees. His front hand holds his tongs up, a red-hot bar gripped
 * crosswise in their jaws; his back hand carries a steel pail. He works raw iron, between the
 * Apprentice's bare hammer and the Forgemaster's finished blade. He drops in from above, lands in a
 * crouch and opens his eye; he sweeps the bar from over his head down through the front rank in an
 * arc of fire; he falls to his knees and pitches forward, his eye going dark.
 */
export const FORGE_JOURNEYMAN: CreatureDef = {
    name: 'The Journeyman', size: 256, room: 24, shadow: 40, accent: C.orange, advance: 10,
    states: withSpecial(bossStates(1.5, 1.8, 2.2), QUENCH_DUR),
    special: QUENCH,
    draw(s, st, t) {
        drive(this, st, t, 12, 1.8)
        const tt = q(t)
        const x = s.ax - 8 + B.lunge - B.kb
        const y = s.ay
        // dropping in: nothing but a growing shadow, then a fall, then the crouch of the landing and
        // his eye opening
        let drop = 0
        let crouch = 0
        let eye = 1
        if (st === 'entry') {
            if (tt < JM_LAND) {
                const k = Math.max(0, (tt - 0.1) / (JM_LAND - 0.1))
                drop = -R((1 - k * k) * JM_FALL)
                CF.shadow = 0.1 + 0.9 * k * k
                eye = 0
            } else {
                const a = tt - JM_LAND
                crouch = 14 * Math.exp(-5 * a) * Math.cos(a * Math.PI * 3)
                eye = Math.min(1, Math.max(0, (tt - JM_LAND - 0.35) / 0.3))
            }
        }
        // dying: his knees go, he pitches forward, and the eye goes dark
        if (st === 'death') { crouch = B.die * 26; eye = 1 - Math.min(1, B.die * 1.5) }
        if (B.hurt) eye = Math.min(eye, 0.45)
        const tilt = bz(0, -0.05, 0.1) + B.die * 0.45
        const at = (lx: number, ly: number): [number, number] => { rot(x + lx, y + ly, x, y, tilt); return [T.x, T.y] }
        // his upper body leans into the sweep, rides the crouch and breathes
        const up = (lx: number, ly: number): [number, number] => at(lx + bz(0, -4, 6) * Math.max(0, -ly - 50) / 50, ly + crouch + B.breath * 0.6)
        const glow = B.glow > 0.5 || B.roar

        // an arm, heavy with muscle: a deltoid capping the shoulder, a bicep swelling the upper arm,
        // the forearm thick below the elbow, a big fist
        // an arm, heavy with muscle: the upper arm with a bicep swelling it, the forearm thick below
        // the elbow and narrowing to the wrist, and the deltoid its own lit cap over the top of it,
        // overlapping his chest. The fist is drawn apart (`grip`), over whatever it holds
        const arm = (key: string, sx: number, sy: number, ex: number, ey: number, hx: number, hy: number, back: boolean): void => {
            const ux = sx + (ex - sx) * 0.55
            const uy = sy + (ey - sy) * 0.55
            const lx = ex + (hx - ex) * 0.3
            const ly = ey + (hy - ey) * 0.3
            limb(s, key, [sx, sy, ux, uy, ex, ey, lx, ly, hx, hy], [17, 18, 14, 16, 11], CYCLOPS, back ? -0.2 : 0, C.ink)
            // the bicep's lit ridge, and the crease between the forearm's muscles
            const dx = ex - sx
            const dy = ey - sy
            const dl = Math.hypot(dx, dy) || 1
            const nx = -dy / dl
            const ny = dx / dl
            line(s, sx + dx * 0.4 + nx * 5, sy + dy * 0.4 + ny * 5, sx + dx * 0.75 + nx * 4, sy + dy * 0.75 + ny * 4, C.teal2)
            line(s, lx - 2, ly, lx + 2, ly + 3, C.teal0)
            // the deltoid: a cap over the shoulder, longer down the arm than across it
            const dm = mask(s, key + 'd')
            const cx = sx + dx * 0.16
            const cy = sy + dy * 0.16
            const pts: number[] = []
            for (let k = 0; k < 20; k++) {
                const a = k / 20 * Math.PI * 2
                const al = Math.cos(a) * 13
                const ac = Math.sin(a) * 11
                pts.push(cx + (dx / dl) * al + nx * ac, cy + (dy / dl) * al + ny * ac)
            }
            poly(dm, pts, 0, 0, 1)
            vol(s, dm, CYCLOPS, 7, back ? -0.1 : 0.12)
            selOut(s, dm, C.teal0)
        }
        // a fist closed round a handle running along `a`: wider across the handle than along it,
        // the fingers wrapped round it in rows, the knuckles lit, the thumb over the top
        const grip = (key: string, hx: number, hy: number, a: number, back: boolean): void => {
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            const m = mask(s, key)
            const pts: number[] = []
            for (let k = 0; k < 18; k++) {
                const b = k / 18 * Math.PI * 2
                const across = Math.cos(b) * 7.5
                const along = Math.sin(b) * 6.5
                pts.push(hx - sa * across + ca * along, hy + ca * across + sa * along)
            }
            poly(m, pts, 0, 0, 1)
            vol(s, m, CYCLOPS, 4, back ? -0.2 : 0.05)
            selOut(s, m, C.ink)
            // the rows of fingers, across the handle
            for (const k of [-2.5, 0.5, 3.5]) line(s, hx + ca * k - sa * 5, hy + sa * k + ca * 5, hx + ca * k - sa * 1, hy + sa * k + ca * 1, C.teal0)
            // the knuckles' lit ridge, and the thumb over the top of the fist
            line(s, hx - sa * 6 - ca * 3, hy + ca * 6 - sa * 3, hx - sa * 6 + ca * 4, hy + ca * 6 + sa * 4, C.teal2)
            disc(s, hx + sa * 2 - ca * 5, hy - ca * 2 - sa * 5, 2.5, C.teal1)
            px(s, hx + sa * 2 - ca * 6, hy - ca * 2 - sa * 6, C.teal2)
        }

        // ── legs, planted wide, thick and bare to his broad feet ──
        const leg = (hx: number, fx: number, back: boolean): void => {
            const [a, b] = up(hx, -44)
            const [f, g] = at(fx, -6)
            elbow(a, b, f, g, 22, 21, back ? 1 : -1)
            const cx = P.x + (f - P.x) * 0.35
            const cy = P.y + (g - P.y) * 0.35
            limb(s, back ? 'jbl' : 'jfl', [a, b, P.x, P.y, cx, cy, f, g], [24, 17, 18, 13], CYCLOPS, back ? -0.2 : 0, C.ink)
            // the kneecap's light, and a broad bare foot with its toes
            px(s, P.x, P.y - 2, C.teal3)
            const fm = mask(s, back ? 'jbfoot' : 'jffoot')
            ellipse(fm, f + 3, g + 2, 11, 5, 1)
            vol(s, fm, CYCLOPS, 4, back ? -0.2 : 0)
            selOut(s, fm, C.ink)
            for (let k = 0; k < 3; k++) { const tx = f + 7 + k * 3; px(s, tx, g + 4, C.teal0); px(s, tx, g + 1, C.teal3) }
        }
        leg(-10, -18, true)
        leg(8, 16, false)

        // ── the body, three-quarters to the front: a huge chest, a thick waist, traps up to a short
        //    neck ──
        const body = mask(s, 'jbody')
        {
            const [wx, wy] = up(0, -58)
            ellipse(body, wx, wy, 21, 14, 1)
            const [l0x, l0y] = up(0, -62)
            const [l1x, l1y] = up(0, -82)
            taper(body, l0x, l0y, l1x, l1y, 42, 56, 1)
            const [cx, cy] = up(1, -86)
            ellipse(body, cx, cy, 32, 16, 1)
            const [n0x, n0y] = up(0, -96)
            const [n1x, n1y] = up(HEAD_X, -104)
            taper(body, n0x, n0y, n1x, n1y, 52, 34, 1)
            // round off both ends of the neck: the taper's square ends left corners poking out, the
            // tilted base's one above his shoulder beside his jaw
            disc(body, n1x, n1y, 17, 1)
            disc(body, n0x, n0y, 24, 1)
            vol(s, body, CYCLOPS, 22)
            // his chest to either side of the bib: the line under each pec, lit above it
            for (const side of [-1, 1]) for (let k = 0; k <= 8; k++) {
                const [a, b] = up(side * (12 + k * 1.6), -82 + k * 0.3 - Math.sin(k / 8 * Math.PI) * 2)
                if (!body.get(R(a), R(b))) continue
                px(s, a, b, C.teal0)
                px(s, a, b - 1, C.teal3)
            }
            selOut(s, body, C.ink)
        }
        // the apron: brown leather, a bib with a pocket up his chest, straps over his shoulders, tied
        // at the waist, hanging to his knees
        {
            const am = mask(s, 'apron')
            poly(am, [[-12, BIB_TOP], [14, BIB_TOP], [16, -64], [24, -62], [26, -34], [14, -31], [0, -33], [-14, -31], [-24, -34], [-22, -62], [-14, -64]].flatMap(([a, b]) => up(a!, b!)), 0, 0, 1)
            vol(s, am, LEATHER, 10, 0.05)
            selOut(s, am, C.brown0)
            eachPx(am, (px_, py) => { if (hash2(px_, py) < 0.03) s.set(px_, py, C.brown0) })
            // the folds falling to the hem
            for (const fx of [-12, 2, 14]) for (let ly = -56; ly < -34; ly++) { const [a, b] = up(fx + Math.sin(ly * 0.25) * 0.8, ly); px(s, a, b, C.brown1) }
            // the pocket on the bib, stitched
            const [p0x, p0y] = up(-7, -85)
            const [p1x, p1y] = up(9, -74)
            const pm = mask(s, 'jpocket')
            poly(pm, [p0x, p0y, p1x, p0y, p1x, p1y, p0x, p1y], 0, 0, 1)
            vol(s, pm, LEATHER, 4, -0.1)
            selOut(s, pm, C.brown0)
            line(s, p0x, p0y, p1x, p0y, C.brown3)
            for (let k = 0; k < 6; k++) px(s, p0x + 1 + k * 2.6, p0y + 2, C.brown1)
            // the straps: from the bib's top corners up both sides of his neck and behind his jaw, as
            // in the reference, riveted where they meet the bib
            for (const [a0, a1] of [[-10, -14], [12, 17]] as const) {
                const [s0x, s0y] = up(a0, BIB_TOP + 1)
                const [s1x, s1y] = up(a1, BIB_TOP - 20)
                line(s, s0x, s0y, s1x, s1y, C.brown1, 4)
                line(s, s0x - 1, s0y, s1x - 1, s1y, C.brown2)
                line(s, s0x + 2, s0y, s1x + 2, s1y, C.brown0)
                px(s, s0x, s0y + 1, C.steel2)
            }
            // the tie at his waist, knotted at the side, its ends hanging
            const [t0x, t0y] = up(-22, -63)
            const [t1x, t1y] = up(24, -63)
            line(s, t0x, t0y, t1x, t1y, C.brown1, 2)
            line(s, t0x, t0y - 1, t1x, t1y - 1, C.brown2)
            const [kx, ky] = up(8, -63)
            disc(s, kx, ky, 2, C.brown1)
            line(s, kx, ky, kx - 2, ky + 9, C.brown1, 2)
            line(s, kx + 1, ky, kx + 3, ky + 8, C.brown0, 2)
        }

        // ── his head: big and bald, one great yellow eye in the middle of his face under a heavy
        //    brow, a wide mouth with small tusks up from the lower jaw, pointed ears ──
        {
            const hy = HEAD_Y + R(bz(0, -2, 3))
            const at2 = (dx: number, dy: number): [number, number] => up(HEAD_X + dx, hy + dy)
            const open = st === 'attack' ? Math.max(B.strike ? 1 : 0, B.rec * 0.5) : B.roar || (st === 'special' && B.sp > 0.35 && B.sp < 0.6) ? 1 : 0
            // the great skull, squared at the sides, the broad heavy jaw, and the ears grown out of the
            // head itself so they share its light and outline: the near one (away from the party) in
            // full at eye level, pointed up and out; the far one, round the side his face turns to,
            // smaller, only its point showing past his cheek at eye level
            const m = mask(s, 'jhead')
            { const [a, b] = at2(2, 8 + open * 2); ellipse(m, a, b, 14, 9, 1) }
            { const [a, b] = at2(0, -2); disc(m, a, b, 16, 1) }
            { const [a, b] = at2(0, 1); ellipse(m, a, b, 16.5, 12, 1) }
            poly(m, [[-14, -6], [-25, -14], [-22, -6], [-15, 4]].flatMap(([a, b]) => at2(a!, b!)), 0, 0, 1)
            poly(m, [[14, -6], [21, -9], [16, 1]].flatMap(([a, b]) => at2(a!, b!)), 0, 0, 1)
            vol(s, m, CYCLOPS, 11, 0.08)
            selOut(s, m, C.ink)
            // the hollow of the near ear, and the crease where it meets the head
            { const [a, b] = at2(-18, -6); const [c, d] = at2(-22, -11); line(s, a, b, c, d, C.teal0, 2) }
            { const [a, b] = at2(-15, -5); const [c, d] = at2(-15, 3); line(s, a, b, c, d, C.teal0) }
            // light on the dome, a crease or two of brow above the eye
            { const [a, b] = at2(-5, -12); line(s, a, b, a + 6, b - 2, C.teal3); px(s, a - 1, b + 1, C.teal3) }
            // the mouth: a wide grim line, two small tusks up from the lower jaw at its corners
            const [mx, my] = at2(3, 10)
            line(s, mx - 7, my + open, mx + 8, my - 1 + open, C.ink, 1 + R(open * 2))
            if (open > 0.5) line(s, mx - 5, my + 2, mx + 6, my + 2, C.red1)
            for (const tx of [-5, 7]) {
                const [ax, ay] = at2(3 + tx, 11 + open * 2)
                poly(s, [ax - 1.5, ay, ax + 1.5, ay, ax + 0.5, ay - 5], 0, 0, C.bone1)
                px(s, ax + 0.5, ay - 5, C.white)
            }
            // the nose, broad and short under the eye
            { const [a, b] = at2(5, 4); disc(s, a, b, 3, C.teal2); px(s, a - 1, b + 2, C.teal0); px(s, a + 2, b + 2, C.teal0); px(s, a, b - 1, C.teal3) }
            // the one great eye, in the middle of his face: a deep socket, the white, a yellow iris
            // lit by the forge, a black pupil; the lids
            const [ex, ey] = at2(4, -4)
            ellipse(s, ex, ey, 6.5, 5.5, C.teal0)
            ellipse(s, ex, ey, 5.5, 4.5, C.bone1)
            const iris = B.hurt ? C.white : glow ? C.gold3 : C.gold2
            disc(s, ex + 0.5, ey, 3, iris)
            disc(s, ex + 0.5, ey, 1.5, glow ? C.orange : C.gold0)
            line(s, ex + 0.5, ey - 2, ex + 0.5, ey + 2, C.ink)
            px(s, ex - 1.5, ey - 2, C.white)
            const lid = R((1 - eye) * 10)
            for (let k = 0; k < lid; k++) line(s, ex - 6, ey - 5 + k, ex + 6, ey - 5 + k, k === lid - 1 ? C.teal0 : C.teal1)
            line(s, ex - 5, ey + 5, ex + 5, ey + 5, C.teal0)
            // the heavy brow over it
            const [b0x, b0y] = at2(-4, -10)
            const [b1x, b1y] = at2(12, -9)
            line(s, b0x, b0y, b1x, b1y, C.teal0, 3)
            line(s, b0x, b0y - 1, b1x, b1y - 1, C.teal2)
        }

        // ── his back arm, the pail's bail in his fist ──
        const [pax, pay] = pailAt(st, t)
        const [Px, Py] = up(pax, pay - 14)
        {
            const [sx, sy] = up(BACK_SHOULDER[0], BACK_SHOULDER[1])
            elbow(sx, sy, Px, Py, 30, 29, 1)
            arm('jbarm', sx, sy, P.x, P.y, Px, Py, true)
            grip('jbfist', Px, Py, Math.PI / 2, true)
        }

        // ── his front arm, the tongs held up in it, the red-hot bar crosswise in their jaws ──
        const [thx, thy, tpose, dex, dey, dw] = tongsPose(st, t)
        const [Tx, Ty] = up(thx, thy)
        const [fsx, fsy] = up(FRONT_SHOULDER[0], FRONT_SHOULDER[1])
        // his elbow bends down by his side, the upper arm hanging from the shoulder, as in the reference
        elbow(fsx, fsy, Tx, Ty, 25, 27, 1)
        let Ex = P.x
        let Ey = P.y
        if (dw > 0) { const [a, b] = up(dex, dey); Ex += (a - Ex) * dw; Ey += (b - Ey) * dw }
        // through the dip the tongs lie along his forearm
        const tang = dw > 0 ? turnToward(tpose + tilt, Math.atan2(Ty - Ey, Tx - Ex), dw) : tpose + tilt
        const tca = Math.cos(tang)
        const tsa = Math.sin(tang)
        {
            // the tongs' reins run back through his fist, so they go down before it
            const nx = -tsa
            const ny = tca
            const tx = Tx + tca * TONGS_LEN
            const ty = Ty + tsa * TONGS_LEN
            // the reins spread a little toward the jaws, which curl round the bar
            line(s, Tx - tca * 16 + nx * 1.5, Ty - tsa * 16 + ny * 1.5, tx + nx * 3, ty + ny * 3, C.steel1, 2)
            line(s, Tx - tca * 16 - nx * 1.5, Ty - tsa * 16 - ny * 1.5, tx - nx * 3, ty - ny * 3, C.steel0, 2)
            disc(s, Tx + tca * (TONGS_LEN - 10), Ty + tsa * (TONGS_LEN - 10), 2, C.steel2)
            // the bar: gripped crosswise across the jaws' tip, lit by its own heat
            const [edge, body2, core] = billetColours(billetHeat(st, t))
            const bm = mask(s, 'billet')
            taper(bm, tx - nx * BAR_HALF + tca * 3, ty - ny * BAR_HALF + tsa * 3, tx + nx * BAR_HALF + tca * 3, ty + ny * BAR_HALF + tsa * 3, BAR_W, BAR_W - 1, 1)
            eachPx(bm, (px_, py, e) => s.set(px_, py, e ? edge : (px_ + py) % 3 ? body2 : core))
            if (billetHeat(st, t) > 0.6) for (let k = 0; k < 4; k++) px(s, tx + nx * (k * 6 - 9) + tca * 3, ty + ny * (k * 6 - 9) + tsa * 3 - 6 - ((R(tt * 10) + k) % 3), C.orange)
            arm('jfarm', fsx, fsy, Ex, Ey, Tx, Ty, false)
            // the fist turned half round on the handles (the user): thumb and knuckles face the other way
            grip('jffist', Tx, Ty, tang + Math.PI, false)
        }

        // ── the pail: steel, a wire bail up to his fist, dark water in it ──
        {
            const [rx, ry] = up(pax, pay)
            line(s, Px, Py, rx - 8, ry, C.steel2)
            line(s, Px, Py, rx + 8, ry, C.steel2)
            const pm = mask(s, 'pail')
            poly(pm, [rx - 9, ry, rx + 9, ry, rx + 7, ry + 17, rx - 7, ry + 17], 0, 0, 1)
            vol(s, pm, IRON, 5)
            selOut(s, pm, C.steel0)
            line(s, rx - 9, ry, rx + 9, ry, C.steel3)
            line(s, rx - 8, ry + 1, rx + 8, ry + 1, C.teal0)
            line(s, rx - 7, ry + 9, rx + 7, ry + 9, C.steel0)
            px(s, rx - 3, ry + 1, C.teal2)
        }

        if (drop) shift(s, 0, drop, s.h)
        B.ent = 1
        finish(s, Entry.Drop, 14)
    },
    fx(dst, st, t, x, y, dir) {
        const tt = q(t)
        // landing: dust thrown out from under him
        if (st === 'entry' && tt >= JM_LAND && tt < JM_LAND + 0.7) {
            const a = (tt - JM_LAND) / 0.7
            for (const side of [-1, 1]) {
                for (let k = 0; k < 4; k++) {
                    const cx = R(x + side * (14 + a * (40 + k * 12)))
                    const cy = R(y - 4 - k * 2 - a * 8)
                    const r = 4 + a * 9
                    for (let j = 0; j < 16; j++) { const b = j / 16 * Math.PI * 2; if ((j + k) % 3) dst.set(R(cx + Math.cos(b) * r), R(cy + Math.sin(b) * r * 0.6), a < 0.5 ? C.bone1 : C.bone0) }
                }
            }
        }
        // the sweep: the arc of fire the bar swings through, round his front shoulder from over his
        // head down through the front rank; whole on the strike, burning away after
        if (st === 'attack' && (B.strike || B.rec > 0.5)) {
            const polar = (p: readonly number[]): [number, number] => {
                const bx = p[0]! + Math.cos(p[2]!) * BILLET_MID - FRONT_SHOULDER[0]
                const by = p[1]! + Math.sin(p[2]!) * BILLET_MID - FRONT_SHOULDER[1]
                return [Math.hypot(bx, by), Math.atan2(by, bx)]
            }
            const [r0, a0] = polar(TONGS_WIND)
            const [r1, a1] = polar(TONGS_STRIKE)
            const left = B.strike ? 1 : (B.rec - 0.5) / 0.5
            const n = R(Math.abs(a1 - a0) * Math.max(r0, r1) * 1.2)
            for (let i = 0; i <= n; i++) {
                const u = i / n
                if (u < 1 - left) continue
                const a = a0 + (a1 - a0) * u
                const r = r0 + (r1 - r0) * u
                const cx = FRONT_SHOULDER[0] + Math.cos(a) * r
                const cy = FRONT_SHOULDER[1] + Math.sin(a) * r
                const w = 1 + R(6 * u)
                for (let k = 0; k < w; k++) {
                    const sx = R(x + dir * (-8 + cx - Math.cos(a) * k))
                    const sy = R(y + cy - Math.sin(a) * k)
                    if (u < 0.5 && !bayer(sx, sy, R(16 * u * 2))) continue
                    dst.set(sx, sy, k === 0 ? (u > 0.8 ? C.white : C.gold3) : u > 0.7 ? C.gold3 : u > 0.4 ? C.orange : C.lava1)
                }
            }
            if (B.strike) for (let i = 0; i < 12; i++) dst.set(R(x + dir * (84 + (i * 5) % 18)), R(y - 34 - (i * 7) % 16), i % 3 ? C.gold3 : C.white)
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 3 · The Forgemaster

/**
 * Hephaestus, after the user's reference (hephaestus.png, the bottom-left version; mirrored on the
 * stage, which turns every boss to face the party, so he is drawn as the reference stands). His skin,
 * sun- and forge-bronzed; his copper hair and beard; the slate-blue linen of his exomis; the carved
 * stone of the anvil's pedestal and the dark bronze of the anvil; bronze and gold.
 */
const SKIN: Mat5 = { ramp: [C.skin0, C.skin1, C.skin1, C.skin2], hi: C.skin2, rim: C.skin0 }
const HAIR: Mat5 = { ramp: [C.brown0, C.brown1, C.skin0, C.orange], hi: C.orange, rim: C.brown0 }
const TUNIC: Mat5 = { ramp: [C.blue0, C.steel0, C.steel1, C.steel2], hi: C.steel3, rim: C.blue0 }
const PLINTH: Mat5 = { ramp: [C.olive0, C.olive1, C.bone0, C.bone1], hi: C.bone1, rim: C.olive0 }
const ANVIL: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.gold2, rim: C.brown0 }
const GOLD: Mat5 = { ramp: [C.gold1, C.gold1, C.gold2, C.gold3], hi: C.white, rim: C.gold0 }

/**
 * His hammer: a steel sledge, double-faced, a bronze band round its head, gripped at (gx, gy) with
 * its haft along `ga`. Drawn in his hand, and on its own when he throws it.
 */
function forgeHammer(s: Surface, gx: number, gy: number, ga: number): void {
    const ca = Math.cos(ga)
    const sa = Math.sin(ga)
    const hx = gx + ca * HAMMER_HEAD
    const hy = gy + sa * HAMMER_HEAD
    const hm = mask(s, 'mhaft')
    taper(hm, gx - ca * 8, gy - sa * 8, hx, hy, 5, 5, 1)
    vol(s, hm, WOOD, 3)
    selOut(s, hm, C.brown0)
    const nx = -sa
    const ny = ca
    const hw = 11
    const hl = 6
    const im = mask(s, 'mhhead')
    poly(im, [hx + nx * hw - ca * hl, hy + ny * hw - sa * hl, hx + nx * hw + ca * hl, hy + ny * hw + sa * hl, hx - nx * hw + ca * hl, hy - ny * hw + sa * hl, hx - nx * hw - ca * hl, hy - ny * hw - sa * hl], 0, 0, 1)
    vol(s, im, IRON, 6)
    selOut(s, im, C.steel0)
    // both faces worn bright, and the bronze band round its middle
    for (const d of [-1, 1]) line(s, hx + nx * hw * d - ca * hl, hy + ny * hw * d - sa * hl, hx + nx * hw * d + ca * hl, hy + ny * hw * d + sa * hl, C.steel3, 2)
    line(s, hx - ca * hl, hy - sa * hl, hx + ca * hl, hy + sa * hl, C.gold1, 2)
}

/** The hammer's head along its haft from his grip, and its weight's middle: what it spins about when thrown. */
const HAMMER_HEAD = 30
const HAMMER_MID = 20

/**
 * His two specials, in seconds. Shower of Sparks: he lays the glowing blade flat on the anvil and
 * brings the hammer down on it at each of SPARK_STRIKES, every blow throwing a fan of sparks off
 * the anvil over the party. The Master's Throw: he draws the hammer back, hurls it at THROW_RELEASE,
 * it flies spinning out through the whole line and curves back up over them into his hand at
 * THROW_CATCH.
 */
const SPARK_DUR = 2.6
const SPARK_STRIKES = [0.8, 1.3, 1.8] as const
const THROW_DUR = 2.6
const THROW_RELEASE = 0.75
const THROW_CATCH = 1.95
/** Its flight, from his mark (forward +, up −, in px): down to their chests, along the line, and back over them. */
const THROW_LOW = -28
const THROW_IN = 90
const THROW_OUT = 150
const THROW_TURN = 0.92
const THROW_BACK = 1.3
/** Three whole turns in the air, so it comes back into his hand the way it left. */
const THROW_SPIN = Math.PI * 2 * 3 / (THROW_CATCH - THROW_RELEASE)

/** A cubic Bézier through (a, b, c, d) at `u`. */
const bez = (a: number, b: number, c: number, d: number, u: number): number => {
    const m = 1 - u
    return m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c + u * u * u * d
}

/**
 * His poses, in his layout (x forward from his middle, y up from his feet): each [fist x, fist y,
 * angle] for the blade in his front hand and the hammer in his back hand.
 */
const BLADE_REST = [44, -72, -1.3] as const
const BLADE_WIND = [38, -126, -2.0] as const
const BLADE_STRIKE = [60, -82, 0.55] as const
/** The blade laid flat across the anvil for the Shower. */
const BLADE_FLAT = [30, -64, -0.05] as const
/**
 * At rest the hammer hangs head down from his fist, out beside his thigh.
 * Raised from rest, it swings up behind him, so those blends start from the same angle a whole turn back.
 */
const HAMMER_REST = [-48, -64, 2.16] as const
const HAMMER_REST_WOUND = [HAMMER_REST[0], HAMMER_REST[1], HAMMER_REST[2] - Math.PI * 2] as const
/** Raised up his near side, so the arm never sweeps across his face. */
const HAMMER_UP = [-42, -140, -2.2] as const
/** The grip that brings a face of the head down on the blade lying on the anvil. */
const HAMMER_HIT = [28, -80, 0.35] as const
const HAMMER_BACK = [-44, -116, -3.3] as const
const HAMMER_THROWN = [30, -96, 0] as const
/** His front shoulder, which the blade's sweep swings about; the blade's length from his fist. */
const FRONT_SHOULDER_FM = [30, -108] as const
const BLADE_LEN = 50
/** Where the sword's blade starts past his fist (the guard), and the stretch of it still hot from the forge, as a share of the blade. */
const SWORD_BASE = 8
const SWORD_HOT = 0.45
/**
 * His beard's outline about his head: a sideburn down from his temple, down the cheek to the corner
 * of his mouth, under his lower lip, up to the far corner and cheek, round the chin and jaw.
 */
const JAW_BEARD = [[-11, -3], [-8, -3], [-7, 4], [-4, 9], [-1, 12], [4, 13], [9, 12], [11, 9], [13, 6], [15, 8], [15, 17], [12, 26], [6, 30], [-2, 27], [-8, 18], [-11, 8]] as const
/** Where he stands behind the anvil, from his mark: its body's ends and height, its pedestal. */
const ANVIL_X0 = 18
const ANVIL_X1 = 72
const ANVIL_TOP = -60
const PLINTH_X0 = 22
const PLINTH_X1 = 74
const PLINTH_TOP = -32

/** Where his hand lets go of the hammer, and takes it back, from his mark: his throwing pose's grip. */
const throwGrip = (): [number, number] => [-10 + HAMMER_THROWN[0], HAMMER_THROWN[1]]

/**
 * Where the thrown hammer's middle is at `u` seconds into the Throw, from his mark, and its spin:
 * out of his hand and down to their chests, along the line, then curving up and back over them.
 */
function throwAt(u: number): [number, number, number] {
    const [gx, gy] = throwGrip()
    const x0 = gx + HAMMER_MID
    const spin = (u - THROW_RELEASE) * THROW_SPIN
    if (u < THROW_TURN) {
        const k = span(THROW_RELEASE, THROW_TURN, u)
        return [bez(x0, x0 + 20, THROW_IN - 14, THROW_IN, k), bez(gy, gy, THROW_LOW, THROW_LOW, k), spin]
    }
    if (u < THROW_BACK) {
        const k = span(THROW_TURN, THROW_BACK, u)
        return [THROW_IN + (THROW_OUT - THROW_IN) * k, THROW_LOW, spin]
    }
    const k = span(THROW_BACK, THROW_CATCH, u)
    return [bez(THROW_OUT, THROW_OUT + 22, THROW_OUT, x0, k), bez(THROW_LOW, THROW_LOW, -130, gy, k), spin]
}

/** Where the Shower's blows land, from his mark: on the blade lying on the anvil. */
const sparkPoint = (): [number, number] => [-10 + 56, ANVIL_TOP - 4]

/** A spark of the Shower thrown by blow `k`: its angle off the blade (down +) and speed. */
const SPARKS_PER_BLOW = 26
const SPARK_LIFE = 0.65
const SPARK_FALL = 300

/** Shower of Sparks: three blows on the white-hot blade on the anvil, each throwing a fan of sparks over two of them. */
const SHOWER_OF_SPARKS: BossSpecial = {
    name: 'Shower of Sparks', tint: 'dusk0', spread: true,
    hits: SPARK_STRIKES.flatMap(t0 => [t0 + 0.12, t0 + 0.15]),
    fx(s, t, st) {
        const d = st.dir
        const u = sq(t)
        const [lx, ly] = sparkPoint()
        const ox = st.bx + d * lx
        const oy = st.by + ly
        SPARK_STRIKES.forEach((t0, k) => {
            // the blow: a white star on the blade
            const f = u - t0
            if (f >= 0 && f < 0.1) {
                const r = R(10 * (1 - f / 0.1))
                line(s, ox - r, oy, ox + r, oy, C.white)
                line(s, ox, oy - r, ox, oy + r, C.white)
                disc(s, ox, oy, 3, C.gold3)
            }
            shockRing(s, ox, oy, t, t0, 0.25, 3, 18, C.gold3)
            // the fan of sparks, thrown out over the party and falling on them
            for (let i = 0; i < SPARKS_PER_BLOW; i++) {
                const a = f - hash2(k, i) * 0.04
                if (a <= 0 || a >= SPARK_LIFE) continue
                const ang = -0.4 + hash2(i, k + 3) * 1.2
                const v = 100 + hash2(i, k + 7) * 90
                const at = (w: number): [number, number] => [ox + d * Math.cos(ang) * v * w, oy + Math.sin(ang) * v * w + SPARK_FALL * w * w / 2]
                // each lands somewhere on the party's ground, from the back rank to the front, and
                // lies there glowing out
                const ground = st.by - hash2(i, k + 11) * 32
                const [x1, y1] = at(a)
                const age = a / SPARK_LIFE
                if (y1 >= ground) {
                    px(s, x1, ground, age < 0.6 ? C.orange : C.lava1)
                    continue
                }
                const [x0, y0] = at(Math.max(0, a - 0.025))
                line(s, x0, y0, x1, y1, age < 0.2 ? C.white : age < 0.45 ? C.gold3 : age < 0.75 ? C.orange : C.lava1)
            }
        })
        for (let i = 0; i < SHOWER_OF_SPARKS.hits.length; i++) {
            const pt = hitTarget(st, i, true)
            blast(s, pt.x, chest(pt), t, SHOWER_OF_SPARKS.hits[i]!, 8, 0.4, FIRE6, 91 + i, 'fire')
        }
    }
}

/** A scratch the thrown hammer is drawn into, lit and outlined as he is, then stamped into the scene. */
const FLYING = new Surface(120, 120, 60, 60)
const FLYING_STYLE = new StampStyle()

/** The Master's Throw: the hammer hurled spinning through the whole line and caught again. */
const MASTERS_THROW: BossSpecial = {
    name: 'Master\'s Throw', tint: 'dusk0', spread: true,
    // as it passes each of them, nearest first (their marks 99 to 133 px in front of his)
    hits: [0.98, 1.04, 1.04, 1.13, 1.19, 1.19],
    fx(s, t, st) {
        const d = st.dir
        const u = sq(t)
        if (u < THROW_RELEASE || u >= THROW_CATCH) {
            // the catch: a flash at his hand
            const f = u - THROW_CATCH
            if (f >= 0 && f < 0.15) { const [gx, gy] = throwGrip(); disc(s, st.bx + d * gx, st.by + gy, R(6 * (1 - f / 0.15)), C.gold3) }
            return
        }
        // a trail of sparks behind its head
        for (let k = 8; k >= 1; k--) {
            const [mx, my, a] = throwAt(Math.max(THROW_RELEASE, u - k * 0.022))
            const tx = mx + Math.cos(a) * (HAMMER_HEAD - HAMMER_MID)
            const ty = my + Math.sin(a) * (HAMMER_HEAD - HAMMER_MID)
            const r = 8 - k * 0.7
            const level = R(13 - k * 1.4)
            const cx = R(st.bx + d * tx)
            const cy = R(st.by + ty)
            for (let yy = -R(r); yy <= R(r); yy++) {
                for (let xx = -R(r); xx <= R(r); xx++) {
                    if (xx * xx + yy * yy > r * r || !bayer(cx + xx, cy + yy, level)) continue
                    s.set(cx + xx, cy + yy, k < 3 ? C.gold3 : k < 5 ? C.orange : k < 7 ? C.lava1 : C.lava0)
                }
            }
        }
        // the hammer itself, spinning about its middle
        const [hx, hy, spin] = throwAt(u)
        FLYING.clear()
        forgeHammer(FLYING, FLYING.ax - Math.cos(spin) * HAMMER_MID, FLYING.ay - Math.sin(spin) * HAMMER_MID, spin)
        const style = FLYING_STYLE.reset()
        style.flip = d < 0
        stamp(s, FLYING, st.bx + d * hx, st.by + hy, style)
        for (let i = 0; i < MASTERS_THROW.hits.length; i++) {
            const pt = hitTarget(st, i, true)
            blast(s, pt.x, chest(pt), t, MASTERS_THROW.hits[i]!, 11, 0.45, FIRE6, 101 + i, 'fire')
        }
    }
}

type Pose3 = readonly [number, number, number]
const mixPose = (a: Pose3, b: Pose3, k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/**
 * His hammer through the specials: the Shower between resting, raised and down on the blade on the
 * anvil; the Throw drawn back, hurled, followed through and caught. Null outside them.
 */
function fmHammerPose(st: string, t: number): [number, number, number] | null {
    const q0 = q(t)
    if (st === 'special') {
        if (q0 < 0.55) return mixPose(HAMMER_REST_WOUND, HAMMER_UP, sm(span(0.1, 0.55, q0)))
        for (let k = 0; k < SPARK_STRIKES.length; k++) {
            const ts = SPARK_STRIKES[k]!
            const next = SPARK_STRIKES[k + 1]
            if (q0 < ts - 0.06) return [...HAMMER_UP]
            if (q0 < ts) return mixPose(HAMMER_UP, HAMMER_HIT, sm(span(ts - 0.06, ts, q0)))
            if (q0 < ts + 0.1) return [...HAMMER_HIT]
            if (next !== undefined && q0 < next - 0.06) return mixPose(HAMMER_HIT, HAMMER_UP, sm(span(ts + 0.1, ts + 0.35, q0)))
        }
        return mixPose(HAMMER_HIT, HAMMER_REST, sm(span(SPARK_STRIKES[2] + 0.1, SPARK_DUR - 0.05, q0)))
    }
    if (st === 'special2') {
        if (q0 < 0.6) return mixPose(HAMMER_REST_WOUND, HAMMER_BACK, sm(span(0.05, 0.6, q0)))
        if (q0 < THROW_RELEASE) return mixPose(HAMMER_BACK, HAMMER_THROWN, sm(span(0.6, THROW_RELEASE, q0)))
        // his hand held out after it, then braced for the catch, jolted by it, and back to rest
        if (q0 < THROW_CATCH) return [...HAMMER_THROWN]
        const jolt = Math.sin(span(THROW_CATCH, THROW_CATCH + 0.15, q0) * Math.PI) * 5
        if (q0 < THROW_CATCH + 0.15) return [HAMMER_THROWN[0] - jolt, HAMMER_THROWN[1] + jolt * 0.4, HAMMER_THROWN[2]]
        return mixPose(HAMMER_THROWN, HAMMER_REST, sm(span(THROW_CATCH + 0.15, THROW_DUR - 0.05, q0)))
    }
    return null
}

/** His blade: slashed on his attack; laid flat on the anvil through the Shower. */
function fmBladePose(st: string, t: number): [number, number, number] {
    if (st === 'special') {
        const q0 = q(t)
        const k = sm(span(0.1, 0.5, q0)) * (1 - sm(span(SPARK_STRIKES[2] + 0.2, SPARK_DUR - 0.05, q0)))
        return mixPose(BLADE_REST, BLADE_FLAT, k)
    }
    return [bz(BLADE_REST[0], BLADE_WIND[0], BLADE_STRIKE[0]), bz(BLADE_REST[1], BLADE_WIND[1], BLADE_STRIKE[1]), bz(BLADE_REST[2], BLADE_WIND[2], BLADE_STRIKE[2])]
}

/**
 * The Forgemaster: Hephaestus, god of the forge, the legend the gauntlet ends on, after the user's
 * reference (hephaestus.png, bottom left). Drawn three-quarters to the front, standing behind his
 * anvil. Copper hair swept back to his shoulders under a thin gold circlet, a thick copper beard, a
 * stern brow; sun-bronzed and powerful. A slate-blue exomis draped over his hammer shoulder and
 * pinned there with a gold brooch, the other shoulder bare; a brown leather sash across his chest,
 * a leather belt with a gold buckle, the tunic falling in pleats to his knees; gold armlets, a
 * leather bracer; sandals laced up his calves. A curved blade glowing hot in his front hand; a steel
 * double-faced hammer in his back hand; before him a dark bronze anvil on a carved stone pedestal,
 * a Greek key round it. He slashes the blade down over the anvil in an arc of fire; he steps out of
 * the forge-fire; he falls to a knee behind his anvil.
 */
export const FORGE_MASTER: CreatureDef = {
    name: 'The Forgemaster', size: 256, room: 30, shadow: 46, accent: C.orange,
    states: { ...withSpecial(bossStates(1.8, 2.2, 2.4), SPARK_DUR), special2: { dur: THROW_DUR, loop: false } },
    specials: [SHOWER_OF_SPARKS, MASTERS_THROW],
    draw(s, st, t) {
        drive(this, st, t, 6, 2.2)
        const tt = q(t)
        // the hammer is out of his hand while it flies
        const held = !(st === 'special2' && tt >= THROW_RELEASE && tt < THROW_CATCH)
        const x = s.ax - 10 + B.lunge - B.kb
        const y = s.ay
        // the anvil does not move with him
        const ax0 = s.ax - 10
        const an = (lx: number, ly: number): [number, number] => [ax0 + lx, y + ly]
        // dying: down on a knee behind the anvil, then over
        const knee = Math.min(1, B.die * 1.8)
        const fall = Math.max(0, B.die * 1.8 - 1)
        const tilt = bz(0, -0.05, 0.08) + fall * 0.5
        const sinkBody = knee * 24
        const at = (lx: number, ly: number): [number, number] => { rot(x + lx, y + ly, x, y, tilt); return [T.x, T.y] }
        const up = (lx: number, ly: number): [number, number] => at(lx + bz(0, -3, 5) * Math.max(0, -ly - 60) / 60, ly + B.breath * 0.6 + sinkBody)

        // an arm, heavy with muscle, the deltoid its own lit cap; the fist drawn apart
        const arm = (key: string, sx: number, sy: number, ex: number, ey: number, hx: number, hy: number, back: boolean): void => {
            const ux = sx + (ex - sx) * 0.55
            const uy = sy + (ey - sy) * 0.55
            const lx = ex + (hx - ex) * 0.3
            const ly = ey + (hy - ey) * 0.3
            limb(s, key, [sx, sy, ux, uy, ex, ey, lx, ly, hx, hy], [17, 18, 14, 15, 11], SKIN, back ? -0.2 : 0, C.ink)
            const dx = ex - sx
            const dy = ey - sy
            const dl = Math.hypot(dx, dy) || 1
            const nx = -dy / dl
            const ny = dx / dl
            line(s, sx + dx * 0.4 + nx * 5, sy + dy * 0.4 + ny * 5, sx + dx * 0.75 + nx * 4, sy + dy * 0.75 + ny * 4, C.skin2)
            const dm = mask(s, key + 'd')
            const cx = sx + dx * 0.16
            const cy = sy + dy * 0.16
            const pts: number[] = []
            for (let k = 0; k < 20; k++) {
                const a = k / 20 * Math.PI * 2
                pts.push(cx + (dx / dl) * Math.cos(a) * 12 + nx * Math.sin(a) * 10, cy + (dy / dl) * Math.cos(a) * 12 + ny * Math.sin(a) * 10)
            }
            poly(dm, pts, 0, 0, 1)
            vol(s, dm, SKIN, 7, back ? -0.1 : 0.12)
            selOut(s, dm, C.skin0)
        }
        // a fist closed round a handle running along `a`
        const grip = (key: string, hx: number, hy: number, a: number, back: boolean): void => {
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            const m = mask(s, key)
            const pts: number[] = []
            for (let k = 0; k < 18; k++) {
                const b = k / 18 * Math.PI * 2
                pts.push(hx - sa * Math.cos(b) * 7 + ca * Math.sin(b) * 6, hy + ca * Math.cos(b) * 7 + sa * Math.sin(b) * 6)
            }
            poly(m, pts, 0, 0, 1)
            vol(s, m, SKIN, 4, back ? -0.2 : 0.05)
            selOut(s, m, C.ink)
            for (const k of [-2.5, 0.5, 3.5]) line(s, hx + ca * k - sa * 5, hy + sa * k + ca * 5, hx + ca * k - sa * 1, hy + sa * k + ca * 1, C.skin0)
            line(s, hx - sa * 6 - ca * 3, hy + ca * 6 - sa * 3, hx - sa * 6 + ca * 4, hy + ca * 6 + sa * 4, C.skin2)
        }
        // a band of gold round a limb at (cx, cy), across the direction (dx, dy)
        const band = (cx: number, cy: number, dx: number, dy: number, w: number): void => {
            const dl = Math.hypot(dx, dy) || 1
            const nx = -dy / dl
            const ny = dx / dl
            line(s, cx - nx * w, cy - ny * w, cx + nx * w, cy + ny * w, C.gold1, 3)
            line(s, cx - nx * w, cy - ny * w - 1, cx + nx * w, cy + ny * w - 1, C.gold3)
        }

        // ── legs: bare under the tunic, in sandals laced up the calf; the front one behind the anvil ──
        const leg = (hx: number, fx: number, back: boolean): void => {
            const [a, b] = up(hx, -60)
            const [f, g] = at(fx + (back ? 0 : knee * 10), -6)
            elbow(a, b, f, g, 28, 26, -1)
            const kx = P.x
            const ky = P.y
            const cx = kx + (f - kx) * 0.35
            const cy = ky + (g - ky) * 0.35
            limb(s, back ? 'mbl' : 'mfl', [a, b, kx, ky, cx, cy, f, g], [24, 17, 16, 12], SKIN, back ? -0.2 : 0, C.ink)
            const fm = mask(s, back ? 'mbfoot' : 'mffoot')
            ellipse(fm, f + 4, g + 2, 11, 5, 1)
            vol(s, fm, SKIN, 5, back ? -0.2 : 0)
            selOut(s, fm, C.ink)
            line(s, f - 7, g + 7, f + 15, g + 7, C.brown0, 2)
            // the sandal's straps laced up the calf
            for (let k = 0; k < 4; k++) {
                const u = k / 4
                const lx0 = f + (kx - f) * u * 0.8
                const ly0 = g + (ky - g) * u * 0.8
                line(s, lx0 - 6, ly0 - 1, lx0 + 6, ly0 + 2, back ? C.brown0 : C.brown1)
                line(s, lx0 - 6, ly0 + 2, lx0 + 6, ly0 - 1, back ? C.brown0 : C.brown1)
            }
        }
        // three-quarters to the front and turned toward the party, his side away from them is the
        // near one: the leg toward the anvil goes down first, behind the other
        leg(8, 16, false)
        leg(-12, -20, true)

        // ── his blade arm, the far one: behind his body and head, whatever it does; the sword and
        //    the fist on it go down after the anvil, so the blade can lie on it ──
        const [bpx, bpy, bpa] = fmBladePose(st, t)
        const [Bx, By] = up(bpx, bpy)
        const bang = bpa + tilt
        {
            const [sx, sy] = up(FRONT_SHOULDER_FM[0], FRONT_SHOULDER_FM[1])
            elbow(sx, sy, Bx, By, 27, 26, 1)
            const ex = P.x
            const ey = P.y
            arm('mfarm', sx, sy, ex, ey, Bx, By, false)
            // the leather bracer, banded in gold
            const vm = mask(s, 'mbracer')
            const v0x = ex + (Bx - ex) * 0.3
            const v0y = ey + (By - ey) * 0.3
            const v1x = ex + (Bx - ex) * 0.85
            const v1y = ey + (By - ey) * 0.85
            taper(vm, v0x, v0y, v1x, v1y, 15, 13, 1)
            vol(s, vm, LEATHER, 4, 0.05)
            selOut(s, vm, C.brown0)
            band(v1x, v1y, v1x - v0x, v1y - v0y, 7)
        }

        // ── his body, three-quarters to the front: a mighty chest, a thick waist, a heavy neck ──
        const body = mask(s, 'mbody')
        {
            const [wx, wy] = up(0, -78)
            ellipse(body, wx, wy, 20, 14, 1)
            const [l0x, l0y] = up(0, -80)
            const [l1x, l1y] = up(2, -100)
            taper(body, l0x, l0y, l1x, l1y, 40, 52, 1)
            const [cx, cy] = up(3, -104)
            ellipse(body, cx, cy, 27, 16, 1)
            const [n0x, n0y] = up(2, -116)
            const [n1x, n1y] = up(6, -126)
            taper(body, n0x, n0y, n1x, n1y, 36, 24, 1)
            disc(body, n0x, n0y, 18, 1)
            disc(body, n1x, n1y, 12, 1)
            vol(s, body, SKIN, 20)
            // the line under his bare chest
            for (let k = 0; k <= 8; k++) { const [a, b] = up(8 + k * 1.8, -98 + Math.sin(k / 8 * Math.PI) * 2); if (body.get(R(a), R(b))) { px(s, a, b, C.skin0); px(s, a, b - 1, C.skin2) } }
            selOut(s, body, C.ink)
        }
        // the exomis: slate-blue linen draped over his hammer shoulder and pinned there, slung under
        // his blade arm so that shoulder and chest are bare, falling in pleats to his knees
        {
            const em = mask(s, 'exomis')
            poly(em, [[-30, -112], [-18, -122], [-8, -118], [6, -104], [22, -94], [26, -84], [24, -62], [28, -36], [14, -32], [0, -35], [-14, -32], [-28, -36], [-26, -62], [-30, -86]].flatMap(([a, b]) => up(a!, b!)), 0, 0, 1)
            vol(s, em, TUNIC, 10, 0.05)
            selOut(s, em, C.blue0)
            // the drape's folds from the shoulder, and the pleats of the skirt
            for (const [a0, b0, a1, b1] of [[-16, -116, 12, -90], [-22, -110, 4, -80], [-28, -100, -8, -74]] as const) { const [p0x, p0y] = up(a0, b0); const [p1x, p1y] = up(a1, b1); line(s, p0x, p0y, p1x, p1y, C.steel0) }
            for (const kx of [-18, -6, 6, 18]) { const [a, b] = up(kx, -58); const [c, d] = up(kx + 1, -36); line(s, a, b, c, d, C.steel0) }
            { const [a, b] = up(-28, -37); const [c, d] = up(28, -37); line(s, a, b, c, d, C.blue0) }
            // the leather sash across his chest over it, from the shoulder to his hip
            const [s0x, s0y] = up(-16, -120)
            const [s1x, s1y] = up(24, -78)
            line(s, s0x, s0y, s1x, s1y, C.brown1, 7)
            line(s, s0x - 2, s0y + 2, s1x - 2, s1y + 2, C.brown2)
            line(s, s0x + 2, s0y - 3, s1x + 2, s1y - 3, C.brown0)
            // the belt, its gold buckle
            const [b0x, b0y] = up(-24, -62)
            const [b1x, b1y] = up(26, -62)
            line(s, b0x, b0y, b1x, b1y, C.brown1, 5)
            line(s, b0x, b0y - 2, b1x, b1y - 2, C.brown2)
            const [kx, ky] = up(12, -62)
            const km = mask(s, 'mbuckle')
            poly(km, [kx - 4, ky - 4, kx + 4, ky - 4, kx + 4, ky + 3, kx - 4, ky + 3], 0, 0, 1)
            vol(s, km, GOLD, 3)
            px(s, kx, ky - 1, C.brown0)
            // the brooch pinning it at his shoulder
            const [fx, fy] = up(-18, -118)
            const fm = mask(s, 'mbrooch')
            disc(fm, fx, fy, 3.5, 1)
            vol(s, fm, GOLD, 2)
            selOut(s, fm, C.gold0)
        }

        // ── his head, three-quarters to the front as the reference has it: copper hair framing his
        //    face and swept back to his shoulders under a gold circlet, a stern brow over two eyes, a
        //    broad nose, a drooping moustache and a great streaked copper beard ──
        {
            const hy = -134 + R(bz(0, -2, 3))
            const [hx, hy2] = up(6, hy)
            const hp = (dx: number, dy: number): [number, number] => [hx + dx, hy2 + dy]
            // the hair: round his head, framing the face, falling to his shoulder at his back
            const hm = mask(s, 'mhair')
            { const [a, b] = hp(0, -2); ellipse(hm, a, b, 16, 18, 1) }
            poly(hm, [[-14, -2], [-18, 10], [-24, 26], [-14, 26], [-8, 12]].flatMap(([a, b]) => hp(a!, b!)), 0, 0, 1)
            vol(s, hm, HAIR, 7)
            selOut(s, hm, C.brown0)
            // locks through it, swept back
            for (let k = 0; k < 9; k++) {
                const a = -2.6 + k * 0.32
                const [a0, b0] = hp(Math.cos(a) * 9, -2 + Math.sin(a) * 11)
                const [a1, b1] = hp(Math.cos(a) * 15, -2 + Math.sin(a) * 17)
                line(s, a0, b0, a1, b1, k & 1 ? C.orange : C.brown1)
            }
            // the face
            const fm = mask(s, 'mface')
            { const [a, b] = hp(3, 2); ellipse(fm, a, b, 10.5, 13, 1) }
            vol(s, fm, SKIN, 8, 0.05)
            selOut(s, fm, C.skin0)
            // a heavy brow, shadowed under it, its inner ends drawn down, and two eyes deep under it
            { const [a, b] = hp(-8, -3); const [c, d] = hp(13, -3); line(s, a, b, c, d, C.skin0, 2) }
            { const [a, b] = hp(-7, -6); line(s, a, b, a + 7, b + 2, C.brown0, 3) }
            { const [a, b] = hp(5, -4); line(s, a, b, a + 8, b - 2, C.brown0, 3) }
            { const [a, b] = hp(-8, 3); px(s, a, b, C.skin0); px(s, a + 1, b + 1, C.skin0); const [c, d] = hp(13, 3); px(s, c, d, C.skin0) }
            for (const ex0 of [-3, 8] as const) {
                const [ex, ey] = hp(ex0, -2)
                line(s, ex - 2, ey, ex + 2, ey, C.white)
                px(s, ex + (ex0 < 0 ? 1 : 0), ey, B.hurt ? C.white : C.steel1)
                px(s, ex + (ex0 < 0 ? 1 : 0), ey + 1, C.skin0)
            }
            // the nose, broad, its bridge between the eyes
            { const [a, b] = hp(3, -2); const [c, d] = hp(4, 4); line(s, a, b, c, d, C.skin0) }
            { const [a, b] = hp(4, 5); disc(s, a, b, 2.5, C.skin1); px(s, a + 1, b - 1, C.skin2); px(s, a - 1, b + 2, C.skin0); px(s, a + 2, b + 2, C.skin0) }
            // the beard: great and copper, up his cheeks to his sideburns and round his jaw and down his
            // chest, streaked; its top follows his face, dipping to the corners of his mouth and under
            // his lower lip rather than cutting straight across it, and it keeps within the line of
            // his face so his jaw does not jut
            const bm = mask(s, 'mbeard')
            poly(bm, JAW_BEARD.flatMap(([a, b]) => hp(a, b)), 0, 0, 1)
            vol(s, bm, HAIR, 6)
            selOut(s, bm, C.brown0)
            // strands falling through it, wavering, dark between and lit on the odd one
            for (let k = 0; k < 9; k++) {
                let [a, b] = hp(-8 + k * 2.8, 9 + hash2(k, 3) * 4)
                const len = 10 + hash2(k, 5) * 12
                for (let j = 0; j < len; j++) {
                    const na = a + Math.sin((j + k * 3) * 0.5) * 0.6
                    if (bm.get(R(na), R(b + 1))) s.set(R(na), R(b + 1), k % 3 === 1 ? C.orange : C.brown0)
                    a = na
                    b += 1
                }
            }
            // the mouth under the moustache and the lower lip showing below it; open when he bellows
            { const [a, b] = hp(0, 10); const [c, d] = hp(8, 10); line(s, a, b, c, d, C.skin0); const [e, f] = hp(1, 11); const [g, h] = hp(7, 11); line(s, e, f, g, h, C.skin1) }
            if (B.strike || B.roar) { const [a, b] = hp(4, 11); ellipse(s, a, b, 3, 1.5, C.ink) }
            // the moustache over it, drooping at its ends into the beard
            { const [a, b] = hp(-3, 8); const [c, d] = hp(11, 8); line(s, a, b, c, d, C.skin0, 3); line(s, a, b - 1, c, d - 1, C.orange); const [e, f] = hp(-5, 12); line(s, a, b, e, f, C.skin0, 2); const [g, h] = hp(12, 12); line(s, c, d, g, h, C.skin0, 2) }
            // the gold circlet across his brow, a stone at its front
            { const [a, b] = hp(-12, -10); const [c, d] = hp(14, -11); line(s, a, b, c, d, C.gold1, 2); line(s, a, b - 1, c, d - 1, C.gold3); const [e, f] = hp(2, -12); disc(s, e, f, 1.5, C.lava1); px(s, e, f - 1, C.gold3) }
        }

        // ── the anvil, before him: a carved stone pedestal, a dark bronze anvil on it, lit by the
        //    glowing blade. It stands where it stands ──
        {
            // the pedestal: its top seen a little from above, a moulding at top and foot, a Greek key
            const pm = mask(s, 'plinth')
            poly(pm, [[PLINTH_X0, PLINTH_TOP], [PLINTH_X1, PLINTH_TOP], [PLINTH_X1 + 4, PLINTH_TOP - 4], [PLINTH_X0 + 4, PLINTH_TOP - 4]].flatMap(([a, b]) => an(a!, b!)), 0, 0, 1)
            poly(pm, [[PLINTH_X0, PLINTH_TOP], [PLINTH_X1, PLINTH_TOP], [PLINTH_X1 + 2, -4], [PLINTH_X1 + 4, 0], [PLINTH_X0 - 4, 0], [PLINTH_X0 - 2, -4]].flatMap(([a, b]) => an(a!, b!)), 0, 0, 1)
            vol(s, pm, PLINTH, 8)
            selOut(s, pm, C.olive0)
            for (const ly of [PLINTH_TOP + 3, -6]) { const [a, b] = an(PLINTH_X0, ly); const [c, d] = an(PLINTH_X1, ly); line(s, a, b, c, d, C.olive0); line(s, a, b - 1, c, d - 1, C.bone1) }
            // the key, cut into its face
            const [k0x, k0y] = an(PLINTH_X0 + 4, -22)
            for (let k = 0; k < 8; k++) {
                const kx = k0x + k * 6
                line(s, kx, k0y + 6, kx, k0y, C.olive0)
                line(s, kx, k0y, kx + 4, k0y, C.olive0)
                line(s, kx + 4, k0y, kx + 4, k0y + 4, C.olive0)
                line(s, kx + 4, k0y + 4, kx + 2, k0y + 4, C.olive0)
                px(s, kx + 1, k0y + 1, C.bone1)
            }
            // the anvil: a flared foot on the pedestal, a waist, the body square at its heel and its
            // horn reaching out toward the party
            const am = mask(s, 'anvil')
            poly(am, [[26, PLINTH_TOP - 3], [62, PLINTH_TOP - 3], [56, -44], [32, -44]].flatMap(([a, b]) => an(a!, b!)), 0, 0, 1)
            poly(am, [[34, -44], [54, -44], [52, -50], [36, -50]].flatMap(([a, b]) => an(a!, b!)), 0, 0, 1)
            poly(am, [[ANVIL_X0, ANVIL_TOP], [ANVIL_X1, ANVIL_TOP], [ANVIL_X1, -52], [ANVIL_X1 - 8, -49], [ANVIL_X0 + 6, -49], [ANVIL_X0, -52]].flatMap(([a, b]) => an(a!, b!)), 0, 0, 1)
            poly(am, [[ANVIL_X1, ANVIL_TOP], [ANVIL_X1 + 20, ANVIL_TOP + 4], [ANVIL_X1, -52]].flatMap(([a, b]) => an(a!, b!)), 0, 0, 1)
            vol(s, am, ANVIL, 8)
            selOut(s, am, C.ink)
            // its face, lit along the top by the hot blade, and the hardy hole at its heel
            { const [a, b] = an(ANVIL_X0, ANVIL_TOP); const [c, d] = an(ANVIL_X1 + 18, ANVIL_TOP + 4); line(s, a, b, c - 18, b, C.brown3); line(s, c - 18, b, c, d, C.brown3); line(s, a + 10, b, c - 22, b, C.orange) }
            { const [a, b] = an(ANVIL_X0 + 6, ANVIL_TOP + 2); px(s, a, b, C.ink); px(s, a + 1, b, C.ink) }
        }

        // ── the sword he is finishing, in his blade fist: a straight leaf-shaped blade of bright steel
        //    with a fuller down it, a bronze crossguard, a grip bound in leather, a bronze pommel; the
        //    stretch he is working still glowing from the forge, and flaring as the hammer falls ──
        {
            const ca = Math.cos(bang)
            const sa = Math.sin(bang)
            const nx = -sa
            const ny = ca
            // how hot the worked stretch is: glowing, and white on each blow of the Shower
            let heat = 0.7
            if (st === 'special') for (const t0 of SPARK_STRIKES) { const f = tt - t0; if (f >= 0) heat = Math.max(heat, 0.7 + 0.6 * Math.exp(-f * 6)) }
            const bm = mask(s, 'mblade')
            const n = 12
            for (let k = 0; k < n; k++) {
                const u0 = k / n
                const u1 = (k + 1) / n
                const w = (u: number): number => u < 0.72 ? 5 + u * 1.2 : 5.9 * (1 - u) / 0.28
                taper(bm, Bx + ca * (SWORD_BASE + (BLADE_LEN - SWORD_BASE) * u0), By + sa * (SWORD_BASE + (BLADE_LEN - SWORD_BASE) * u0), Bx + ca * (SWORD_BASE + (BLADE_LEN - SWORD_BASE) * u1), By + sa * (SWORD_BASE + (BLADE_LEN - SWORD_BASE) * u1), Math.max(1, w(u0)), Math.max(1, w(u1)), 1)
            }
            // the whole blade glowing red-hot (the user): a deep red body, lit orange along one edge, a
            // darker fuller down its middle; brighter where he is working it, gold and white as a blow
            // lands
            eachPx(bm, (px_, py, e) => {
                const dx = px_ - Bx
                const dy = py - By
                const u = ((dx * ca + dy * sa) - SWORD_BASE) / (BLADE_LEN - SWORD_BASE)
                const across = dx * nx + dy * ny
                const hot = heat * (0.75 + 0.35 * Math.exp(-(((u - SWORD_HOT) / 0.25) ** 2)))
                const lit = e && across < 0
                let c: number
                if (hot > 1.05) c = lit ? C.white : Math.abs(across) < 0.8 ? C.orange : C.gold3
                else if (hot > 0.75) c = lit ? C.gold3 : e ? C.lava0 : Math.abs(across) < 0.8 ? C.lava1 : C.orange
                else c = lit ? C.orange : e ? C.lava0 : Math.abs(across) < 0.8 ? C.lava0 : C.lava1
                s.set(px_, py, c)
            })
            // the grip, bound in leather, the crossguard and the pommel, bronze
            line(s, Bx - ca * 5, By - sa * 5, Bx + ca * 5, By + sa * 5, C.brown1, 3)
            for (const k of [-3, 0, 3]) px(s, Bx + ca * k, By + sa * k, C.brown2)
            line(s, Bx + ca * 6 - nx * 7, By + sa * 6 - ny * 7, Bx + ca * 6 + nx * 7, By + sa * 6 + ny * 7, C.gold1, 3)
            line(s, Bx + ca * 6 - nx * 7, By + sa * 6 - ny * 7 - 1, Bx + ca * 6 + nx * 7, By + sa * 6 + ny * 7 - 1, C.gold3)
            disc(s, Bx - ca * 8, By - sa * 8, 2.5, C.gold1)
            px(s, Bx - ca * 8 - 1, By - sa * 8 - 1, C.gold3)
            // heat shimmering off the length of it
            for (let k = 0; k < 5; k++) {
                const d = SWORD_BASE + 4 + k * (BLADE_LEN - SWORD_BASE - 8) / 4
                px(s, Bx + ca * d + nx * 3, By + sa * d - 5 - ((R(tt * 10) + k) % 3), k & 1 ? C.lava1 : C.orange)
            }
            grip('mffist', Bx, By, bang + Math.PI, false)
        }

        // ── his back arm, the hammer in his fist ──
        const hpose = fmHammerPose(st, t) ?? [...HAMMER_REST]
        const [Hx, Hy] = up(hpose[0], hpose[1])
        const hang = hpose[2] + tilt
        {
            const [sx, sy] = up(-22, -110)
            elbow(sx, sy, Hx, Hy, 30, 28, 1)
            const ex = P.x
            const ey = P.y
            if (held) forgeHammer(s, Hx, Hy, hang)
            arm('mbarm', sx, sy, ex, ey, Hx, Hy, true)
            // a gold armlet round the bicep, a band at the wrist
            band(sx + (ex - sx) * 0.6, sy + (ey - sy) * 0.6, ex - sx, ey - sy, 9)
            band(ex + (Hx - ex) * 0.75, ey + (Hy - ey) * 0.75, Hx - ex, Hy - ey, 7)
            grip('mbfist', Hx, Hy, hang, true)
        }

        B.ent = Math.min(1, B.ent)
        finish(s, Entry.Fade, 10)
    },
    fx(dst, st, t, x, y, dir) {
        const tt = q(t)
        // sparks always drifting up off the hot blade
        for (let i = 0; i < 6; i++) {
            const u = (tt * 0.6 + hash2(i, 3)) % 1
            dst.set(R(x + dir * (44 + (hash2(i, 5) - 0.5) * 20) + Math.sin(u * 8 + i) * 3), R(y - 90 - u * 60), u < 0.6 ? C.orange : C.lava1)
        }
        // stepping out of the forge-fire: flames rising round him, then gone
        if (st === 'entry') {
            const u = tt / this.states.entry!.dur
            if (u < 0.8) {
                const hgt = 150 * Math.sin(Math.min(1, u / 0.7) * Math.PI)
                for (let i = 0; i < 40; i++) {
                    const fx = x + dir * ((hash2(i, 9) - 0.5) * 90)
                    const k = ((tt * 3 + hash2(i, 11)) % 1)
                    const fy = y - k * hgt * (0.6 + hash2(i, 13) * 0.4)
                    dst.set(R(fx + Math.sin(k * 9 + i) * 3), R(fy), k < 0.3 ? C.gold3 : k < 0.6 ? C.orange : C.lava1)
                    dst.set(R(fx + Math.sin(k * 9 + i) * 3) + 1, R(fy), k < 0.5 ? C.orange : C.lava0)
                }
            }
        }
        // the slash: the arc of fire the blade swings through round his front shoulder, from over
        // his head down past the anvil; whole on the strike, burning away after
        if (st === 'attack' && (B.strike || B.rec > 0.5)) {
            const polar = (p: Pose3): [number, number] => {
                const bx = p[0] + Math.cos(p[2]) * BLADE_LEN - FRONT_SHOULDER_FM[0]
                const by = p[1] + Math.sin(p[2]) * BLADE_LEN - FRONT_SHOULDER_FM[1]
                return [Math.hypot(bx, by), Math.atan2(by, bx)]
            }
            const [r0, a0] = polar(BLADE_WIND)
            const [r1, a1] = polar(BLADE_STRIKE)
            const left = B.strike ? 1 : (B.rec - 0.5) / 0.5
            const n = R(Math.abs(a1 - a0) * Math.max(r0, r1) * 1.2)
            for (let i = 0; i <= n; i++) {
                const u = i / n
                if (u < 1 - left) continue
                const a = a0 + (a1 - a0) * u
                const r = r0 + (r1 - r0) * u
                const cx = FRONT_SHOULDER_FM[0] + Math.cos(a) * r
                const cy = FRONT_SHOULDER_FM[1] + Math.sin(a) * r
                const w = 1 + R(6 * u)
                for (let k = 0; k < w; k++) {
                    const sx = R(x + dir * (-10 + cx - Math.cos(a) * k))
                    const sy = R(y + cy - Math.sin(a) * k)
                    if (u < 0.5 && !bayer(sx, sy, R(16 * u * 2))) continue
                    dst.set(sx, sy, k === 0 ? (u > 0.8 ? C.white : C.gold3) : u > 0.7 ? C.gold3 : u > 0.4 ? C.orange : C.lava1)
                }
            }
            if (B.strike) for (let i = 0; i < 12; i++) dst.set(R(x + dir * (90 + (i * 5) % 18)), R(y - 40 - (i * 7) % 16), i % 3 ? C.gold3 : C.white)
        }
    }
}
