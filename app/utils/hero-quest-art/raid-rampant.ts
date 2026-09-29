// Trait Raid (rampaging_boss): the Rampant, which cannot be killed and never shows an HP bar, so its
// rampage level is read off its body. A behemoth on four heavy legs, jointed and capped in bone, broad
// padded feet, a thick neck carrying its head low, a great hump over the shoulders armoured in plates of
// bone laid along its back, a mane of crystal growing up between the plates, a heavy head behind a bone skull
// mask with its eyes burning in the sockets, tusks, and horns sweeping forward like a bull's. Each tier
// it is bigger, its mane longer and brighter, one more pair of horns, more eyes lit, the veins under its
// hide burning hotter; on the escalation beat it rears and roars and grows into the next. No Death.

import { C } from './palette'
import type { BossSpecial, CreatureDef } from './creature'
import { CF, fr, sm } from './creature'
import { B, drive, elbow, P, bayer, px, line, disc, tri, poly, taper, ellipse, q, hash2 } from './boss-kit'
import { mask, vol, eachPx, selOut, bounds, BOX, type Mat5 } from './raid-kit'
import { debris, spike, sp, sq, hitTarget, chest, VOID6 } from './special-kit'
import { blast, shockRing } from './vfx-cinematic'

const R = Math.round

export const RAMPAGE_TIERS = 5

/**
 * The escalation, its big beat, in seconds: it crouches and gathers itself until ESC_CROUCH, rears
 * and roars (its roar goes up at RAMPAGE_ROAR, at the height of it at ESC_PEAK), slams its forelegs
 * down and grows into the next tier at RAMPAGE_SLAM, overshooting, and has settled by ESC_SETTLE.
 * The live stage times its hit-stop, shake and banner to these.
 */
const ESC_DUR = 1.9
const ESC_CROUCH = 0.35
export const RAMPAGE_ROAR = 0.55
const ESC_PEAK = 0.8
export const RAMPAGE_SLAM = 1.15
const ESC_SETTLE = 1.6

/** How far it rears at `t` into the escalation: down into the crouch (−), up to the roar (1), slammed down. */
function escRear(t: number): number {
    const q0 = q(t)
    if (q0 < ESC_CROUCH) return -0.35 * sm(q0 / ESC_CROUCH)
    if (q0 < ESC_PEAK) return -0.35 + 1.35 * sm((q0 - ESC_CROUCH) / (ESC_PEAK - ESC_CROUCH))
    if (q0 < RAMPAGE_SLAM) { const u = (q0 - ESC_PEAK) / (RAMPAGE_SLAM - ESC_PEAK); return 1 - 1.25 * u * u }
    const u = Math.min(1, (q0 - RAMPAGE_SLAM) / (ESC_SETTLE - RAMPAGE_SLAM))
    return -0.25 * (1 - u) * Math.cos(u * Math.PI * 1.5)
}

/** How far into the next tier it has grown at `t`: nothing until the slam, then a pop past it that settles. */
function escUp(t: number): number {
    const q0 = q(t)
    if (q0 < RAMPAGE_SLAM) return 0
    const pop = Math.min(1, (q0 - RAMPAGE_SLAM) / 0.1)
    const u = Math.min(1, (q0 - RAMPAGE_SLAM - 0.1) / 0.45)
    return q0 < RAMPAGE_SLAM + 0.1 ? 1.18 * pop : 1 + 0.18 * (1 - sm(u)) * Math.cos(u * Math.PI * 1.5)
}

/** Whether its crystals, veins and eyes are flaring white: from the roar through the slam. */
function escFlare(t: number): boolean {
    const q0 = q(t)
    return q0 >= RAMPAGE_ROAR - 0.1 && q0 < RAMPAGE_SLAM + 0.3
}

/**
 * Its two specials, in seconds. Rolling Crash: it crouches, springs at ROLL_LEAP curling into a ball
 * and somersaults forward, slams its armoured back down onto the party at ROLL_HIT, bounces off, and
 * rolls on round to land on its feet on its mark at ROLL_LAND. Shard Storm: it arches its hump while
 * its mane flares, then bucks at STORM_BUCK and the mane's crystals fly, one more wave each tier.
 */
const ROLL_DUR = 2.1
const ROLL_LEAP = 0.4
const ROLL_HIT = 0.85
/** The contact: a short squash against them, the spin slowing, before it bounces off. */
const ROLL_OFF = 0.95
const ROLL_LAND = 1.55
/** How far in front of its mark its back meets the party, and how high each hop arcs. */
const ROLL_REACH = 100
const ROLL_ARC = 32
const ROLL_BOUNCE = 30
/** Its angle through the roll (a whole forward turn), at leap, contact, bouncing off and landing: its back faces down and forward on contact. */
const ROLL_KEYS = [[ROLL_LEAP, 0], [ROLL_HIT, Math.PI * 0.75], [ROLL_OFF, Math.PI * 0.75 + 0.35], [ROLL_LAND, Math.PI * 2]] as const
const STORM_BUCK = 0.6
/** Each tier throws one more wave, each wave one crystal at every one of the party. */
const STORM_WAVE = 0.42
const STORM_PER_WAVE = 6
const STORM_STAGGER = 0.04
/** A thrown crystal's time from launch to landing, its climb out of sight, and its fall. */
const STORM_FLIGHT = 0.55
const STORM_UP = 0.18
const STORM_FALL = 0.22
/** When the Storm's last wave bucks at `tier`, and how long its Storm runs. */
const stormLast = (tier: number): number => STORM_BUCK + tier * STORM_WAVE
const stormDur = (tier: number): number => stormLast(tier) + STORM_STAGGER * STORM_PER_WAVE + STORM_FLIGHT + 1.0

/** Where the body is through a special: how far it rears (− is head down), its lunge, jaw, glow, its hump arched, the mane spent, a shiver, and how far it is curled into a ball. */
interface SpPose { rear: number, lunge: number, open: number, glow: number, arch: number, spent: number, shiver: number, curl: number }
const POSE: SpPose = { rear: 0, lunge: 0, open: 0, glow: 0, arch: 0, spent: 0, shiver: 0, curl: 0 }

const span = (a: number, b: number, v: number): number => Math.min(1, Math.max(0, (v - a) / (b - a)))

/** The body's scale at `tier`, as `rampantDraw` sizes it. */
const tierSize = (tier: number): number => 0.8 + tier * 0.06

/** The roll's pivot at rest, from the anchor: the middle of the ball it curls into. */
const pivotX = (sz: number): number => -6 + 5 * sz
const pivotY = (sz: number): number => -84 * sz
/** How far the ball's back sits from its middle: what meets the party. */
const backR = (sz: number): number => 41 * sz

/**
 * A monotone cubic through `keys` ([time, value]), easing out to a stop at the last: the roll's
 * angle, so its spin runs on without a hitch through every key.
 */
function smoothKeys(keys: readonly (readonly [number, number])[], t: number, v0: number): number {
    const n = keys.length
    if (t <= keys[0]![0]) return keys[0]![1]
    if (t >= keys[n - 1]![0]) return keys[n - 1]![1]
    const sl = (i: number) => (keys[i + 1]![1] - keys[i]![1]) / (keys[i + 1]![0] - keys[i]![0])
    const slope = (i: number) => i === 0 ? v0 : i === n - 1 ? 0 : (sl(i - 1) + sl(i)) / 2
    let i = 0
    while (t > keys[i + 1]![0]) i++
    const [t0, a0] = keys[i]!
    const [t1, a1] = keys[i + 1]!
    const h = t1 - t0
    const u = (t - t0) / h
    const u2 = u * u
    const u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * a0 + (u3 - 2 * u2 + u) * h * slope(i) + (-2 * u3 + 3 * u2) * a1 + (u3 - u2) * h * slope(i + 1)
}

/** Where the roll has it at `q0` seconds: its pivot's offset from rest (forward +, down +), its angle, and how curled it is. */
const ROLL = { dx: 0, dy: 0, ang: 0, curl: 0, air: 0 }
function rollAt(q0: number, sz: number): typeof ROLL {
    const r = ROLL
    // where its middle is when its back meets them: as low as it goes with its mane's tips just
    // grazing the ground, so the back comes down onto them
    const hx = ROLL_REACH - backR(sz) * Math.SQRT1_2 - pivotX(sz)
    const hy = -(62 * sz + 2) - pivotY(sz)
    // on the ground (the crouch it springs from, the landing) it stays on its feet: the pose carries those
    if (q0 < ROLL_LEAP) { r.dx = 0; r.dy = 0 } else if (q0 < ROLL_HIT) {
        const u = (q0 - ROLL_LEAP) / (ROLL_HIT - ROLL_LEAP)
        r.dx = hx * u
        r.dy = hy * u - ROLL_ARC * 4 * u * (1 - u)
    } else if (q0 < ROLL_OFF) {
        // pressed into them
        const v = Math.sin(Math.PI * (q0 - ROLL_HIT) / (ROLL_OFF - ROLL_HIT))
        r.dx = hx + 4 * v
        r.dy = hy + 3 * v
    } else if (q0 < ROLL_LAND) {
        const u = (q0 - ROLL_OFF) / (ROLL_LAND - ROLL_OFF)
        r.dx = hx * (1 - u)
        r.dy = hy * (1 - u) - ROLL_BOUNCE * 4 * u * (1 - u)
    } else {
        // it lands on its feet, and the pose takes the weight
        r.dx = 0
        r.dy = 0
    }
    r.ang = smoothKeys(ROLL_KEYS, q0, 2)
    r.curl = sm(span(ROLL_LEAP - 0.02, ROLL_LEAP + 0.15, q0)) * (1 - sm(span(ROLL_LAND - 0.25, ROLL_LAND - 0.03, q0)))
    r.air = sm(span(ROLL_LEAP, ROLL_LEAP + 0.1, q0)) * (1 - sm(span(ROLL_LAND - 0.1, ROLL_LAND, q0)))
    return r
}

function rollPose(t: number, sz: number): SpPose {
    const p = POSE
    const q0 = q(t)
    const r = rollAt(q0, sz)
    p.arch = 0; p.spent = 0; p.shiver = 0; p.lunge = 0
    p.curl = r.curl
    // head down into the crouch, then tucked; the landing's weight dips it, and it looks up again
    const land = sm(span(ROLL_LAND, ROLL_LAND + 0.07, q0)) * (1 - sm(span(ROLL_LAND + 0.07, ROLL_DUR - 0.1, q0)))
    p.rear = -0.4 * sm(span(0, 0.3, q0)) * (1 - r.curl) * (q0 < ROLL_LEAP ? 1 : 0) - 0.3 * land
    p.open = q0 > ROLL_HIT - 0.05 && q0 < ROLL_OFF + 0.1 ? 1 : 0.2
    p.glow = Math.max(span(0.1, ROLL_LEAP, q0) * (q0 < ROLL_LAND ? 1 : 0), 1 - span(ROLL_LAND, ROLL_DUR, q0) * 2) * (q0 > 0.1 ? 1 : 0)
    return p
}

function stormPose(t: number, tier: number): SpPose {
    const p = POSE
    const q0 = q(t)
    p.lunge = 0; p.curl = 0
    if (q0 < STORM_BUCK) {
        // it gathers: head down, the hump arching up, shivering as the mane fills with light
        const u = sm(span(0, STORM_BUCK, q0))
        p.rear = -0.3 * u
        p.arch = u
        p.open = 0.2
        p.glow = u
        p.spent = 0
        p.shiver = q0 > 0.3 ? ((Math.floor(q0 * 20) & 1) ? 1 : -1) : 0
    } else {
        // a buck for each wave: the back snaps up and the head tosses; after the last it settles
        const last = stormLast(tier)
        const w = Math.min(tier, Math.floor((q0 - STORM_BUCK) / STORM_WAVE))
        const tw = STORM_BUCK + w * STORM_WAVE
        const bump = span(tw, tw + 0.08, q0) * (1 - sm(span(tw + 0.08, tw + 0.35, q0)))
        const settle = sm(span(last + 0.1, last + 0.8, q0))
        p.rear = (-0.3 + 0.7 * bump) * (1 - settle)
        p.arch = (1 + 0.6 * bump) * (1 - settle)
        p.open = Math.max(bump, 0.2) * (1 - settle * 0.8)
        p.glow = 1 - settle
        // each buck throws the mane; between waves it half grows back, after the last all the way
        const thrown = (w ? 0.5 : 0) + (1 - (w ? 0.5 : 0)) * span(tw, tw + 0.06, q0)
        p.spent = w < tier ? thrown - 0.5 * sm(span(tw + 0.1, tw + STORM_WAVE, q0)) : thrown * (1 - sm(span(tw + 0.4, tw + 1.1, q0)))
        p.shiver = 0
    }
    p.lunge = -2 * p.arch
    return p
}

const HIDE: Mat5 = { ramp: [C.void, C.night1, C.night2, C.night3], hi: C.purple2, rim: C.purple0 }
const BONE: Mat5 = { ramp: [C.bone0, C.bone0, C.bone1, C.white], hi: C.white, rim: C.bone0 }
const OLD_BONE: Mat5 = { ramp: [C.stone1, C.bone0, C.bone0, C.bone1], hi: C.bone1, rim: C.stone1 }
/** The crystals, brighter each tier: a lit face, a dark face and a burning core. */
const CRYSTAL = [
    { lit: C.purple2, dark: C.purple0, core: C.purple2 },
    { lit: C.purple2, dark: C.purple1, core: C.pink },
    { lit: C.pink, dark: C.purple1, core: C.pink },
    { lit: C.pink, dark: C.purple2, core: C.white },
    { lit: C.white, dark: C.pink, core: C.white }
] as const
/** The veins under its hide: faint at the start, white-hot at the top. */
const VEIN = [C.purple1, C.purple2, C.pink, C.pink, C.white] as const

type S = Parameters<CreatureDef['draw']>[0]

/**
 * The Rampant at `t` into `st`. Through the Rolling Crash the body is drawn curled into a scratch
 * buffer and turned about the ball's middle as one piece, carried along the roll's path.
 */
function rampantDraw(tier: number, s: S, st: string, t: number, def: CreatureDef): void {
    if (st !== 'special') { rampantBody(tier, s, st, t, def); return }
    const sz = tierSize(tier)
    const src = mask(s, 'roll')
    rampantBody(tier, src, st, t, def)
    const r = rollAt(q(t), sz)
    const px0 = s.ax + pivotX(sz)
    const py0 = s.ay + pivotY(sz)
    const dx = px0 + r.dx
    const dy = py0 + r.dy
    const c = Math.cos(r.ang)
    const sn = Math.sin(r.ang)
    // its shadow thins while it is off the ground
    CF.shadow = 1 - 0.8 * r.air
    // every pixel the turned body can reach, taken back through the turn to it (nearest pixel):
    // the disc round the pivot out to the curled body's farthest corner
    if (!bounds(src, true)) return
    const reach = Math.ceil(Math.max(...[BOX.x0, BOX.x1 + 1].flatMap(bx => [BOX.y0, BOX.y1 + 1].map(by => Math.hypot(bx - px0, by - py0))))) + 1
    const ya = Math.max(0, Math.floor(dy - reach))
    const yb = Math.min(s.h - 1, Math.ceil(dy + reach))
    const xa = Math.max(0, Math.floor(dx - reach))
    const xb = Math.min(s.w - 1, Math.ceil(dx + reach))
    for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
            const rx = x - dx
            const ry = y - dy
            const v = src.get(R(px0 + rx * c + ry * sn), R(py0 - rx * sn + ry * c))
            if (v) s.set(x, y, v)
        }
    }
}

function rampantBody(tier: number, s: S, st: string, t: number, def: CreatureDef): void {
    drive(def, st, t, 16, 1.2 - tier * 0.08)
    // the escalation beat grows it into the next tier, on the slam
    const esc = st === 'escalate'
    const up = esc ? escUp(t) : 0
    if (esc && escFlare(t)) B.glow = 1
    // its specials play on poses of their own
    const pose = st === 'special' ? rollPose(t, tierSize(tier)) : st === 'special2' ? stormPose(t, tier) : null
    if (pose) { B.lunge = R(pose.lunge); B.glow = pose.glow }
    // the Storm's mane blinks white as it fills with light
    const storming = st === 'special2' && q(t) > 0.25 && q(t) < STORM_BUCK + 0.06
    const lv = tier + up
    const sz = 0.8 + lv * 0.06
    const x = s.ax - 6 + B.lunge - B.kb + (pose?.shiver ?? 0)
    const y = s.ay
    const br = B.breath
    const pulse = (Math.sin(q(t) * 5) + 1) / 2
    // flaring on the roar, as bright as they go
    const cr = CRYSTAL[(esc && escFlare(t)) || (storming && Math.floor(q(t) * 12) & 1) ? 4 : Math.min(4, Math.round(lv))]!
    const vein = VEIN[esc && escFlare(t) ? 4 : Math.min(4, Math.round(lv))]!
    // a point on the body, scaled from its feet
    const L = (dx: number, dy: number): [number, number] => [x + dx * sz, y + dy * sz]
    // it rears on the escalation and the wind-up, and drives its horns down on the strike
    const rear = esc ? escRear(t) : pose ? pose.rear : B.wind
    // the escalation is its big beat: the head goes up much further than on a wind-up; the gore's
    // hook heaves it up hard
    const curl = pose?.curl ?? 0
    // curled into a ball, its head is tucked down and back into its chest
    const lift = rear * (esc ? 30 : 16) - (B.strike ? 8 : B.rec * 5) - curl * 12
    const tuck = curl * 12
    const arch = pose?.arch ?? 0
    // a point `u` of the way from a to b: its legs and tail drawn in as it curls
    const mix = (a: number, b: number): number => a + (b - a) * curl

    // ── a leg: two bones out of the shoulder, three out of the hip, a bone cap on each joint that
    //    shows, a broad padded foot and three heavy claws; the forelegs lift and tuck as it rears ──
    const cap = (jx: number, jy: number, r: number, far: boolean, backward: boolean): void => {
        const m = mask(s, 'cap')
        ellipse(m, jx + (backward ? -r * 0.55 : r * 0.45), jy, r * 0.5, r * 0.75, 1)
        vol(s, m, far ? OLD_BONE : BONE, 4, far ? -0.25 : 0)
        selOut(s, m, far ? C.stone1 : C.bone0)
    }
    const leg = (fore: boolean, far: boolean): void => {
        const ox = far ? -8 : 0
        const m = mask(s, 'leg')
        let fx: number
        let fy: number
        const joints: [number, number, number, boolean][] = []
        const tops: [number, number, number][] = []
        if (fore) {
            const tuck = Math.max(0, rear) * (far ? 14 : 18)
            const [sx, sy] = L(20 + ox, -68 - rear * 8)
            // tucked up under its chest as it curls
            ;[fx, fy] = L(mix(26 + ox + rear * 8, 8 + ox), mix(-4 - tuck, -40))
            elbow(sx, sy, fx, fy, 33 * sz, 37 * sz, 1)
            const ex = P.x
            const ey = P.y
            const wx = ex + (fx - ex) * 0.72
            const wy = ey + (fy - ey) * 0.72
            taper(m, sx, sy, ex, ey, 34 * sz, 24 * sz, 1)
            taper(m, ex, ey, wx, wy, 23 * sz, 17 * sz, 1)
            taper(m, wx, wy, fx, fy, 17 * sz, 20 * sz, 1)
            disc(m, ex, ey, 12 * sz, 1)
            disc(m, wx, wy, 9 * sz, 1)
            if (!far) { const [tx, ty] = [sx - 5 * sz, sy]; disc(m, tx, ty, 19 * sz, 1); taper(m, tx, ty, ex, ey, 30 * sz, 24 * sz, 1); tops.push([tx, ty, 17 * sz]) }
            joints.push([ex, ey, 10 * sz, true], [wx, wy, 7 * sz, false])
        } else {
            const [hx, hy] = L(-40 + ox, -64)
            // drawn up under its belly as it curls
            const [kx, ky] = L(mix(-28 + ox, -14 + ox), mix(-40, -50))
            const [jx, jy] = L(mix(-50 + ox, -30 + ox), mix(-22, -40))
            ;[fx, fy] = L(mix(-44 + ox, -12 + ox), mix(-4, -38))
            taper(m, hx, hy, kx, ky, 38 * sz, 26 * sz, 1)
            // the hip, rounded as wide as the thigh: the taper's square end left a flat top and a
            // sharp corner at the back
            disc(m, hx, hy, 19 * sz, 1)
            taper(m, kx, ky, jx, jy, 25 * sz, 16 * sz, 1)
            taper(m, jx, jy, fx, fy, 16 * sz, 19 * sz, 1)
            disc(m, kx, ky, 13 * sz, 1)
            disc(m, jx, jy, 9 * sz, 1)
            if (!far) { const [tx, ty] = [hx, hy + 9 * sz]; disc(m, tx, ty, 15 * sz, 1); tops.push([tx, ty, 12 * sz]) }
            joints.push([kx, ky, 10 * sz, false], [jx, jy, 8 * sz, true])
        }
        vol(s, m, HIDE, 12, far ? -0.3 : 0)
        selOut(s, m, C.void)
        for (const [jx, jy, r, backward] of joints) cap(jx, jy, r, far, backward)
        // the shoulder or hip it swings from: a bone plate over the top of the joint, ridged
        for (const [jx, jy, r] of tops) {
            const tm = mask(s, 'topcap')
            ellipse(tm, jx, jy - r * 0.4, r * 0.95, r * 0.6, 1)
            vol(s, tm, BONE, 6)
            selOut(s, tm, C.bone0)
            line(s, jx - r * 0.6, jy - r * 0.55, jx + r * 0.5, jy - r * 0.7, C.white)
            for (const k of [-0.45, 0, 0.45]) px(s, jx + k * r, jy - r * 0.25, C.stone1)
        }
        // the foot: a broad pad, three heavy claws curling over the ground
        const pm = mask(s, 'pad')
        ellipse(pm, fx + 2 * sz, fy + 1, 14 * sz, 5 * sz, 1)
        vol(s, pm, HIDE, 5, far ? -0.35 : -0.1)
        selOut(s, pm, C.void)
        for (let k = -1; k <= 1; k++) {
            const cx = fx + 2 * sz + k * 8 * sz
            const cy = fy + 2
            poly(s, [cx - 3 * sz, cy - 2, cx + 2 * sz, cy - 3, cx + 8 * sz, cy + 3, cx + 4 * sz, cy + 3], 0, 0, far ? C.bone0 : C.bone1)
            line(s, cx - 2 * sz, cy - 2, cx + 6 * sz, cy + 2, far ? C.stone1 : C.bone0)
            px(s, cx + 8 * sz, cy + 3, far ? C.bone0 : C.white)
        }
    }
    leg(true, true)
    leg(false, true)

    // ── the body: haunch, barrel, sagging belly, the great hump over the shoulders, and a thick neck
    //    down and forward to the head ──
    const [hx0, hy0] = L(-50, -68 + br)
    const [sx0, sy0] = L(30, -76 + br - rear * 8)
    const body = mask(s, 'body')
    {
        const [hx, hy] = L(-40, -64 + br)
        ellipse(body, hx, hy, 24 * sz, 23 * sz, 1)
        const [bx, by] = L(16, -76 + br - rear * 8)
        taper(body, hx, hy, bx, by, 40 * sz, 60 * sz, 1)
        const [gx, gy] = L(2, -60 + br)
        ellipse(body, gx, gy, 24 * sz, 14 * sz, 1)
        const [ux, uy] = L(10, -96 + br - rear * 10 - arch * 4)
        disc(body, ux, uy, 29 * sz, 1)
        const [shx, shy] = L(20, -70 + br - rear * 8)
        ellipse(body, shx, shy, 23 * sz, 27 * sz, 1)
        const [n0x, n0y] = L(26, -80 + br - rear * 9)
        const [n1x, n1y] = L(48 - tuck, -62 + br - lift)
        taper(body, n0x, n0y, n1x, n1y, 40 * sz, 30 * sz, 1)
        vol(s, body, HIDE, 24)
        shag(s, body)
        // veins burning under the hide, branching, hotter each tier
        for (let i = 0; i < 3 + R(lv * 2); i++) {
            let vx = R(hx0 + hash2(i, 5) * (sx0 - hx0))
            let vy = R(hy0 + 6 * sz + hash2(i, 9) * 18 * sz)
            for (let k = 0; k < 6; k++) {
                const nx = vx + 3 + R(hash2(i * 7 + k, 2) * 3)
                const ny = vy - 2 + R(hash2(i * 5 + k, 4) * 5) - 2
                if (!body.get(nx, ny)) break
                line(s, vx, vy, nx, ny, (k + i + R(q(t) * 6)) % 5 === 0 ? C.white : vein)
                vx = nx
                vy = ny
            }
        }
        // the creases that mark out the shoulder and the haunch under the hide
        for (const [cx0, cy0, r, a0, a1] of [[20, -70, 25, 1.5, 3.4], [-40, -62, 23, -0.1, 1.5]] as const) {
            for (let k = 0; k <= 16; k++) {
                const w = a0 + (a1 - a0) * k / 16
                const [ex, ey] = L(cx0 + Math.cos(w) * r, cy0 + br - (cx0 > 0 ? rear * 8 : 0) + Math.sin(w) * r)
                if (!body.get(R(ex), R(ey))) continue
                px(s, ex, ey, C.void)
                px(s, ex - 1, ey - 1, C.night3)
            }
        }
        selOut(s, body, C.void)
    }
    // ── the tail, over the body: out of the top of the rump, heavy at the root, small plates down it, a
    //    club of crystal at its end ──
    {
        const m = mask(s, 'tail')
        const sw = Math.sin(q(t) * 2) * 4
        const [a, b] = L(-54, -68 + br)
        // curled up over its back into the ball
        const [c, d] = L(mix(-78, -72), mix(-56 + sw, -92))
        const [e, f] = L(mix(-88, -56), mix(-34 + sw, -118))
        taper(m, a, b, c, d, 22 * sz, 12 * sz, 1)
        disc(m, a, b, 10 * sz, 1)
        taper(m, c, d, e, f, 12 * sz, 7 * sz, 1)
        disc(m, c, d, 6 * sz, 1)
        vol(s, m, HIDE, 8, -0.1)
        selOut(s, m, C.void)
        for (let i = 0; i < 3; i++) {
            const u = 0.2 + i * 0.28
            const tx = a + (c - a) * u * 1.4
            const ty = b + (d - b) * u * 1.4
            const pm = mask(s, 'tplate')
            ellipse(pm, tx - 1, ty - 5 * sz * (1 - u * 0.6), 5 * sz * (1 - u * 0.4), 3 * sz, 1)
            vol(s, pm, OLD_BONE, 3)
            selOut(s, pm, C.stone1)
        }
        crystal(s, e, f, -2.0, 13 * sz, 6 * sz, cr, pulse)
        crystal(s, e + 3, f - 3, -1.4, 10 * sz, 5 * sz, cr, 1 - pulse)
        crystal(s, e - 3, f - 1, -2.6, 8 * sz, 4 * sz, cr, (pulse + 0.5) % 1)
    }


    // the line of its back, from the body just drawn: where the mane grows and the plates lie
    const backAt = (bx: number): number => {
        const cx = R(bx)
        for (let yy = 0; yy < s.h; yy++) if (body.get(cx, yy)) return yy
        return -1
    }

    // ── the crystal mane, growing up out of the back (the plates will sit over its roots) ──
    const count = 6 + R(lv * 2.5)
    for (let i = 0; i < count; i++) {
        const u = i / (count - 1)
        const [bx] = L(-36 + u * 68, 0)
        const by = backAt(bx)
        if (by < 0) continue
        // thrown by the Storm, stubs left that grow back
        const h = (10 + Math.sin(u * Math.PI) * (9 + lv * 4)) * sz * (0.8 + hash2(i, 3) * 0.4) * (1 - (pose?.spent ?? 0) * 0.75)
        crystal(s, bx, by + 4, -Math.PI / 2 - 0.45 + u * 0.5 + (hash2(i, 7) - 0.5) * 0.3, h, (5 + lv * 0.6) * sz, cr, (pulse + u) % 1)
    }

    // ── bone armour down the back: plates laid along its line, each over the one behind ──
    for (let i = 0; i < 7; i++) {
        const u = i / 6
        const [bx] = L(-40 + u * 72, 0)
        const by = backAt(bx)
        if (by < 0) continue
        const a = Math.atan2(backAt(bx + 5) - backAt(bx - 5), 10)
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const rx = 11 * sz
        const ry = 5.5 * sz
        const pts: number[] = []
        for (let k = 0; k < 16; k++) {
            const w = k / 16 * Math.PI * 2
            const ex = Math.cos(w) * rx
            const ey = Math.sin(w) * ry
            pts.push(bx + ex * ca - ey * sa, by + 3 + ex * sa + ey * ca)
        }
        const m = mask(s, 'plate')
        poly(m, pts, 0, 0, 1)
        vol(s, m, OLD_BONE, 6)
        selOut(s, m, C.stone1)
        // its lit ridge, and a worn notch at its front edge
        line(s, bx - ca * rx * 0.7, by + 2 - sa * rx * 0.7, bx + ca * rx * 0.6, by + 2 + sa * rx * 0.6, C.bone1)
        px(s, bx + ca * rx * 0.8, by + 3 + sa * rx * 0.8, C.stone1)
    }

    // ── near legs, in front of the body, their round shoulder and hip joints capped in bone ──
    leg(false, false)
    leg(true, false)

    // ── the head: a heavy skull under a bone face-plate, a brow over deep burning sockets, a nasal
    //    ridge down to the nostrils, a real lower jaw, a maw lit from inside, curved boar tusks ──
    {
        // a point on the head, lifted as it rears (the snout a little less)
        const Hp = (dx: number, dy: number): [number, number] => { const [a, b] = L(dx - tuck, dy + br); return [a, b - lift * (dx > 60 ? 0.8 : 1)] }
        // the lower jaw, which drops on the roar and the strike
        const open = pose ? pose.open : Math.min(1.3, (esc ? Math.max(0, rear) * 1.3 : 0) + (B.strike ? 1 : 0) + B.wind * 0.3)
        const drop = open * 9
        // the far tusk, behind everything on the head
        {
            const [tx, ty] = Hp(68, -48 + drop)
            tusk(s, tx, ty, (20 + lv * 2) * sz, 5 * sz, true)
        }
        const jm = mask(s, 'jaw')
        {
            const [j0x, j0y] = Hp(46, -52)
            const [j1x, j1y] = Hp(76, -46 + drop)
            taper(jm, j0x, j0y, j1x, j1y, 17 * sz, 11 * sz, 1)
            disc(jm, j1x, j1y, 6 * sz, 1)
            vol(s, jm, HIDE, 8, -0.12)
            selOut(s, jm, C.void)
        }
        // the maw between the jaws: dark, lit from inside as it opens, a row of teeth along each jaw
        {
            const [u0x, u0y] = Hp(56, -56)
            const [u1x, u1y] = Hp(80, -54)
            const [l1x, l1y] = Hp(78, -50 + drop)
            const [l0x, l0y] = Hp(56, -52 + drop * 0.4)
            poly(s, [u0x, u0y, u1x, u1y, l1x, l1y, l0x, l0y], 0, 0, C.void)
            if (open > 0.3) {
                const [gx, gy] = Hp(68, -53 + drop * 0.5)
                disc(s, gx, gy, (2 + open * 3) * sz, lv >= 3 ? C.pink : C.purple1)
                disc(s, gx, gy, (1 + open * 1.5) * sz, C.white)
            }
            for (let k = 0; k < 6; k++) {
                const u = (k + 0.5) / 6
                px(s, u0x + (u1x - u0x) * u, u0y + (u1y - u0y) * u + 1, C.bone1)
                px(s, l0x + (l1x - l0x) * u, l0y + (l1y - l0y) * u - 1, C.bone1)
            }
        }
        // the skull: a round cranium and a heavy snout
        const m = mask(s, 'head')
        {
            const [cx, cy] = Hp(50, -64)
            const [nx, ny] = Hp(80, -58)
            disc(m, cx, cy, 20 * sz, 1)
            taper(m, cx, cy, nx, ny, 30 * sz, 19 * sz, 1)
            disc(m, nx, ny, 9 * sz, 1)
            vol(s, m, HIDE, 12, 0.05)
            selOut(s, m, C.void)
        }
        // the bone face-plate over the brow and down the snout
        const bm = mask(s, 'mask')
        poly(bm, [[36, -80], [46, -88], [60, -85], [72, -74], [84, -63], [86, -57], [80, -57], [70, -61], [58, -64], [46, -66], [36, -71]].flatMap(([a, b]) => Hp(a!, b!)), 0, 0, 1)
        vol(s, bm, BONE, 9)
        selOut(s, bm, C.bone0)
        // the brow ridge: lit along its top, a shadow under it over the sockets
        for (let k = 0; k <= 14; k++) {
            const u = k / 14
            const [a, b] = Hp(44 + u * 24, -78 + u * 6 - Math.sin(u * Math.PI) * 2)
            px(s, a, b - 1, C.white)
            px(s, a, b + 1, C.bone0)
            px(s, a, b + 2, C.stone1)
        }
        // the nasal ridge down to the nostrils, and a crack across the plate
        for (let k = 0; k <= 12; k++) {
            const u = k / 12
            const [a, b] = Hp(68 + u * 15, -70 + u * 10)
            px(s, a, b, C.white)
            px(s, a + 1, b + 1, C.bone0)
        }
        {
            const [a, b] = Hp(52, -84)
            line(s, a, b, a + 3 * sz, b + 4 * sz, C.stone1)
            line(s, a + 3 * sz, b + 4 * sz, a + 2 * sz, b + 8 * sz, C.stone1)
        }
        {
            const [a, b] = Hp(84, -59)
            px(s, a, b, C.void); px(s, a - 2, b + 1, C.void); px(s, a - 1, b, C.void)
        }
        // deep sockets under the brow, eyes burning in them, a glow spilling round
        const eyes = 1 + Math.floor(lv / 2)
        for (let e = 0; e < eyes; e++) {
            const [ex, ey] = Hp(62 - e * 9, -71 + e * 2)
            for (let k = -3; k <= 3; k++) { px(s, ex + k * sz, ey + k * 0.35, C.void); px(s, ex + k * sz, ey + k * 0.35 - 1, C.void) }
            const c = B.hurt ? C.white : lv >= 3 || B.glow > 0.4 ? C.white : C.pink
            px(s, ex, ey, c)
            px(s, ex + 1, ey, c)
            px(s, ex + 2, ey + 1, C.pink)
            px(s, ex - 1, ey, C.pink)
            px(s, ex, ey - 2, C.purple2)
            if (lv >= 2 || B.glow > 0.4) { px(s, ex - 3, ey + 2, C.pink); px(s, ex + 3, ey + 2, C.purple2) }
        }
        // the near tusk, out of the side of the lower jaw, sweeping up past the snout
        {
            const [tx, ty] = Hp(72, -47 + drop)
            tusk(s, tx, ty, (26 + lv * 2.5) * sz, 7.5 * sz, false)
        }
        // horns: a great pair sweeping forward, another pair behind them every two tiers
        const pairs = 1 + Math.floor(lv / 2)
        for (let p = pairs - 1; p >= 0; p--) {
            const [ax, ay] = L(40 - p * 9 - tuck, -80 - p * 3 + br)
            horn(s, ax, ay - lift, (40 + p * 6 + lv * 3) * sz, (9 - p) * sz, p > 0)
        }
    }
}

/** Shaggy hide over what is drawn in `m`: short strokes raked back. */
function shag(s: S, m: S): void {
    eachPx(m, (px_, py, edge) => { if (!edge && hash2(px_, py) < 0.014) { s.set(px_, py, C.night3); s.set(px_ - 1, py + 1, C.night1) } })
}

/**
 * A boar's tusk from its root in the jaw at (x, y): up and forward out of the jaw, then curving up
 * and back past the snout, tapering to a sharp tip, ringed with ridges, a dark gum where it leaves the jaw. The
 * `far` one is duller and behind the head.
 */
function tusk(s: S, x: number, y: number, len: number, w: number, far: boolean): void {
    const m = mask(s, 'tusk')
    let cx = x
    let cy = y
    const n = 10
    for (let i = 0; i < n; i++) {
        const u = i / n
        const a = -0.45 - u * 1.9
        const nx = cx + Math.cos(a) * len / n
        const ny = cy + Math.sin(a) * len / n
        taper(m, cx, cy, nx, ny, Math.max(1, w * (1 - u * 0.8)), Math.max(1, w * (1 - (u + 1 / n) * 0.8)), 1)
        cx = nx
        cy = ny
    }
    vol(s, m, far ? OLD_BONE : BONE, 5, far ? -0.2 : 0)
    selOut(s, m, far ? C.stone1 : C.bone0)
    eachPx(m, (px_, py) => { if ((px_ * 2 + py) % 6 === 0) s.set(px_, py, far ? C.stone1 : C.bone0) })
    px(s, cx, cy, C.white)
    disc(s, x, y, Math.max(1.5, w * 0.55), far ? C.void : C.night1)
}

/** A crystal spike from (x, y) along `a`: a lit face and a dark face, a burning core line, a tip. */
function crystal(s: S, x: number, y: number, a: number, h: number, w: number, cr: typeof CRYSTAL[number], pulse: number): void {
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const tx = x + ca * h
    const ty = y + sa * h
    tri(s, x - sa * w, y + ca * w, x, y, tx, ty, cr.lit)
    tri(s, x, y, x + sa * w, y - ca * w, tx, ty, cr.dark)
    line(s, x + ca * h * 0.15, y + sa * h * 0.15, x + ca * h * 0.8, y + sa * h * 0.8, pulse > 0.5 ? C.white : cr.core)
    px(s, R(tx), R(ty), C.white)
}

/**
 * A horn from its root (x, y): up first, then sweeping forward and down at the party like a bull's,
 * tapering to a dark tip, ridged across its length. `back` horns are older and duller.
 */
function horn(s: S, x: number, y: number, len: number, w: number, back: boolean): void {
    const m = mask(s, 'horn')
    let cx = x
    let cy = y
    const n = 12
    for (let i = 0; i < n; i++) {
        const u = i / n
        const a = -Math.PI / 2 + (back ? -0.15 : 0.1) + u * 1.9
        const nx = cx + Math.cos(a) * len / n
        const ny = cy + Math.sin(a) * len / n
        taper(m, cx, cy, nx, ny, Math.max(1, w * (1 - u * 0.85)), Math.max(1, w * (1 - (u + 1 / n) * 0.85)), 1)
        cx = nx
        cy = ny
    }
    vol(s, m, back ? OLD_BONE : BONE, 6)
    selOut(s, m, back ? C.stone1 : C.bone0)
    eachPx(m, (px_, py) => { if ((px_ + py * 2) % 7 === 0) s.set(px_, py, C.bone0) })
    px(s, R(cx), R(cy), C.void)
}

/**
 * The escalation, round it: light drawn in from all round as it crouches, rings of its roar rolling off
 * its head, then the slam: a shockwave out across the ground, the new level's ring blazing, earth
 * thrown up both ways and shards of crystal erupting round its feet.
 */
function escalationFx(dst: S, t: number, x: number, y: number, dir: number, sz: number, tier: number): void {
    const q0 = q(t)
    const cx = x + dir * 10 * sz
    const cy = y - 70 * sz
    // gathering
    if (q0 < ESC_PEAK) {
        const fade = q0 > ESC_PEAK - 0.2 ? (ESC_PEAK - q0) / 0.2 : 1
        for (let i = 0; i < 28; i++) {
            if (hash2(i, 7) > fade) continue
            const a = hash2(i, 3) * Math.PI * 2
            const r = (1 - ((q0 * 1.6 + hash2(i, 5)) % 1)) * 110
            dst.set(R(cx + Math.cos(a) * r), R(cy + Math.sin(a) * r * 0.7), i % 3 ? C.pink : C.white)
        }
    }
    // the roar, off its head
    const hx = x + dir * 64 * sz
    const hy = y - 96 * sz
    for (let k = 0; k < 3; k++) {
        const t0 = RAMPAGE_ROAR + k * 0.16
        shockRing(dst, hx, hy, t, t0, 0.4, 6, 50 + k * 8, k & 1 ? C.white : C.pink)
        shockRing(dst, hx, hy, t, t0, 0.4, 5, 49 + k * 8, k & 1 ? C.pink : C.white)
    }
    // the roar's force: streaks bursting off its head
    const rr = (q0 - RAMPAGE_ROAR) / (RAMPAGE_SLAM - RAMPAGE_ROAR)
    if (rr > 0 && rr < 1) {
        for (let i = 0; i < 12; i++) {
            const a = -Math.PI * 0.85 + i / 11 * Math.PI * 0.95
            const d0 = 16 + ((rr * 3 + hash2(i, 29)) % 1) * 40
            const ax = Math.cos(a) * dir
            const ay = Math.sin(a)
            line(dst, R(hx + ax * d0), R(hy + ay * d0), R(hx + ax * (d0 + 8)), R(hy + ay * (d0 + 8)), i & 1 ? C.white : C.pink)
        }
    }
    // the slam
    const g = x + dir * 26 * sz
    shockRing(dst, g, y - 1, t, RAMPAGE_SLAM, 0.6, 12, 150, C.white, true)
    shockRing(dst, g, y - 1, t, RAMPAGE_SLAM + 0.08, 0.55, 8, 110, C.pink, true)
    debris(dst, g - dir * 20, y - 2, y, t, RAMPAGE_SLAM, 16, 150, 'dust', 71 + tier, 0.9)
    debris(dst, g + dir * 20, y - 2, y, t, RAMPAGE_SLAM, 16, 150, 'dust', 81 + tier, 0.9)
    debris(dst, g, y - 4, y, t, RAMPAGE_SLAM, 12, 120, 'arcane', 91 + tier, 0.8)
    const e = (q0 - RAMPAGE_SLAM) / 0.7
    if (e > 0 && e < 1) {
        const grow = sm(Math.min(1, e / 0.2))
        const sink = e > 0.6 ? 1 - (e - 0.6) / 0.4 : 1
        // shards of crystal breaking out of the ground all along the shockwave's first reach
        for (let i = 0; i < 11; i++) {
            const dx = (i - 5) * 17 * sz + (hash2(i, 13) - 0.5) * 8
            const h = R((16 + hash2(i, 17) * 20) * sz * grow * sink * (1 - Math.abs(i - 5) * 0.06))
            if (h > 1) spike(dst, R(g + dx), R(y + 3 + (i & 1) * 3), h, 6, R((i - 5) * 1.6), C.purple0, C.pink, C.white)
        }
        // dust rolling out both ways, thinning
        const level = Math.max(1, R(14 * (1 - e)))
        for (const side of [-1, 1]) {
            for (let k = 0; k < 4; k++) {
                const cx0 = R(g + side * (30 + e * (70 + k * 22)))
                const cy0 = R(y - 5 - k * 3 - e * 10)
                const r0 = 7 + e * 12 + k * 2
                for (let yy = -R(r0); yy <= R(r0); yy++) for (let xx = -R(r0); xx <= R(r0); xx++) {
                    if (xx * xx + yy * yy * 2.2 > r0 * r0) continue
                    if (!bayer(cx0 + xx, cy0 + yy, level)) continue
                    dst.set(cx0 + xx, cy0 + yy, yy < -r0 * 0.25 ? C.bone1 : C.bone0)
                }
            }
        }
        // the new level's ring, blazing as it comes in
        if (e < 0.4) {
            const rx = 62 + (tier + 1) * 10
            for (let a = 0; a < Math.PI * 2; a += 0.03) {
                dst.set(x + R(Math.cos(a) * rx), y - 2 + R(Math.sin(a) * rx * 0.1), C.white)
                dst.set(x + R(Math.cos(a) * rx), y - 1 + R(Math.sin(a) * rx * 0.1), C.pink)
            }
        }
    }
}

/**
 * Rolling Crash: it crouches and springs, curling into a ball, somersaults forward and slams its
 * armoured back down onto the three nearest, bounces off, and rolls on round to land on its feet.
 */
function rollingCrash(tier: number): BossSpecial {
    const sz = tierSize(tier)
    const sp0: BossSpecial = {
        name: 'Rolling Crash', tint: 'night1', hits: [ROLL_HIT + 0.01, ROLL_HIT + 0.03, ROLL_HIT + 0.05], spread: true,
        fx(s, t, st) {
            const d = st.dir
            const u = sq(t)
            const r = rollAt(u, sz)
            // the ball's middle in the scene
            const cx = st.bx + d * (pivotX(sz) + r.dx)
            const cy = st.by + pivotY(sz) + r.dy
            // it springs off the ground, and lands on it again
            for (const [t0, seed] of [[ROLL_LEAP, 11], [ROLL_LAND, 13]] as const) {
                debris(s, st.bx - d * 20, st.by - 1, st.by, t, t0, 10, 80, 'dust', seed, 0.6)
                debris(s, st.bx + d * 30, st.by - 1, st.by, t, t0, 10, 80, 'dust', seed + 1, 0.6)
                shockRing(s, st.bx + d * 6, st.by, t, t0, 0.4, 10, 80, C.bone0, true)
            }
            // the spin: arcs of crystal light trailing round the ball while it is in the air
            if (r.air > 0.5 && (u < ROLL_HIT - 0.02 || u > ROLL_OFF)) {
                const rr = 52 * sz
                for (let k = 0; k < 3; k++) {
                    const lead = r.ang + k * Math.PI * 2 / 3
                    for (let i = 0; i < 24; i++) {
                        const a = lead - i * 0.04
                        const c = i < 3 ? C.white : i < 10 ? C.pink : i < 17 ? C.purple2 : C.purple1
                        if (i >= 17 && (i & 1)) continue
                        for (const w of [0, 3]) s.set(R(cx + d * Math.cos(a) * (rr - w)), R(cy + Math.sin(a) * (rr - w)), c)
                    }
                }
            }
            // the crash: where its back comes down on them, a burst of crystal and a ring along the ground
            if (u >= ROLL_HIT - 0.02) {
                const r0 = rollAt(ROLL_HIT, sz)
                const kx = st.bx + d * (pivotX(sz) + r0.dx + backR(sz) * Math.SQRT1_2)
                const ky = st.by + pivotY(sz) + r0.dy + backR(sz) * Math.SQRT1_2
                blast(s, kx, ky, t, ROLL_HIT, 20, 0.5, VOID6, 71, 'arcane')
                shockRing(s, kx, st.by, t, ROLL_HIT, 0.5, 8, 90, C.white, true)
                shockRing(s, kx, st.by, t, ROLL_HIT + 0.06, 0.45, 6, 70, C.pink, true)
                debris(s, kx, ky, st.by, t, ROLL_HIT, 18, 160, 'arcane', 73, 0.9)
                debris(s, kx, st.by - 1, st.by, t, ROLL_HIT, 14, 110, 'dust', 75, 0.8)
            }
            for (let i = 0; i < sp0.hits.length; i++) {
                const pt = hitTarget(st, i, true)
                blast(s, pt.x, chest(pt), t, sp0.hits[i]!, 11, 0.45, VOID6, 81 + i, 'arcane')
            }
        }
    }
    return sp0
}

/**
 * Shard Storm: it arches its hump while its mane fills with light, then bucks, and the mane's
 * crystals fly up high over the party and rain down on them, walking the line; more each tier. They
 * stick in the ground where they land and sink away.
 */
function shardStorm(tier: number): BossSpecial {
    const sz = tierSize(tier)
    // one wave per tier, each a crystal at every one of the party
    const n = STORM_PER_WAVE * (tier + 1)
    const launch = (i: number): number => STORM_BUCK + 0.02 + Math.floor(i / STORM_PER_WAVE) * STORM_WAVE + (i % STORM_PER_WAVE) * STORM_STAGGER
    const sp0: BossSpecial = {
        name: 'Shard Storm', tint: 'night1', spread: true,
        hits: Array.from({ length: n }, (_, i) => launch(i) + STORM_FLIGHT),
        fx(s, t, st) {
            const d = st.dir
            const u = sq(t)
            const W = (dx: number, dy: number): [number, number] => [st.bx + d * (dx * sz - 6), st.by + dy * sz]
            // light drawn in to the mane from all round as it gathers
            const [mx, my] = W(4, -112)
            const g = sp(u, 0.05, STORM_BUCK)
            if (g > 0 && g < 1) {
                for (let i = 0; i < 22; i++) {
                    const a = hash2(i, 41) * Math.PI * 2
                    const r = (1 - ((g * 1.8 + hash2(i, 43)) % 1)) * 70
                    s.set(R(mx + Math.cos(a) * r * 1.3), R(my + Math.sin(a) * r * 0.6), i % 3 ? C.pink : C.white)
                }
            }
            // each buck throws light up off its back
            const w = Math.max(0, Math.min(tier, Math.floor((u - STORM_BUCK) / STORM_WAVE)))
            const b = sp(u, STORM_BUCK + w * STORM_WAVE, STORM_BUCK + w * STORM_WAVE + 0.25)
            if (b > 0 && b < 1) {
                for (let i = 0; i < 9; i++) {
                    const [rx, ry] = W(-30 + i * 7.5, -(104 + Math.sin(i / 8 * Math.PI) * 18))
                    const r0 = b * 30
                    line(s, rx, ry - r0, rx, ry - r0 - 8 * (1 - b), i & 1 ? C.white : C.pink)
                }
            }
            for (let i = 0; i < n; i++) {
                const t0 = launch(i)
                const t1 = t0 + STORM_FLIGHT
                const pt = hitTarget(st, i, true)
                // off the mane, spread along its back, straight up and out of sight
                const v = hash2(i, 47)
                const [ox, oy] = W(-30 + v * 60, -(100 + Math.sin(v * Math.PI) * 22))
                const ex = pt.x + (hash2(i, 53) - 0.5) * 10
                const ey = pt.y - 3
                const up = sp(u, t0, t0 + STORM_UP)
                if (up > 0 && up < 1) {
                    const lean = (hash2(i, 59) - 0.5) * 12
                    const was = Math.max(0, up - 0.2)
                    shard(s, ox + lean * up, oy - (oy + 20) * up, ox + lean * was, oy - (oy + 20) * was, 5 + tier)
                }
                // then down out of the sky onto them, steep, slanting in from behind them
                const dn = sp(u, t1 - STORM_FALL, t1)
                if (dn > 0 && dn < 1) {
                    const sx = ex + d * 28
                    const sy = -12
                    const k = dn * dn
                    const k0 = Math.max(0, dn - 0.25) ** 2
                    shard(s, sx + (ex - sx) * k, sy + (ey - sy) * k, sx + (ex - sx) * k0, sy + (ey - sy) * k0, 7 + tier)
                }
                // where it lands: a blast over them, and the crystal stuck in the ground, sinking away
                blast(s, ex, ey - 6, t, t1, 9, 0.4, VOID6, 61 + i, 'arcane')
                const stuck = sp(u, t1, t1 + 0.1) * (1 - sp(u, t1 + 0.5, t1 + 0.9))
                if (stuck > 0) spike(s, R(ex), R(pt.y + 1), R((8 + tier) * stuck), 2, R((hash2(i, 61) - 0.5) * 4), C.purple1, C.pink, C.white)
            }
        }
    }
    return sp0
}

/** A thrown crystal at (x, y), come from (bx, by): a streak behind it, then the crystal pointing the way it flies. */
function shard(s: S, x: number, y: number, bx: number, by: number, len: number): void {
    line(s, bx, by, x, y, C.purple1)
    const a = Math.atan2(y - by, x - bx)
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    line(s, x - ca * len * 1.6, y - sa * len * 1.6, x - ca * len, y - sa * len, C.purple2)
    tri(s, x - ca * len - sa * 2, y - sa * len + ca * 2, x - ca * len + sa * 2, y - sa * len - ca * 2, x + ca * 2, y + sa * 2, C.pink)
    line(s, x - ca * len, y - sa * len, x + ca, y + sa, C.white)
}

function rampantDef(tier: number): CreatureDef {
    const def: CreatureDef = {
        // room for the Rolling Crash, which carries the ball well out in front of it
        name: `The Rampant — rampage ${tier + 1}`, size: 256, room: 34, shadow: 64, accent: C.pink,
        states: {
            idle: { dur: 1.2, loop: true }, attack: { dur: 1.2, loop: false }, hit: { dur: 0.5, loop: false },
            escalate: { dur: ESC_DUR, loop: false },
            special: { dur: ROLL_DUR, loop: false }, special2: { dur: stormDur(tier), loop: false }
        },
        specials: [rollingCrash(tier), shardStorm(tier)],
        draw: (s, st, t) => rampantDraw(tier, s, st, t, def),
        fx(dst, st, t, x, y, dir) {
            // the aura ring IS the level read — no HP bar exists for this boss
            const up = st === 'escalate' ? escUp(t) : 0
            const lv = tier + Math.min(1, up)
            const k = fr(t, 10, 4)
            for (let r = 0; r <= Math.floor(lv); r++) {
                const rx = 62 + r * 10 + (k & 1)
                for (let a = 0; a < Math.PI * 2; a += 0.06) {
                    const px2 = x + R(Math.cos(a) * rx)
                    const py2 = y - 2 + R(Math.sin(a) * rx * 0.1)
                    if (((a * 20) | 0) % (4 - Math.min(3, r)) === 0) dst.set(px2, py2, r >= 3 ? C.white : r >= 2 ? C.pink : C.purple2)
                }
            }
            if (st === 'escalate') escalationFx(dst, t, x, y, dir, 0.8 + (tier + up) * 0.06, tier)
            if (st === 'attack' && B.strike) for (let i = 0; i < 14; i++) dst.set(x + dir * (76 + i * 2), y - 2 - (i % 5), i & 1 ? C.pink : C.purple2)
        }
    }
    return def
}

export const RAMPANT = Array.from({ length: RAMPAGE_TIERS }, (_, i) => rampantDef(i))
