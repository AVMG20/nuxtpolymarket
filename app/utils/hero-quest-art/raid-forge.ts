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

const BRASS: Mat5 = { ramp: [C.gold0, C.gold1, C.gold2, C.gold3], hi: C.white, rim: C.gold1 }
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
 * How much smaller than his layout the Forgemaster is drawn, about his feet: the top rung of the
 * gauntlet's ladder, as tall as he can stand with his head clear of the whole-scene camera's top.
 */
const FM_SCALE = 0.95

const SKIN: Mat5 = { ramp: [C.skin0, C.skin1, C.skin1, C.skin2], hi: C.skin2, rim: C.skin0 }
const BEARD = [C.red0, C.red1, C.orange] as const

/**
 * The forge hammer, gripped at (gx, gy) with its haft along `ga`: a long iron-shod haft, a great
 * head, its striking face glowing `hot` from the fire and runes cut into it in gold. Drawn in his
 * hand, and on its own when he throws it.
 */
function forgeHammer(s: Surface, gx: number, gy: number, ga: number, hot: number): void {
    const ca = Math.cos(ga)
    const sa = Math.sin(ga)
    const bx = gx - ca * 16
    const by = gy - sa * 16
    const hx = gx + ca * 54
    const hy = gy + sa * 54
    const hm = mask(s, 'mhaft')
    taper(hm, bx, by, hx, hy, 7, 6, 1)
    vol(s, hm, WOOD, 3)
    selOut(s, hm, C.brown0)
    for (const k of [-10, 10, 40, 54]) { const cx = gx + ca * k; const cy = gy + sa * k; line(s, cx - sa * 4, cy + ca * 4, cx + sa * 4, cy - ca * 4, C.steel1, 2) }
    const nx = -sa
    const ny = ca
    const hw = 18
    const hl = 12
    const im = mask(s, 'mhhead')
    poly(im, [hx + nx * hw - ca * hl, hy + ny * hw - sa * hl, hx + nx * hw + ca * hl, hy + ny * hw + sa * hl, hx - nx * hw + ca * hl, hy - ny * hw + sa * hl, hx - nx * hw - ca * hl, hy - ny * hw - sa * hl], 0, 0, 1)
    vol(s, im, IRON, 10)
    selOut(s, im, C.steel0)
    // the striking face, glowing from the fire, on the side that lands
    for (let d = 0; d < 3; d++) line(s, hx - nx * (hw - d) - ca * hl, hy - ny * (hw - d) - sa * hl, hx - nx * (hw - d) + ca * hl, hy - ny * (hw - d) + sa * hl, d === 0 ? hot : d === 1 ? C.orange : C.lava1)
    // runes cut into the head, lit gold
    for (let k = -1; k <= 1; k++) {
        const rx = hx + nx * k * 6
        const ry = hy + ny * k * 6
        line(s, rx - ca * 5, ry - sa * 5, rx + ca * 5, ry + sa * 5, C.gold2)
        px(s, rx + nx * 2, ry + ny * 2, C.gold3)
    }
}

/** How far along the hammer from the grip its weight sits: what it spins about when thrown. */
const HAMMER_MID = 35

/**
 * His two specials, in seconds. Shower of Sparks: he raises the hammer and brings it down on the
 * white-hot blade held out in his tongs at each of SPARK_STRIKES, and every blow throws a fan of
 * sparks out over the party. The Master's Throw: he draws the hammer back, hurls it at
 * THROW_RELEASE, it flies spinning out through the whole line and curves back up over them into his
 * hand at THROW_CATCH.
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

/** Where his hand lets go of the hammer, and takes it back, from his mark: his throwing pose's grip. */
const throwGrip = (): [number, number] => [-10 + 40 * FM_SCALE, -78 * FM_SCALE]

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

/** Where the Shower's blows land, from his mark: the middle of the blade held out in his tongs. */
const sparkPoint = (): [number, number] => [-10 + 34 * FM_SCALE + 40, -74 * FM_SCALE - 4]

/** A spark of the Shower thrown by blow `k`: its angle off the blade (down +) and speed. */
const SPARKS_PER_BLOW = 26
const SPARK_LIFE = 0.65
const SPARK_FALL = 300

/** Shower of Sparks: three blows on the white-hot blade, each throwing a fan of sparks over two of them. */
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
const FLYING = new Surface(160, 160, 80, 80)
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
        // a trail of fire behind its glowing head
        for (let k = 8; k >= 1; k--) {
            const [mx, my, a] = throwAt(Math.max(THROW_RELEASE, u - k * 0.022))
            const tx = mx + Math.cos(a) * (54 - HAMMER_MID)
            const ty = my + Math.sin(a) * (54 - HAMMER_MID)
            const r = 9 - k * 0.7
            const level = R(14 - k * 1.4)
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
        forgeHammer(FLYING, FLYING.ax - Math.cos(spin) * HAMMER_MID, FLYING.ay - Math.sin(spin) * HAMMER_MID, spin, C.gold3)
        const style = FLYING_STYLE.reset()
        style.flip = d < 0
        stamp(s, FLYING, st.bx + d * hx, st.by + hy, style)
        for (let i = 0; i < MASTERS_THROW.hits.length; i++) {
            const pt = hitTarget(st, i, true)
            blast(s, pt.x, chest(pt), t, MASTERS_THROW.hits[i]!, 11, 0.45, FIRE6, 101 + i, 'fire')
        }
    }
}

/**
 * His hammer through the specials, as grip and haft angle in his layout: Shower of Sparks between
 * resting, raised and down on the blade; the Throw drawn back, hurled, followed through and caught.
 * Null outside them, for his own attack's poses.
 */
function fmSpecialPose(st: string, t: number): [number, number, number] | null {
    const q0 = q(t)
    const REST = [26, -86, -2.4] as const
    const mix = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k, a[2]! + (b[2]! - a[2]!) * k]
    if (st === 'special') {
        const UP = [14, -128, -1.9] as const
        // the grip that brings the head's face down on the middle of the blade
        const HIT = [38, -109, 0.25] as const
        if (q0 < 0.55) return mix(REST, UP, sm(span(0.1, 0.55, q0)))
        for (let k = 0; k < SPARK_STRIKES.length; k++) {
            const ts = SPARK_STRIKES[k]!
            const next = SPARK_STRIKES[k + 1]
            if (q0 < ts - 0.06) return [...UP]
            if (q0 < ts) return mix(UP, HIT, sm(span(ts - 0.06, ts, q0)))
            if (q0 < ts + 0.1) return [...HIT]
            if (next !== undefined && q0 < next - 0.06) return mix(HIT, UP, sm(span(ts + 0.1, ts + 0.35, q0)))
        }
        return mix(HIT, REST, sm(span(SPARK_STRIKES[2] + 0.1, SPARK_DUR - 0.05, q0)))
    }
    if (st === 'special2') {
        const BACK = [-22, -84, -3.5] as const
        const THROWN = [40, -78, 0] as const
        if (q0 < 0.6) return mix(REST, BACK, sm(span(0.05, 0.6, q0)))
        if (q0 < THROW_RELEASE) return mix(BACK, THROWN, sm(span(0.6, THROW_RELEASE, q0)))
        // his hand held out after it, then braced for the catch, jolted by it, and back to rest
        if (q0 < THROW_CATCH) return [...THROWN]
        const jolt = Math.sin(span(THROW_CATCH, THROW_CATCH + 0.15, q0) * Math.PI) * 5
        if (q0 < THROW_CATCH + 0.15) return [THROWN[0] - jolt, THROWN[1] + jolt * 0.4, THROWN[2]]
        return mix(THROWN, REST, sm(span(THROW_CATCH + 0.15, THROW_DUR - 0.05, q0)))
    }
    return null
}

/**
 * The Forgemaster: the giant master smith. Bald, brass goggles pushed up on his brow, eyes like
 * embers under it, a great braided beard lit at its ends like coals and ringed in gold; a muscled
 * chest under a heavy scorched apron, a wide belt with a gold buckle, steel-capped boots, a steel
 * gauntlet on his hammer hand. His forge hammer rests on his shoulder, its striking face glowing
 * from the fire and runed in gold; in his other hand, tongs holding a white-hot blade out before him.
 * He raises the hammer high and brings it down in a burst of fire. He steps out of the forge-fire,
 * and when he falls he goes to a knee first.
 */
export const FORGE_MASTER: CreatureDef = {
    name: 'The Forgemaster', size: 256, room: 30, shadow: 42, accent: C.orange,
    states: { ...withSpecial(bossStates(1.8, 2.2, 2.4), SPARK_DUR), special2: { dur: THROW_DUR, loop: false } },
    specials: [SHOWER_OF_SPARKS, MASTERS_THROW],
    draw(s, st, t) {
        drive(this, st, t, 18, 2.2)
        // his specials move his hammer on poses of their own; the rest of him stays at rest
        const spPose = fmSpecialPose(st, t)
        // the hammer is out of his hand while it flies
        const held = !(st === 'special2' && q(t) >= THROW_RELEASE && q(t) < THROW_CATCH)
        const tt = q(t)
        const x = s.ax - 10 + B.lunge - B.kb
        const y = s.ay
        const br = B.breath
        // dying: down on a knee, then over onto his face
        const knee = Math.min(1, B.die * 1.8)
        const fall = Math.max(0, B.die * 1.8 - 1)
        const tilt = bz(0, -0.06, 0.1) + fall * 0.9
        const sinkBody = knee * 26
        // his frame is laid out tall and drawn a little smaller about his feet, to fit the camera
        const at = (lx: number, ly: number): [number, number] => { rot(x + lx * FM_SCALE, y + ly * FM_SCALE, x + 20, y, tilt); return [T.x, T.y] }
        const up = (lx: number, ly: number): [number, number] => at(lx + bz(0, -4, 8) * Math.max(0, -ly - 60) / 60, ly + br + sinkBody)
        const hotFace = B.glow > 0.4 || tt % 0.6 < 0.3 ? C.gold3 : C.orange

        // the hammer: resting on his shoulder, raised high, brought down on the party
        const [Gx, Gy] = spPose ? up(spPose[0], spPose[1]) : up(bz(26, 6, 50), bz(-86, -118, -62))
        const ga = (spPose ? spPose[2] : bz(-2.4, -1.75, 0.72)) + tilt

        // ── the far arm, the tongs and the blade in them ──
        {
            const [sx, sy] = up(-16, -108)
            const [hx, hy] = up(bz(34, 26, 30), bz(-74, -86, -80))
            elbow(sx, sy, hx, hy, 30, 30, 1)
            limb(s, 'mfarm', [sx, sy, P.x, P.y, hx, hy], [20, 16, 13], SKIN, -0.3, C.ink)
            const gm = mask(s, 'mfglove')
            disc(gm, hx, hy, 7, 1)
            vol(s, gm, LEATHER, 4, -0.3)
            // the tongs, reaching out, and the blade held in their jaws
            const tx = hx + 22
            const ty = hy + 2
            line(s, hx, hy - 1, tx, ty - 2, C.steel1, 2)
            line(s, hx, hy + 2, tx, ty + 1, C.steel0, 2)
            const bx = tx + 2
            const by = ty - 1
            const blade = mask(s, 'blade')
            poly(blade, [bx, by - 3, bx + 30, by - 10, bx + 33, by - 10, bx + 31, by - 7, bx, by + 2], 0, 0, 1)
            eachPx(blade, (px_, py, edge) => s.set(px_, py, edge ? C.orange : (px_ + py) % 3 ? C.gold3 : C.white))
            // heat shimmering off it
            for (let k = 0; k < 4; k++) px(s, bx + 6 + k * 7, by - 6 - k * 2 - ((R(tt * 10) + k) % 3), C.orange)
        }

        // ── legs, planted wide: dark trousers, steel-capped boots ──
        const leg = (hx: number, fx: number, far: boolean): void => {
            const [a, b] = up(hx, -58)
            // on a knee as he dies: the near knee comes down to the ground
            const [f, g] = at(fx + (far ? 0 : knee * 14), -8 - (far ? 0 : 0))
            elbow(a, b, f, g, 28, 26, -1)
            limb(s, far ? 'mfl' : 'mnl', [a, b, P.x, P.y, f, g], [26, 20, 17], CLOTH, far ? -0.3 : 0, C.ink)
            const bm = mask(s, 'boot')
            ellipse(bm, f + 5, g + 2, 14, 7, 1)
            poly(bm, [f - 8, g - 10, f + 7, g - 10, f + 9, g + 2, f - 9, g + 2], 0, 0, 1)
            vol(s, bm, LEATHER, 6, far ? -0.3 : 0)
            selOut(s, bm, C.ink)
            // the steel toe cap
            const cm = mask(s, 'toecap')
            ellipse(cm, f + 13, g + 3, 6, 5, 1)
            vol(s, cm, IRON, 3, far ? -0.3 : 0)
            line(s, f - 9, g + 8, f + 19, g + 8, C.ink)
        }
        leg(-14, -18, true)
        leg(8, 12, false)

        // ── his body: a muscled chest, a thick waist, a heavy apron, a wide belt ──
        const body = mask(s, 'mbody')
        {
            const [cx, cy] = up(0, -100)
            ellipse(body, cx, cy, 30, 24, 1)
            const [wx, wy] = up(2, -72)
            ellipse(body, wx, wy, 24, 18, 1)
            const [nx, ny] = up(-14, -112)
            disc(body, nx, ny, 13, 1)
            vol(s, body, SKIN, 20)
            // the line of his chest and the ridge of his stomach
            for (let k = 0; k <= 12; k++) { const [a, b] = up(-6 + k * 2, -96 + Math.abs(k - 6) * 0.6); if (body.get(R(a), R(b))) px(s, a, b, C.skin0) }
            selOut(s, body, C.ink)
        }
        {
            // the apron: heavy leather from under the beard to his knees, scorched, a coal burning in it
            const am = mask(s, 'mapron')
            poly(am, [[-8, -88], [24, -90], [30, -76], [34, -40], [30, -26], [-4, -24], [-10, -50], [-13, -76]].flatMap(([a, b]) => up(a!, b!)), 0, 0, 1)
            vol(s, am, LEATHER, 12, -0.05)
            selOut(s, am, C.brown0)
            eachPx(am, (px_, py) => { if (hash2(px_, py) < 0.035) s.set(px_, py, C.brown0) })
            for (const [ex, ey] of [[14, -46], [22, -60], [4, -36]] as const) { const [a, b] = up(ex, ey); px(s, a, b, C.orange); px(s, a + 1, b, C.lava1) }
            // straps over his shoulders, and the belt with its buckle
            for (const [a0, b0, a1, b1] of [[-8, -88, -14, -116], [22, -90, 14, -118]] as const) {
                const [p0x, p0y] = up(a0, b0)
                const [p1x, p1y] = up(a1, b1)
                line(s, p0x, p0y, p1x, p1y, C.brown1, 3)
            }
            const [b0x, b0y] = up(-16, -64)
            const [b1x, b1y] = up(30, -66)
            line(s, b0x, b0y, b1x, b1y, C.brown0, 5)
            line(s, b0x, b0y - 2, b1x, b1y - 2, C.brown2)
            const [kx, ky] = up(14, -66)
            const km = mask(s, 'buckle')
            poly(km, [kx - 5, ky - 5, kx + 5, ky - 5, kx + 5, ky + 4, kx - 5, ky + 4], 0, 0, 1)
            vol(s, km, BRASS, 3)
            poly(s, [kx - 2, ky - 2, kx + 2, ky - 2, kx + 2, ky + 1, kx - 2, ky + 1], 0, 0, C.brown0)
        }

        // ── his head: bald, a heavy brow, eyes of ember, goggles pushed up on it, and the beard ──
        {
            const hy = -138 + R(bz(0, -3, 4))
            const [hx, hy2] = up(22, hy)
            const m = mask(s, 'mhead')
            disc(m, hx, hy2, 16, 1)
            ellipse(m, hx + 5, hy2 + 6, 13, 11, 1)
            vol(s, m, SKIN, 10, 0.05)
            selOut(s, m, C.ink)
            // the ear, the nose, a heavy brow over eyes like coals
            disc(s, hx - 11, hy2 + 3, 3.5, C.skin0)
            const [nx, ny] = up(39, hy + 4)
            disc(s, nx, ny, 4.5, C.skin1); px(s, nx - 1, ny - 3, C.skin2); px(s, nx - 2, ny - 2, C.skin2); px(s, nx + 2, ny + 2, C.skin0)
            const [ex, ey] = up(31, hy)
            line(s, ex - 6, ey - 3, ex + 6, ey - 2, C.skin0, 2)
            const ember = B.hurt ? C.white : B.glow > 0.4 ? C.gold3 : C.orange
            px(s, ex - 1, ey, C.ink); px(s, ex, ey, ember); px(s, ex + 1, ey, ember); px(s, ex + 2, ey, C.lava1)
            px(s, ex, ey + 1, C.lava0); px(s, ex + 1, ey - 1, C.gold3)
            // the goggles, pushed up on his brow, their strap round his head
            const [gx, gy] = up(24, hy - 11)
            line(s, gx - 16, gy + 2, gx + 14, gy - 1, C.brown0, 2)
            for (const d of [0, 8]) {
                disc(s, gx + d, gy - 1, 4, C.gold1)
                disc(s, gx + d, gy - 1, 2.8, d ? C.lava1 : C.orange)
                px(s, gx + d - 1, gy - 2, C.gold3)
            }
            // the beard: a great braid down over his chest, ringed in gold, its end burning like a coal
            const [b0x, b0y] = up(32, hy + 13)
            for (let i = 0; i <= 12; i++) {
                const u = i / 12
                const [bx, by] = up(32 + Math.sin(u * 2.4 + tt) * 2 + u * 2, hy + 13 + u * 44)
                const r = 7 - u * 3
                disc(s, bx, by, r, BEARD[0])
                disc(s, bx - 1, by - 1, r - 1, i & 1 ? BEARD[1] : C.red2)
                px(s, bx - 2, by - 2, BEARD[2])
                if (i === 4 || i === 8) { line(s, bx - r, by, bx + r, by, C.gold2, 2); px(s, bx - 1, by - 1, C.gold3) }
            }
            const [ex2, ey2] = up(34, hy + 58)
            disc(s, ex2, ey2, 3, C.orange); px(s, ex2, ey2, C.gold3); px(s, ex2 + 1, ey2 + 2, C.lava1)
            // the moustache sweeping out over it
            line(s, b0x - 2, b0y - 2, b0x + 8, b0y + 2, C.red1, 3)
            line(s, b0x - 1, b0y - 3, b0x + 7, b0y + 1, C.red2)
        }

        // ── the forge hammer, in his hand unless it is flying ──
        if (held) forgeHammer(s, Gx, Gy, ga, hotFace)

        // ── his hammer arm: a mighty shoulder, a bare forearm, a steel gauntlet on the haft ──
        {
            const [sx, sy] = up(10, -108)
            elbow(sx, sy, Gx, Gy, 30, 30, 1)
            limb(s, 'mnarm', [sx, sy, P.x, P.y, Gx, Gy], [22, 18, 15], SKIN, 0, C.ink)
            // a leather bracer, and the steel gauntlet closed on the haft
            const cx = P.x + (Gx - P.x) * 0.55
            const cy = P.y + (Gy - P.y) * 0.55
            const bm = mask(s, 'bracer')
            disc(bm, cx, cy, 8, 1)
            vol(s, bm, LEATHER, 4)
            selOut(s, bm, C.ink)
            const gm = mask(s, 'gauntlet')
            disc(gm, Gx, Gy, 8.5, 1)
            vol(s, gm, IRON, 6)
            selOut(s, gm, C.steel0)
            px(s, Gx - 2, Gy - 3, C.white)
        }

        B.ent = Math.min(1, B.ent)
        finish(s, Entry.Fade, 10)
    },
    fx(dst, st, t, x, y, dir) {
        const tt = q(t)
        // embers always drifting up off him
        for (let i = 0; i < 10; i++) {
            const u = (tt * 0.5 + hash2(i, 3)) % 1
            dst.set(R(x + dir * ((hash2(i, 5) - 0.5) * 70) + Math.sin(u * 8 + i) * 3), R(y - 30 - u * 140), u < 0.6 ? C.orange : C.lava1)
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
        // the hammer comes down: a burst of fire and sparks where it lands
        if (st === 'attack' && B.strike) {
            const gx = x + dir * 104
            for (let i = 0; i < 22; i++) {
                const a = i / 22 * Math.PI
                const r = 8 + (i % 4) * 6
                dst.set(R(gx + Math.cos(a) * r), R(y - 2 - Math.sin(a) * r * 0.8), i % 3 === 0 ? C.gold3 : i & 1 ? C.orange : C.lava1)
            }
            for (let i = 0; i < 40; i++) dst.set(R(gx + (i - 20) * 3), y - (i & 1), i % 4 ? C.orange : C.gold3)
        }
    }
}
