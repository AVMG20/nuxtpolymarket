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
import type { CreatureDef } from './creature'
import { CF, fr } from './creature'
import type { Surface } from './surface'
import { B, ENTRY_SETTLED, bossStates, drive, finish, Entry, shift, bz, elbow, P, px, line, disc, ellipse, poly, taper, q, sm, hash2 } from './boss-kit'
import { mask, vol, eachPx, selOut, rot, T, type Mat5 } from './raid-kit'

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
 * The Apprentice: a hulking olive ogre, pot-bellied, stubby-legged in trousers and clogs, arms like
 * barrels, a small underbitten head with two tusks under a cloth cap, a scorched leather apron with
 * burn holes and a pocket of tools. His sledgehammer is too big even for him: at rest its head
 * leans on the ground in front of him; he hauls it up behind his head and slams it down on the party.
 * He stomps in.
 */
export const FORGE_APPRENTICE: CreatureDef = {
    name: 'The Apprentice', size: 256, room: 24, shadow: 40, accent: C.orange,
    states: bossStates(1.7, 2.0, 2.4),
    draw(s, st, t) {
        drive(this, st, t, 18, 2.0)
        const tt = q(t)
        const x = s.ax - 10 + B.lunge - B.kb
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
        const at = (lx: number, ly: number): [number, number] => { rot(x + lx, y + ly + bob, x - 14, y, tilt); return [T.x, T.y] }
        // the upper body sways further than the hips: a lean on top of the tilt
        const lean = bz(0, -6, 10)
        const up = (lx: number, ly: number): [number, number] => at(lx + lean * Math.max(0, -ly - 50) / 50, ly + br)

        // the hammer's grip and angle: resting on its head in front of him, hauled up behind his
        // head, slammed down on the party
        const gx = bz(30, -2, 46)
        const gy = bz(-62, -112, -52)
        const ga = bz(0.95, -2.3, 0.62)
        const [Gx, Gy] = up(gx, gy)
        const ca = Math.cos(ga + tilt)
        const sa = Math.sin(ga + tilt)
        const Fx = Gx - ca * 16
        const Fy = Gy - sa * 16

        // ── his far arm, reaching for the haft behind his near hand ──
        {
            const [sx, sy] = up(-18, -90)
            elbow(sx, sy, Fx, Fy, 27, 27, 1)
            limb(s, 'farm', [sx, sy, P.x, P.y, Fx, Fy], [18, 14, 12], OGRE, -0.3, C.ink)
            const gm = mask(s, 'fglove')
            disc(gm, Fx, Fy, 6.5, 1)
            vol(s, gm, LEATHER, 5, -0.3)
        }

        // ── legs, in trousers, clogs on his feet ──
        const leg = (hx: number, fx: number, far: boolean, phase: number): void => {
            const lift = stride >= 0 ? Math.max(0, Math.sin((stride + phase) * Math.PI * 2)) * 7 : 0
            const swing = stride >= 0 ? Math.sin((stride + phase) * Math.PI * 2) * 8 : 0
            const [a, b] = at(hx, -46)
            const [f, g] = at(fx + swing, -7 - lift)
            elbow(a, b, f, g, 22, 20, -1)
            limb(s, far ? 'fleg' : 'nleg', [a, b, P.x, P.y, f, g], [22, 18, 15], CLOTH, far ? -0.3 : 0, C.ink)
            // the clog
            const cm = mask(s, 'clog')
            ellipse(cm, f + 5, g + 3, 12, 5.5, 1)
            vol(s, cm, LEATHER, 5, far ? -0.3 : 0)
            selOut(s, cm, C.ink)
            line(s, f - 6, g + 7, f + 16, g + 7, far ? C.ink : C.brown0)
        }
        leg(-8, -10, true, 0.5)
        leg(6, 10, false, 0)

        // ── the body: a great belly, a barrel chest, a hump of shoulder ──
        const body = mask(s, 'body')
        {
            const [bx, by] = up(4, -62)
            ellipse(body, bx, by, 30, 26, 1)
            const [cx, cy] = up(-2, -88)
            ellipse(body, cx, cy, 28, 18, 1)
            const [hx, hy] = up(-6, -96)
            disc(body, hx, hy, 16, 1)
            vol(s, body, OGRE, 20)
            // soot smudged over his chest
            eachPx(body, (px_, py) => { if (hash2(px_, py) < 0.05 && py < by - 18) s.set(px_, py, C.olive0) })
            selOut(s, body, C.ink)
        }
        // the apron: scorched leather over the belly, burn holes, a pocket of tools, straps up over him
        {
            // one piece from his chest over the belly to his knees
            const pts = [[-10, -84], [20, -86], [31, -62], [34, -40], [30, -24], [2, -22], [-6, -40], [-12, -58]].flatMap(([a, b]) => up(a!, b!))
            const am = mask(s, 'apron')
            poly(am, pts, 0, 0, 1)
            vol(s, am, LEATHER, 10, 0.05)
            selOut(s, am, C.brown0)
            // scorch and burn holes, each rimmed with the glow still in it
            for (const [bx, by] of [[18, -48], [6, -40], [24, -70]] as const) {
                const [a, b] = up(bx, by)
                disc(s, a, b, 2, C.ink)
                px(s, a - 2, b, C.orange); px(s, a + 1, b - 2, C.lava1)
            }
            eachPx(am, (px_, py) => { if (hash2(px_, py) < 0.03) s.set(px_, py, C.brown0) })
            // the pocket, a wrench and a pair of tongs in it
            const [p0x, p0y] = up(8, -54)
            const pm = mask(s, 'pocket')
            poly(pm, [p0x - 8, p0y, p0x + 8, p0y - 1, p0x + 7, p0y + 10, p0x - 7, p0y + 10], 0, 0, 1)
            vol(s, pm, LEATHER, 4, -0.1)
            line(s, p0x - 8, p0y, p0x + 8, p0y - 1, C.brown3)
            line(s, p0x - 3, p0y, p0x - 5, p0y - 9, C.steel2, 2)
            disc(s, p0x - 5, p0y - 10, 2, C.steel2); px(s, p0x - 5, p0y - 10, C.steel0)
            line(s, p0x + 3, p0y, p0x + 5, p0y - 8, C.steel1)
            line(s, p0x + 4, p0y, p0x + 7, p0y - 7, C.steel1)
            // the straps up over his shoulders
            const [s0x, s0y] = up(-12, -84)
            const [s1x, s1y] = up(-8, -104)
            line(s, s0x, s0y, s1x, s1y, C.brown1, 3)
            const [s2x, s2y] = up(20, -86)
            const [s3x, s3y] = up(14, -104)
            line(s, s2x, s2y, s3x, s3y, C.brown1, 3)
            px(s, s2x, s2y - 1, C.steel2)
        }

        // ── his head: small for him, heavy-jawed, two tusks, a big nose, a tuft under a cloth cap ──
        {
            const hx = 32
            const hy = -102 + R(bz(0, -3, 4))
            const [cx, cy] = up(hx, hy)
            const open = st === 'attack' ? Math.max(B.strike ? 1 : 0, B.rec * 0.6) : B.roar ? 1 : 0
            // the jaw, jutting
            const jm = mask(s, 'jaw')
            const [jx, jy] = up(hx + 5, hy + 8 + open * 3)
            ellipse(jm, jx, jy, 11, 7, 1)
            vol(s, jm, OGRE, 6, -0.05)
            selOut(s, jm, C.ink)
            // the skull
            const m = mask(s, 'head')
            disc(m, cx, cy, 15, 1)
            ellipse(m, cx + 3, cy + 3, 14, 11, 1)
            vol(s, m, OGRE, 10, 0.05)
            selOut(s, m, C.ink)
            // the ear
            disc(s, cx - 10, cy + 1, 3.5, C.olive1); px(s, cx - 10, cy + 1, C.olive0)
            // the mouth: a gap between jaw and skull, open on the swing and the bellow
            const [mx, my] = up(hx + 8, hy + 5)
            line(s, mx - 6, my, mx + 7, my - 1 + open, C.ink, 1 + R(open * 2))
            if (open > 0.5) line(s, mx - 4, my + 1, mx + 5, my + 1, C.red1)
            // tusks jutting up from the underbite
            for (const [tx, h] of [[hx + 4, 6], [hx + 12, 5]] as const) {
                const [ax, ay] = up(tx, hy + 7 + open * 3)
                poly(s, [ax - 1.5, ay, ax + 1.5, ay, ax + 0.5, ay - h], 0, 0, C.bone1)
                px(s, ax + 0.5, ay - h, C.white)
            }
            // the nose, a knob; a heavy brow and a small eye under it
            const [nx, ny] = up(hx + 13, hy - 1)
            disc(s, nx, ny, 4, C.olive2); px(s, nx - 1, ny - 2, C.bone1); px(s, nx + 2, ny + 2, C.olive0)
            const [ex, ey] = up(hx + 6, hy - 4)
            line(s, ex - 4, ey - 3, ex + 4, ey - 2, C.olive0, 2)
            px(s, ex, ey, C.ink); px(s, ex + 1, ey, B.hurt ? C.white : C.bone1)
            // soot smudged on his cheek
            for (let i = 0; i < 6; i++) px(s, cx - 2 + (i % 3) * 2, cy + 3 + (i >> 1), C.olive0)
            // the cap: a slouched cloth cap on the back of his head, a tuft of hair out from under it
            const [c0x, c0y] = up(hx - 12, hy - 8)
            const capm = mask(s, 'cap')
            poly(capm, [c0x, c0y + 2, c0x + 6, c0y - 10, c0x + 18, c0y - 9, c0x + 20, c0y - 3, c0x + 10, c0y + 1], 0, 0, 1)
            vol(s, capm, { ramp: [C.red0, C.red1, C.red2, C.red3], hi: C.red3, rim: C.red0 }, 5)
            selOut(s, capm, C.ink)
            for (let i = 0; i < 4; i++) line(s, c0x + 16 + i, c0y - 2, c0x + 19 + i * 1.5, c0y + 3, i & 1 ? C.brown2 : C.brown1)
        }

        // ── the sledgehammer: a long haft, iron-banded, a dented iron head too big for it ──
        {
            const bx = Gx - ca * 30
            const by = Gy - sa * 30
            const hx = Gx + ca * 56
            const hy = Gy + sa * 56
            const hm = mask(s, 'haft')
            taper(hm, bx, by, hx, hy, 6, 5, 1)
            vol(s, hm, WOOD, 3)
            selOut(s, hm, C.brown0)
            for (const k of [-24, 20, 44]) { const cx = Gx + ca * k; const cy = Gy + sa * k; line(s, cx - sa * 3, cy + ca * 3, cx + sa * 3, cy - ca * 3, C.steel1, 2) }
            // the head: a block set across the haft
            const nx = -sa
            const ny = ca
            const hw = 15
            const hl = 9
            const im = mask(s, 'hhead')
            poly(im, [hx + nx * hw - ca * hl, hy + ny * hw - sa * hl, hx + nx * hw + ca * hl, hy + ny * hw + sa * hl, hx - nx * hw + ca * hl, hy - ny * hw + sa * hl, hx - nx * hw - ca * hl, hy - ny * hw - sa * hl], 0, 0, 1)
            vol(s, im, IRON, 8)
            selOut(s, im, C.steel0)
            // its striking faces, battered, and a dent
            for (const d of [-1, 1]) line(s, hx + nx * hw * d - ca * hl, hy + ny * hw * d - sa * hl, hx + nx * hw * d + ca * hl, hy + ny * hw * d + sa * hl, d > 0 ? C.steel3 : C.steel0, 2)
            disc(s, hx + nx * 4 + ca * 2, hy + ny * 4 + sa * 2, 2, C.steel1)
            px(s, hx - nx * 6, hy - ny * 6, C.steel3)
        }

        // ── his near arm over the haft, the glove closed on it ──
        {
            const [sx, sy] = up(4, -88)
            elbow(sx, sy, Gx, Gy, 28, 28, 1)
            limb(s, 'narm', [sx, sy, P.x, P.y, Gx, Gy], [21, 17, 14], OGRE, 0, C.ink)
            // the heavy work glove and its cuff
            const gm = mask(s, 'glove')
            disc(gm, Gx, Gy, 7.5, 1)
            const cx = P.x + (Gx - P.x) * 0.7
            const cy = P.y + (Gy - P.y) * 0.7
            disc(gm, cx, cy, 7, 1)
            vol(s, gm, LEATHER, 6)
            selOut(s, gm, C.ink)
            line(s, cx - 5, cy - 3, cx + 4, cy + 4, C.brown3)
        }

        if (off) shift(s, off, 0, s.h)
        B.ent = 1
        finish(s, Entry.Walk, 18)
        void fr
    },
    fx(dst, st, t, x, y, dir) {
        // the slam: stone and sparks thrown up where the hammer lands
        if (st === 'attack' && B.strike) {
            const gx = x + dir * 96
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
/** Seconds into its entrance at which it lands, and how far above it falls from. */
const JM_LAND = 0.6
const JM_FALL = 240

/** A cog at (x, y), `r` across, turned `a`: a brass wheel, its teeth round it, a steel hub. */
function cog(s: Surface, x: number, y: number, r: number, a: number, far: boolean): void {
    const m = mask(s, 'cog')
    disc(m, x, y, r, 1)
    for (let i = 0; i < 8; i++) {
        const b = a + i / 8 * Math.PI * 2
        disc(m, x + Math.cos(b) * r, y + Math.sin(b) * r, Math.max(1.5, r * 0.28), 1)
    }
    vol(s, m, BRASS, 4, far ? -0.3 : 0)
    selOut(s, m, C.gold0)
    disc(s, x, y, r * 0.42, far ? C.steel0 : C.steel1)
    px(s, x - 1, y - 1, C.steel3)
}

/**
 * The Journeyman: a clockwork automaton the forge built, a riveted brass boiler on piston legs with
 * cogs for knees, a furnace door glowing through its grate, a pressure gauge whose needle trembles,
 * a smokestack at its back, a domed head with one great lens for an eye. Its far arm ends in tongs;
 * its near arm is its hammer, a piston that cocks back and fires out at the party. It drops in from
 * above, lands in a crouch with a burst of steam, and powers up its eye.
 */
export const FORGE_JOURNEYMAN: CreatureDef = {
    name: 'The Journeyman', size: 256, room: 24, shadow: 34, accent: C.orange,
    states: bossStates(1.4, 1.6, 2.2),
    draw(s, st, t) {
        drive(this, st, t, 12, 1.6)
        const tt = q(t)
        const x = s.ax - 8 + B.lunge - B.kb
        const y = s.ay
        // dropping in: nothing but a growing shadow, then a fall, then the crouch of the landing
        let drop = 0
        let crouch = 0
        let power = 1
        if (st === 'entry') {
            if (tt < JM_LAND) {
                const k = Math.max(0, (tt - 0.1) / (JM_LAND - 0.1))
                drop = -R((1 - k * k) * JM_FALL)
                CF.shadow = 0.1 + 0.9 * k * k
            } else {
                const a = tt - JM_LAND
                crouch = 12 * Math.exp(-5 * a) * Math.cos(a * Math.PI * 3)
            }
            // its eye comes up as it settles
            power = Math.min(1, Math.max(0.15, (tt - JM_LAND - 0.3) / 0.6))
        }
        if (st === 'death') { crouch = B.die * 22; power = 1 - B.die }
        const tilt = bz(0, -0.05, 0.1) + B.die * 0.5
        const at = (lx: number, ly: number): [number, number] => { rot(x + lx, y + ly, x, y, tilt); return [T.x, T.y] }
        // everything above the hips rides the crouch
        const up = (lx: number, ly: number): [number, number] => at(lx, ly + crouch + B.breath * 0.5)
        const hot = B.glow > 0.5 || tt % 0.4 < 0.2 ? C.gold3 : C.orange

        // ── the far arm, its tongs ──
        {
            const [sx, sy] = up(-14, -92)
            const [hx, hy] = up(bz(16, 4, 26), bz(-60, -72, -64))
            elbow(sx, sy, hx, hy, 22, 22, 1)
            limb(s, 'jfarm', [sx, sy, P.x, P.y, hx, hy], [11, 9, 8], IRON, -0.3, C.ink)
            cog(s, P.x, P.y, 5, tt * 3, true)
            for (const d of [-1, 1]) line(s, hx, hy, hx + 12, hy + d * 4 - 2, C.steel1, 2)
            line(s, hx + 12, hy - 6, hx + 16, hy - 3, C.steel1, 2)
            line(s, hx + 12, hy + 2, hx + 16, hy - 1, C.steel1, 2)
        }

        // ── piston legs, cogs for knees, iron plates for feet ──
        const leg = (hx: number, fx: number, far: boolean): void => {
            const [a, b] = up(hx, -50)
            const [f, g] = at(fx, -8)
            elbow(a, b, f, g, 24, 24, -1)
            const kx = P.x
            const ky = P.y
            limb(s, far ? 'jfl' : 'jnl', [a, b, kx, ky, f, g], [15, 12, 11], IRON, far ? -0.3 : 0, C.ink)
            // the piston riding up the back of the leg
            line(s, a - 5, b + 4, f - 6, g - 4, far ? C.steel0 : C.steel3)
            line(s, a - 4, b + 5, f - 5, g - 3, far ? C.ink : C.steel1)
            cog(s, kx, ky, 7, tt * (far ? -2 : 2), far)
            const fm = mask(s, 'foot')
            poly(fm, [f - 7, g - 3, f + 14, g - 3, f + 17, g + 7, f - 9, g + 7], 0, 0, 1)
            vol(s, fm, IRON, 4, far ? -0.3 : 0)
            selOut(s, fm, C.ink)
            for (const k of [-4, 4, 12]) px(s, f + k, g + 1, far ? C.steel1 : C.steel3)
        }
        leg(-8, -8, true)
        leg(6, 10, false)

        // ── the boiler: a riveted brass barrel, a furnace door glowing through its grate, a gauge ──
        {
            // the smokestack at its back
            const [s0x, s0y] = up(-16, -100)
            const [s1x, s1y] = up(-20, -128)
            const sm0 = mask(s, 'stack')
            taper(sm0, s0x, s0y, s1x, s1y, 8, 8, 1)
            vol(s, sm0, IRON, 4, -0.1)
            selOut(s, sm0, C.ink)
            line(s, s1x - 5, s1y, s1x + 5, s1y, C.steel2, 2)
            const m = mask(s, 'boiler')
            const pts: number[] = []
            for (let i = 0; i <= 12; i++) { const a = Math.PI + i / 12 * Math.PI; pts.push(...up(Math.cos(a) * 24, -104 + Math.sin(a) * 8)) }
            for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI; pts.push(...up(Math.cos(a) * 24, -58 + Math.sin(a) * 8)) }
            poly(m, pts, 0, 0, 1)
            vol(s, m, BRASS, 16)
            selOut(s, m, C.gold0)
            // riveted bands round it
            for (const by of [-98, -66]) {
                for (let k = -24; k <= 24; k++) {
                    const [a, b] = up(k, by + Math.sqrt(Math.max(0, 1 - (k / 24) * (k / 24))) * 5)
                    s.set(R(a), R(b), C.gold0)
                    if (k % 6 === 0) s.set(R(a), R(b) - 1, C.gold3)
                }
            }
            // the furnace door: an iron frame, a grate over the fire, flickering
            const [d0x, d0y] = up(-17, -78)
            const dm = mask(s, 'door')
            poly(dm, [d0x, d0y, d0x + 16, d0y - 1, d0x + 16, d0y + 16, d0x, d0y + 16], 0, 0, 1)
            vol(s, dm, IRON, 3)
            poly(s, [d0x + 2, d0y + 2, d0x + 14, d0y + 1, d0x + 14, d0y + 14, d0x + 2, d0y + 14], 0, 0, C.lava0)
            for (let k = 0; k < 4; k++) {
                const fx = d0x + 3 + k * 3
                line(s, fx, d0y + 13, fx, d0y + 13 - R((4 + ((k * 5 + R(tt * 12)) % 5)) * power), k & 1 ? C.orange : hot)
            }
            for (let k = 0; k < 4; k++) line(s, d0x + 4 + k * 3, d0y + 2, d0x + 4 + k * 3, d0y + 14, C.steel0)
            // the pressure gauge, its needle trembling
            const [gx, gy] = up(-10, -94)
            disc(s, gx, gy, 5.5, C.steel1)
            disc(s, gx, gy, 4.5, C.bone1)
            const na = -2.2 + (B.glow > 0.5 ? 2.6 : 1.2) + Math.sin(tt * 20) * 0.15
            line(s, gx, gy, gx + Math.cos(na) * 4, gy + Math.sin(na) * 4, C.red2)
            px(s, gx, gy, C.ink)
        }

        // ── its head: a brass dome, one great lens for an eye, a grille under it ──
        {
            const hy = -112 + R(bz(0, -2, 2))
            const [hx, hy2] = up(8, hy)
            const m = mask(s, 'jhead')
            disc(m, hx, hy2, 12, 1)
            poly(m, [hx - 12, hy2, hx + 12, hy2, hx + 11, hy2 + 8, hx - 11, hy2 + 8], 0, 0, 1)
            vol(s, m, BRASS, 8)
            selOut(s, m, C.gold0)
            for (let k = -3; k <= 3; k++) px(s, hx + k * 3, hy2 - 10 + Math.abs(k) * 0.6, C.gold3)
            // the lens: a steel ring, the glass glowing with the fire in it
            const [ex, ey] = up(15, hy - 1)
            disc(s, ex, ey, 7, C.steel0)
            disc(s, ex, ey, 6, C.steel2)
            const lens = B.hurt ? C.white : power < 0.3 ? C.lava0 : B.glow > 0.4 ? C.gold3 : power < 0.7 ? C.lava1 : C.orange
            disc(s, ex, ey, 4.5, lens)
            disc(s, ex + 0.5, ey + 0.5, 2.5, power > 0.7 ? C.gold3 : C.lava1)
            px(s, ex - 2, ey - 2, C.white)
            // the grille
            for (let k = 0; k < 3; k++) line(s, hx + 6 + k * 3, hy2 + 4, hx + 6 + k * 3, hy2 + 7, C.gold0)
        }

        // ── its hammer arm: a piston that cocks back and fires ──
        {
            const [sx, sy] = up(14, -92)
            const [wx, wy] = up(bz(30, 4, 44), bz(-66, -82, -76))
            elbow(sx, sy, wx, wy, 22, 20, 1)
            const ex = P.x
            const ey = P.y
            limb(s, 'jupper', [sx, sy, ex, ey], [13, 11], IRON, 0, C.ink)
            // the forearm: a brass cylinder
            const fm = mask(s, 'jfore')
            taper(fm, ex, ey, wx, wy, 14, 14, 1)
            disc(fm, wx, wy, 7, 1)
            vol(s, fm, IRON, 6)
            selOut(s, fm, C.steel0)
            // brass bands round the cylinder
            for (const k of [0.3, 0.75]) { const bx = ex + (wx - ex) * k; const by = ey + (wy - ey) * k; const l2 = Math.hypot(wx - ex, wy - ey) || 1; const nx2 = -(wy - ey) / l2; const ny2 = (wx - ex) / l2; line(s, bx + nx2 * 7, by + ny2 * 7, bx - nx2 * 7, by - ny2 * 7, C.gold2, 2) }
            // the rod shooting out of it, and the ram on its end
            const dx = wx - ex
            const dy = wy - ey
            const l = Math.hypot(dx, dy) || 1
            const ux = dx / l
            const uy = dy / l
            const ext = bz(4, 0, 30)
            const rx = wx + ux * ext
            const ry = wy + uy * ext
            if (ext > 2) { line(s, wx, wy, rx, ry, C.steel3, 4); line(s, wx, wy + 1, rx, ry + 1, C.steel1) }
            const rm = mask(s, 'ram')
            const nx = -uy
            const ny = ux
            poly(rm, [rx + nx * 10, ry + ny * 10, rx + nx * 10 + ux * 11, ry + ny * 10 + uy * 11, rx - nx * 10 + ux * 11, ry - ny * 10 + uy * 11, rx - nx * 10, ry - ny * 10], 0, 0, 1)
            vol(s, rm, IRON, 5)
            selOut(s, rm, C.steel0)
            line(s, rx + nx * 10 + ux * 11, ry + ny * 10 + uy * 11, rx - nx * 10 + ux * 11, ry - ny * 10 + uy * 11, C.steel3, 2)
            for (const d of [-6, 6]) px(s, rx + nx * d + ux * 4, ry + ny * d + uy * 4, C.steel3)
            cog(s, sx, sy, 9, -tt * 2, false)
            cog(s, ex, ey, 6, tt * 3, false)
        }

        if (drop) shift(s, 0, drop, s.h)
        B.ent = 1
        finish(s, Entry.Drop, 14)
    },
    fx(dst, st, t, x, y, dir) {
        const tt = q(t)
        // smoke from its stack, rising and spreading, once it has landed
        if (st !== 'entry' || tt >= JM_LAND) for (let i = 0; i < 6; i++) {
            const u = (tt * 0.6 + i / 6) % 1
            const sx = x - dir * (20 - u * 6) + R(Math.sin(u * 6 + i) * 3 * u)
            const sy = y - 130 - u * 36
            const r = 2 + u * 6
            const level = Math.max(2, R(12 * (1 - u)))
            for (let yy = -R(r); yy <= R(r); yy++) {
                for (let xx = -R(r); xx <= R(r); xx++) {
                    if (xx * xx + yy * yy > r * r || ((R(sx) + xx) * 3 + (R(sy) + yy) * 7) % 16 >= level) continue
                    dst.set(R(sx) + xx, R(sy) + yy, yy < 0 ? C.stone3 : C.stone2)
                }
            }
        }
        // landing: steam bursting out from under it
        if (st === 'entry' && tt >= JM_LAND && tt < JM_LAND + 0.7) {
            const a = (tt - JM_LAND) / 0.7
            for (const side of [-1, 1]) {
                for (let k = 0; k < 5; k++) {
                    const cx = R(x + side * (14 + a * (40 + k * 10)))
                    const cy = R(y - 4 - k * 2 - a * 8)
                    const r = 4 + a * 8
                    for (let j = 0; j < 14; j++) { const b = j / 14 * Math.PI * 2; if ((j + k) % 3) dst.set(R(cx + Math.cos(b) * r), R(cy + Math.sin(b) * r * 0.6), a < 0.5 ? C.white : C.bone1) }
                }
            }
        }
        // the ram's strike: sparks where it lands
        if (st === 'attack' && B.strike) {
            const hx = x + dir * 90
            for (let i = 0; i < 14; i++) dst.set(hx + dir * ((i * 5) % 16), y - 72 + ((i * 7) % 14) - 7, i % 3 ? C.gold3 : C.white)
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 3 · The Forgemaster

/** How much smaller than his layout the Forgemaster is drawn, about his feet. */
const FM_SCALE = 0.85

const SKIN: Mat5 = { ramp: [C.skin0, C.skin1, C.skin1, C.skin2], hi: C.skin2, rim: C.skin0 }
const BEARD = [C.red0, C.red1, C.orange] as const

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
    states: bossStates(1.8, 2.2, 2.4),
    draw(s, st, t) {
        drive(this, st, t, 18, 2.2)
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
        const [Gx, Gy] = up(bz(26, 6, 50), bz(-86, -118, -62))
        const ga = bz(-2.4, -1.75, 0.72) + tilt
        const ca = Math.cos(ga)
        const sa = Math.sin(ga)

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

        // ── the forge hammer: a long iron-shod haft, a great head, its face glowing, runes in gold ──
        {
            const bx = Gx - ca * 16
            const by = Gy - sa * 16
            const hx = Gx + ca * 54
            const hy = Gy + sa * 54
            const hm = mask(s, 'mhaft')
            taper(hm, bx, by, hx, hy, 7, 6, 1)
            vol(s, hm, WOOD, 3)
            selOut(s, hm, C.brown0)
            for (const k of [-10, 10, 40, 54]) { const cx = Gx + ca * k; const cy = Gy + sa * k; line(s, cx - sa * 4, cy + ca * 4, cx + sa * 4, cy - ca * 4, C.steel1, 2) }
            const nx = -sa
            const ny = ca
            const hw = 18
            const hl = 12
            const im = mask(s, 'mhhead')
            poly(im, [hx + nx * hw - ca * hl, hy + ny * hw - sa * hl, hx + nx * hw + ca * hl, hy + ny * hw + sa * hl, hx - nx * hw + ca * hl, hy - ny * hw + sa * hl, hx - nx * hw - ca * hl, hy - ny * hw - sa * hl], 0, 0, 1)
            vol(s, im, IRON, 10)
            selOut(s, im, C.steel0)
            // the striking face, glowing from the fire, on the side that lands
            for (let d = 0; d < 3; d++) line(s, hx - nx * (hw - d) - ca * hl, hy - ny * (hw - d) - sa * hl, hx - nx * (hw - d) + ca * hl, hy - ny * (hw - d) + sa * hl, d === 0 ? hotFace : d === 1 ? C.orange : C.lava1)
            // runes cut into the head, lit gold
            for (let k = -1; k <= 1; k++) {
                const rx = hx + nx * k * 6
                const ry = hy + ny * k * 6
                line(s, rx - ca * 5, ry - sa * 5, rx + ca * 5, ry + sa * 5, C.gold2)
                px(s, rx + nx * 2, ry + ny * 2, C.gold3)
            }
        }

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
