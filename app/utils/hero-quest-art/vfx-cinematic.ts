// Round 2 skill VFX: the cinematic treatment, after the reference video.
//
// Every one is choreographed the same way: a rune ring lights under the caster while the
// cast charges, one big *filled* effect travels or falls, and each impact is a solid blob of
// energy (white core → element ramp → dark rim, noisy edge, eaten away as it cools) inside a
// thin white shock ring, with sparks thrown out and something left burning. Nothing here is
// a 1px line where a mass would read better.
//
// Timing is part of the def: `hits` are the seconds at which each impact lands, which the
// live stage uses to stack its damage numbers, and `tint` is the colour the scene dims
// toward while the skill plays (see presentation.ts).

import { C, type ColorName, type RampName } from './palette'
import { disc, ellipseRing, ditherEllipse, hash2, line, rect, tri, type Surface } from './surface'
import { VL, pr, qt, inWin, eo, burst, motes, bolt, travel, lob, VP, stunStars, rain, R } from './vfx-kit'
import { Actor } from './rig'
import { HERO_ART } from './heroes'
import { drawCreature } from './creature'
import { TRAINING_DUMMY } from './raids'
import { WOLF } from './summons'
import type { VfxDef } from './vfx'

export interface Cinematic {
    /** Seconds into the effect at which each impact lands. Empty for a pure buff. */
    hits: readonly number[]
    /** The colour the scene darkens toward while it plays. */
    tint: ColorName
    /** Hits walk across the enemy line (one per target) rather than all landing on one. */
    spread: boolean
}

export type CinematicVfx = VfxDef & { cinematic: Cinematic }

const F = VL.foes
const A = VL.allies
const CX = VL.caster.x
const FLOOR = VL.floor
/** Where a hit lands on a standing target: its chest, on the round-2 bodies. */
const CHEST = FLOOR - 14

// ── Kit ────────────────────────────────────────────────────────────────────────────

/** A 6-step element ramp, white-hot first: [white, hot, bright, mid, deep, rim]. */
export type Ramp6 = readonly [number, number, number, number, number, number]

const FIRE: Ramp6 = [C.white, C.gold3, C.gold2, C.orange, C.lava1, C.red1]
const BLOOD: Ramp6 = [C.white, C.red3, C.red2, C.red2, C.red1, C.red0]
const GOLD: Ramp6 = [C.white, C.gold3, C.gold3, C.gold2, C.gold1, C.gold0]

/**
 * A solid ball of energy at (cx, cy), radius `r`, `age` 0..1 through its life. The colour
 * band is picked by distance plus per-frame noise, so the edge boils; as it ages the core
 * cools out of the ramp and hashed holes eat it away. `flat` squashes it into a dome
 * standing on the ground.
 */
export function blob(d: Surface, cx: number, cy: number, r: number, age: number, ramp: Ramp6, seed: number, flat = false): void {
    if (age < 0 || age >= 1 || r < 1) return
    const f = Math.floor(age * 30)
    const cool = age * 2.2
    const eat = age < 0.35 ? 0 : (age - 0.35) / 0.65
    const ri = Math.ceil(r)
    for (let dy = -ri; dy <= (flat ? 0 : ri); dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
            const dd = Math.hypot(dx, flat ? dy * 1.25 : dy) / r
            if (dd > 1.05) continue
            const n = hash2(seed * 131 + dx * 17 + f, dy * 31 + seed)
            const k = dd + (n - 0.5) * 0.3
            if (k > 1) continue
            if (eat > 0 && hash2(seed + dx * 7, dy * 13 + f) < eat * (0.5 + dd)) continue
            const band = Math.min(5, Math.max(0, Math.floor(k * 4 + cool)))
            d.set(R(cx) + dx, R(cy) + dy, ramp[band]!)
        }
    }
}

/**
 * A filled crescent in scene space: `width` px thick mid-sweep, tapering at both tips, with
 * a white outer edge — the video's slash, swept over progress u (0..1) so it can draw on.
 */
function arcBand(d: Surface, cx: number, cy: number, r: number, a0: number, a1: number, width: number, u: number,
    body: number, edge: number = C.white, inner: number = body): void {
    if (u <= 0) return
    const steps = Math.max(10, R(Math.abs(a1 - a0) * r * 1.5))
    const head = Math.min(1, u)
    for (let i = 0; i <= steps; i++) {
        const k = i / steps
        if (k > head) break
        const a = a0 + (a1 - a0) * k
        const th = Math.max(1, R(width * Math.sin(Math.PI * k)))
        for (let dd = 0; dd < th; dd++) {
            const c = dd === 0 ? edge : dd === th - 1 && th > 2 ? inner : body
            d.set(R(cx + Math.cos(a) * (r - dd)), R(cy + Math.sin(a) * (r - dd)), c)
        }
    }
}

/** A thin expanding ring — the white shock outline the video puts round every blast. */
export function shockRing(d: Surface, x: number, y: number, t: number, t0: number, dur: number, r0: number, r1: number, c: number, flat = false): void {
    const u = (qt(t) - t0) / dur
    if (u < 0 || u >= 1) return
    const r = r0 + (r1 - r0) * eo(u)
    const col = u < 0.5 ? c : u < 0.8 ? C.steel2 : C.steel1
    if (flat) ellipseRing(d, x, y, r, r * 0.3, col)
    else {
        const n = Math.max(16, R(r * 6))
        for (let i = 0; i < n; i++) {
            if (u > 0.6 && (i & 1)) continue
            const a = i / n * Math.PI * 2
            d.set(R(x + Math.cos(a) * r), R(y + Math.sin(a) * r), col)
        }
    }
}

/**
 * The ground sigil under the caster: two concentric slanted rings with rune ticks turning
 * between them, lit over [t0, t1] — it grows in, holds, and shrinks out.
 */
function casterRing(d: Surface, x: number, t: number, t0: number, t1: number, dark: number, mid: number, light: number): void {
    const q = qt(t)
    if (q < t0 || q >= t1) return
    const grow = Math.min(1, (q - t0) / 0.2)
    const shrink = Math.min(1, (t1 - q) / 0.2)
    const s = Math.min(grow, shrink)
    const rx = 5 + 11 * s
    ellipseRing(d, x, FLOOR - 1, rx, rx * 0.28, light)
    ellipseRing(d, x, FLOOR - 1, rx - 3, (rx - 3) * 0.28, mid)
    const n = 10
    for (let i = 0; i < n; i++) {
        const a = q * 2.5 + i / n * Math.PI * 2
        const r = rx - 1.5
        const px = R(x + Math.cos(a) * r)
        const py = R(FLOOR - 1 + Math.sin(a) * r * 0.28)
        d.set(px, py, i & 1 ? light : C.white)
        d.set(px + 1, py, mid)
    }
    // light rising off the ring
    if (s > 0.6) motes(d, x, FLOOR - 2, rx * 2, 22, t, 10, 'spark', 7, 30)
    if (s > 0.6) for (let i = 0; i < 6; i++) {
        const u = ((q * 3 + hash2(i, 5)) % 1)
        const px = R(x + (hash2(i, 6) - 0.5) * rx * 2)
        const py = R(FLOOR - 2 - u * 16)
        d.set(px, py, u < 0.3 ? C.white : u < 0.6 ? light : mid)
        if (u < 0.5) d.set(px, py + 1, dark)
    }
}

/** A tilted ellipse point: radius r, squash, rotated by rot. Scratch EP. */
const EP = { x: 0, y: 0 }
function ep(cx: number, cy: number, r: number, a: number, squash: number, rot: number): void {
    const ex = Math.cos(a) * r
    const ey = Math.sin(a) * r * squash
    EP.x = cx + ex * Math.cos(rot) - ey * Math.sin(rot)
    EP.y = cy + ex * Math.sin(rot) + ey * Math.cos(rot)
}

/** The portal the meteors fall out of: tilted rings, turning runes, a swirling hot core. */
function skyPortal(d: Surface, cx: number, cy: number, t: number, t0: number, t1: number): void {
    const q = qt(t)
    if (q < t0 || q >= t1) return
    const s = Math.min(1, (q - t0) / 0.25, (t1 - q) / 0.2)
    const r = 4 + 12 * s
    const rot = -0.5
    const sq = 0.42
    for (let ring = 0; ring < 3; ring++) {
        const rr = r - ring * 3
        const c = ring === 0 ? C.gold3 : ring === 1 ? C.orange : C.lava1
        const n = R(rr * 7)
        for (let i = 0; i < n; i++) {
            if (ring === 0 && (i + Math.floor(q * 20)) % 5 === 0) continue
            ep(cx, cy, rr, i / n * Math.PI * 2, sq, rot)
            d.set(R(EP.x), R(EP.y), c)
        }
    }
    // spiral arms drawing inward
    for (let arm = 0; arm < 3; arm++) {
        for (let k = 0; k < 14; k++) {
            const u = k / 14
            ep(cx, cy, (r - 2) * (1 - u), q * 6 + arm * 2.1 + u * 3, sq, rot)
            d.set(R(EP.x), R(EP.y), u > 0.7 ? C.white : u > 0.4 ? C.gold2 : C.orange)
        }
    }
    // outer rune ticks
    for (let i = 0; i < 12; i++) {
        ep(cx, cy, r + 3, -q * 2 + i / 12 * Math.PI * 2, sq, rot)
        d.set(R(EP.x), R(EP.y), i & 1 ? C.gold2 : C.white)
    }
    for (let i = 0; i < 5; i++) {
        ep(cx, cy, r * 0.25, i / 5 * Math.PI * 2, sq, rot)
        d.set(R(EP.x), R(EP.y), C.white)
    }
}

/** A falling meteor: rocky core in a flame shell, a white-hot front and a flame tail. */
function meteor(d: Surface, x: number, y: number, r: number, a: number, t: number, seed: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const f = Math.floor(qt(t) * 10)
    // tail: a tapering stack of flame discs stepping back along the path
    const len = r * 5
    for (let i = len; i > 0; i -= 1.5) {
        const u = i / len
        const w = Math.max(0.5, r * (1 - u) * 1.1)
        const jit = (hash2(seed + f, R(i)) - 0.5) * 2 * u
        const c = u > 0.7 ? C.red1 : u > 0.45 ? C.lava1 : u > 0.2 ? C.orange : C.gold2
        disc(d, x - dx * i - dy * jit, y - dy * i + dx * jit, w, c)
    }
    disc(d, x, y, r + 1, C.lava1)
    disc(d, x, y, r, C.stone1)
    disc(d, x - dx, y - dy, r - 1, C.stone2)
    // lava cracks and the leading edge burning white
    d.set(R(x) - 1, R(y), C.orange); d.set(R(x), R(y) + 1, C.lava1)
    for (let k = -r; k <= r; k++) d.set(R(x + dx * (r + 1) - dy * k * 0.7), R(y + dy * (r + 1) + dx * k * 0.7), Math.abs(k) < r * 0.5 ? C.white : C.gold3)
    burst(d, x, y, t, qt(t) - 0.05, 4, 20, 'ember', seed + f, 0.3)
}

/** Fire left burning on the ground: tongues flickering up from a strip `w` wide. */
function groundFire(d: Surface, x: number, w: number, t: number, t0: number, t1: number, seed: number, tall = 8): void {
    const q = qt(t)
    if (q < t0 || q >= t1) return
    const fade = Math.min(1, (t1 - q) / 0.4)
    const f = Math.floor(q * 10)
    const n = R(w / 2)
    for (let i = 0; i < n; i++) {
        const xx = R(x - w / 2 + i * 2 + hash2(seed, i))
        const h = R(tall * fade * (0.3 + 0.7 * hash2(seed + f, i)))
        for (let k = 0; k < h; k++) {
            const u = k / Math.max(1, h)
            d.set(xx, FLOOR - 1 - k, u < 0.3 ? C.gold2 : u < 0.6 ? C.orange : C.lava1)
        }
        if (h > 0) d.set(xx, FLOOR - 1 - h, u8(f + i) ? C.red1 : C.gold3)
    }
    ditherEllipse(d, x, FLOOR, w / 2 + 2, 1, C.lava0, 8)
}
function u8(n: number): boolean { return (n & 3) === 0 }

/** Sparks flung from (x, y) that fall and bounce off the floor as they cool. */
function sparksOut(d: Surface, x: number, y: number, t: number, t0: number, n: number, spd: number, seed: number, ramp: RampName): void {
    burst(d, x, y, t, t0, n, spd, ramp, seed, 0.9, 110, -Math.PI / 2, Math.PI * 1.3, 2)
}

/** The whole impact package: flash, blob, shock ring, sparks. */
export function blast(d: Surface, x: number, y: number, t: number, t0: number, r: number, life: number, ramp: Ramp6, seed: number, sparkRamp: RampName, flat = false): void {
    const age = (qt(t) - t0) / life
    if (age < 0) return
    if (age < 0.08) disc(d, x, y, r * 0.6, C.white)
    blob(d, x, y, r * (0.55 + 0.45 * eo(Math.min(1, age * 3))), age, ramp, seed, flat)
    shockRing(d, x, flat ? y - r * 0.5 : y, t, t0, life * 0.7, r * 0.6, r * 1.35, C.white)
    sparksOut(d, x, y, t, t0, 18, 70, seed + 3, sparkRamp)
}

// ── The cinematics ───────────────────────────────────────────────────────────────────────

const METEORS = [
    { from: 0.45, dur: 0.3, target: 0, r: 4, blast: 15 },
    { from: 0.75, dur: 0.3, target: 2, r: 4, blast: 15 },
    { from: 1.05, dur: 0.35, target: 1, r: 6, blast: 24 }
] as const
const PORTAL = { x: 132, y: 14 }

const meteorShower: CinematicVfx = {
    id: 'skill_meteor_shower', name: 'Meteor Shower', source: 'class', owner: 'Sorcerer', dur: 2.6,
    cinematic: { hits: METEORS.map(m => m.from + m.dur), tint: 'dusk0', spread: true },
    draw(d, t) {
        casterRing(d, CX, t, 0, 2.0, C.red1, C.orange, C.gold2)
        skyPortal(d, PORTAL.x, PORTAL.y, t, 0.1, 1.7)
        METEORS.forEach((m, i) => {
            const tx = F[m.target]!.x
            const hit = m.from + m.dur
            const u = pr(t, m.from, hit)
            if (inWin(t, m.from, hit)) {
                const x = PORTAL.x + (tx - PORTAL.x) * u
                const y = PORTAL.y + (FLOOR - 4 - PORTAL.y) * u
                meteor(d, x, y, m.r, Math.atan2(FLOOR - 4 - PORTAL.y, tx - PORTAL.x), t, 20 + i)
            }
            blast(d, tx, FLOOR - 1, t, hit, m.blast, 0.7, FIRE, 40 + i, 'ember', true)
            // the burn the skill leaves behind
            groundFire(d, tx, 14, t, hit + 0.2, 2.6, 60 + i, m.r > 4 ? 12 : 8)
            if (qt(t) > hit + 0.3) motes(d, tx, FLOOR - 4, 10, 26, t, 6, 'ember', 70 + i, 24)
        })
    }
}

// Kill Shot: the target is painted, the arrowhead charges, then one beam goes through.
const KS = { lock: 0.1, fire: 1.1 }
const BOW = { x: CX + 12, y: FLOOR - 13 }

const killShot: CinematicVfx = {
    id: 'skill_kill_shot', name: 'Kill Shot', source: 'class', owner: 'Hunter', dur: 2.1,
    cinematic: { hits: [KS.fire + 0.05], tint: 'dusk0', spread: false },
    draw(d, t) {
        const q = qt(t)
        // single target: the front of the line, where the stage lands the damage
        const tg = F[0]
        casterRing(d, CX, t, 0, 1.3, C.red0, C.red1, C.red3)
        // the reticle: brackets closing in and turning, a pulsing pip
        if (q >= KS.lock && q < KS.fire + 0.1) {
            const u = pr(t, KS.lock, KS.fire - 0.2)
            const r = R(16 - u * 8)
            const rot = u * Math.PI / 2
            for (let k = 0; k < 4; k++) {
                const a = rot + k * Math.PI / 2 + Math.PI / 4
                const bx = R(tg.x + Math.cos(a) * r)
                const by = R(CHEST + Math.sin(a) * r)
                const sx = Math.cos(a) > 0 ? -1 : 1
                const sy = Math.sin(a) > 0 ? -1 : 1
                for (let j = 0; j < 4; j++) { d.set(bx + sx * j, by, C.red2); d.set(bx, by + sy * j, C.red2) }
                d.set(bx, by, C.white)
            }
            for (let j = 2; j < 5; j++) {
                d.set(tg.x - r - j, CHEST, C.red3); d.set(tg.x + r + j, CHEST, C.red3)
                d.set(tg.x, CHEST - r - j, C.red3); d.set(tg.x, CHEST + r + j, C.red3)
            }
            if ((Math.floor(q * 10) & 1) || u >= 1) disc(d, tg.x, CHEST, 1, C.red3)
            d.set(tg.x, CHEST, C.white)
        }
        // charge converging on the arrowhead
        if (q >= 0.3 && q < KS.fire) {
            const u = pr(t, 0.3, KS.fire)
            for (let i = 0; i < 10; i++) {
                const a = hash2(i, 3) * Math.PI * 2
                const ph = (q * 2 + hash2(i, 4)) % 1
                const dist = (1 - ph) * 18
                d.set(R(BOW.x + Math.cos(a) * dist), R(BOW.y + Math.sin(a) * dist), ph > 0.7 ? C.white : C.red3)
            }
            disc(d, BOW.x, BOW.y, 1 + u * 2, C.red2)
            disc(d, BOW.x, BOW.y, u * 1.5, C.white)
        }
        // the beam: fat, white-cored, collapsing to a thread
        const bu = (q - KS.fire) / 0.45
        if (bu >= 0 && bu < 1) {
            const half = R(3 * (1 - bu))
            const x1 = bu < 0.1 ? tg.x : VL.W
            for (let dy = -half - 1; dy <= half + 1; dy++) {
                const c = Math.abs(dy) <= half - 2 ? C.white : Math.abs(dy) <= half - 1 ? C.red3 : Math.abs(dy) <= half ? C.red2 : C.red1
                if (Math.abs(dy) === half + 1 && bu > 0.3) continue
                line(d, BOW.x, BOW.y + dy, x1, CHEST + dy, c)
            }
            disc(d, BOW.x, BOW.y, 4 * (1 - bu) + 1, bu < 0.3 ? C.white : C.red3)
            for (let i = 0; i < 12; i++) {
                const px = BOW.x + hash2(i, 9 + Math.floor(q * 10)) * (tg.x - BOW.x)
                d.set(R(px), R(BOW.y + (CHEST - BOW.y) * (px - BOW.x) / (tg.x - BOW.x) + (hash2(i, 11) - 0.5) * 10), C.red3)
            }
        }
        blast(d, tg.x, CHEST, t, KS.fire + 0.05, 15, 0.7, BLOOD, 130, 'blood')
        // punch-through: spray leaving the far side
        burst(d, tg.x + 4, CHEST, t, KS.fire + 0.05, 20, 110, 'blood', 140, 0.5, 60, 0, 0.7, 2)
        shockRing(d, tg.x, FLOOR - 1, t, KS.fire + 0.1, 0.5, 4, 22, C.red3, true)
    }
}

// Haste doubles the Beginner's own SPD: a gold pillar takes him, and he leaves it running.
const haste: CinematicVfx = {
    id: 'skill_haste', name: 'Haste', source: 'class', owner: 'Beginner', dur: 1.8,
    cinematic: { hits: [], tint: 'night0', spread: false },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.6, C.gold0, C.gold1, C.gold3)
        // the pillar: slams down, narrows to a thread
        const pu = (q - 0.45) / 0.55
        if (pu >= 0 && pu < 1) {
            const half = R(8 * (1 - pu * pu))
            for (let dx = -half; dx <= half; dx++) {
                const k = Math.abs(dx) / Math.max(1, half)
                const c = k < 0.3 ? C.white : k < 0.6 ? C.gold3 : k < 0.85 ? C.gold2 : C.gold1
                const top = pu < 0.15 ? R(FLOOR - (FLOOR + 4) * pu / 0.15) : 0
                for (let y = top; y < FLOOR; y++) if (k < 0.85 || ((y + dx) & 1)) d.set(CX + dx, y, c)
            }
            shockRing(d, CX, FLOOR - 1, t, 0.45, 0.5, 6, 26, C.gold3, true)
        }
        blast(d, CX, FLOOR - 1, t, 0.45, 12, 0.5, GOLD, 150, 'gold', true)
        // speed lines streaming off his back, chevrons climbing
        if (q >= 0.6 && q < 1.7) {
            for (let i = 0; i < 6; i++) {
                const ph = (q * 3 + hash2(i, 1)) % 1
                const y = FLOOR - 4 - i * 4
                const x = CX - 6 - ph * 30
                const len = 6 + R(hash2(i, 2) * 8)
                for (let k = 0; k < len; k++) if (k < 3 || ((k + i) & 1) === 0) d.set(R(x - k), y, k < 2 ? C.white : C.gold2)
            }
            for (let k = 0; k < 3; k++) {
                const ph = (q * 1.5 + k / 3) % 1
                const y = R(FLOOR - 30 - ph * 14)
                const c = ph < 0.6 ? C.gold3 : C.gold1
                for (let j = -3; j <= 3; j++) { d.set(CX + j, y + Math.abs(j), c); d.set(CX + j, y + Math.abs(j) + 1, ph < 0.3 ? C.white : C.gold2) }
            }
        }
        motes(d, CX, FLOOR - 2, 22, 34, t, 14, 'gold', 160, 40)
    }
}

// ── Kit for the rest of the Hero skills ────────────────────────────────────────────

const STEEL: Ramp6 = [C.white, C.steel3, C.steel3, C.steel2, C.steel1, C.steel0]
const ARCANE: Ramp6 = [C.white, C.pink, C.pink, C.purple2, C.purple1, C.purple0]
const STORM: Ramp6 = [C.white, C.frost, C.cyan, C.blue2, C.blue1, C.blue0]
const NATURE: Ramp6 = [C.white, C.green4, C.green3, C.green2, C.green1, C.green0]
const TEAL: Ramp6 = [C.white, C.teal3, C.teal3, C.teal2, C.teal1, C.teal0]
const ROCK: Ramp6 = [C.white, C.frost, C.cyan, C.stone3, C.stone2, C.stone1]

/** A standing target's chest: 14 px up from the ground it stands on. */
function chestOf(f: { g: number }): number { return f.g - 14 }
/** The caster's head and bow hand, on the round-2 chibi body. */
const HEAD_Y = FLOOR - 24
const HAND = { x: CX + 10, y: FLOOR - 13 }

/** Lightning three pixels thick: a glow band either side of a white core, re-rolled each frame. */
function fatBolt(d: Surface, x0: number, y0: number, x1: number, y1: number, t: number, seed: number, glow: number = C.cyan, edge: number = C.blue1): void {
    bolt(d, x0 - 1, y0, x1 - 1, y1, t, seed, edge, edge, 5)
    bolt(d, x0 + 1, y0, x1 + 1, y1, t, seed, glow, edge, 5)
    bolt(d, x0, y0, x1, y1, t, seed, C.white, glow, 5)
}

/** A comet: a filled ball in a ramp, a tapering tail of discs streaming back along `a`. */
function comet(d: Surface, x: number, y: number, a: number, r: number, ramp: Ramp6, t: number, seed: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const f = Math.floor(qt(t) * 10)
    const len = r * 5
    for (let i = len; i > 0; i -= 1.5) {
        const u = i / len
        const jit = (hash2(seed + f, R(i)) - 0.5) * 2 * u
        disc(d, x - dx * i - dy * jit, y - dy * i + dx * jit, Math.max(0.5, r * (1 - u)), ramp[Math.min(5, 2 + Math.floor(u * 4))]!)
    }
    disc(d, x, y, r + 1, ramp[3])
    disc(d, x, y, r, ramp[1])
    disc(d, x - dx * 0.5, y - dy * 0.5, Math.max(0.5, r - 1.5), C.white)
}

/** Buff (up) or debuff (down) chevrons over a body, three pixels a stroke. */
function chevrons(d: Surface, x: number, y: number, t: number, up: boolean, c: number, hi: number = C.white): void {
    const q = qt(t)
    for (let k = 0; k < 2; k++) {
        const ph = (q * 1.4 + k / 2) % 1
        const yy = R(up ? y - ph * 10 : y - 10 + ph * 10)
        const xx = x + (k & 1 ? 4 : -4)
        for (let i = 0; i < 4; i++) {
            const dy = up ? i : -i
            const col = i === 0 ? hi : c
            d.set(xx - i, yy + dy, col); d.set(xx + i, yy + dy, col)
            d.set(xx - i, yy + dy + (up ? 1 : -1), c); d.set(xx + i, yy + dy + (up ? 1 : -1), c)
        }
    }
}

/**
 * A storm of blade-arcs spun round x, `h` tall: flat crescents layered up the column, each a
 * filled sweep with a white leading edge, the column widening toward the top.
 */
function bladeStorm(d: Surface, x: number, t: number, grow: number, h: number, body: Ramp6, wide = 1): void {
    const q = qt(t)
    const layers = 10
    // the column's body first, a dithered mass so the arcs read as one spinning thing
    for (let i = 0; i < layers; i++) {
        const u = i / (layers - 1)
        ditherEllipse(d, x, FLOOR - 2 - u * h * grow, (5 + u * 8) * grow * wide, (5 + u * 8) * grow * wide * 0.32, body[4], 7)
    }
    for (let i = 0; i < layers; i++) {
        const u = i / (layers - 1)
        const y = FLOOR - 2 - u * h * grow
        const r = (6 + u * 9) * grow * wide
        const a = q * 16 + i * 1.1
        const n = R(r * 6)
        for (let k = 0; k < n; k++) {
            const aa = a + k / n * Math.PI * 1.3
            const px = R(x + Math.cos(aa) * r)
            const py = R(y + Math.sin(aa) * r * 0.3)
            const lead = k > n - 4
            d.set(px, py, lead ? C.white : i & 1 ? body[2] : body[3])
            if (k > n * 0.15) d.set(px, py - 1, lead ? body[1] : body[2])
            if (k > n * 0.45) d.set(px, py + 1, body[3])
            if (k > n * 0.75) d.set(px, py + 2, body[4])
        }
    }
    burst(d, x, FLOOR - 1, t, q - 0.1, 8, 50, 'dust', 190 + Math.floor(q * 10), 0.3, 0, Math.PI, Math.PI)
}

// ── Warrior: Whirlwind ─────────────────────────────────────────────────────────────

// The front line only: a storm of steel spun up round the caster is flung onto the front rank,
// where it stands tall enough to take all three of its ranks and grinds through them.
const WHIRL = { launch: 0.75, arrive: 1.05, leave: 1.95, x: 134 }
const WHIRL_HITS = [1.15, 1.4, 1.65]

const whirlwind: CinematicVfx = {
    id: 'skill_whirlwind', name: 'Whirlwind', source: 'class', owner: 'Warrior', dur: 2.4,
    cinematic: { hits: WHIRL_HITS, tint: 'night0', spread: true },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.0, C.steel1, C.steel2, C.white)
        // the spin-up: two blade-arcs whirling round the caster, faster and faster
        if (q >= 0.15 && q < WHIRL.launch) {
            const sp = 8 + pr(t, 0.15, WHIRL.launch) * 14
            for (let k = 0; k < 2; k++) {
                const a0 = q * sp + k * Math.PI
                arcBand(d, CX, FLOOR - 12, 14, a0, a0 + 2.2, 4, 1, C.steel3, C.white, C.steel1)
            }
        }
        if (q >= WHIRL.launch && q < WHIRL.leave + 0.35) {
            const x = q < WHIRL.arrive ? CX + (WHIRL.x - CX) * eo(pr(t, WHIRL.launch, WHIRL.arrive)) : WHIRL.x
            const grow = q < WHIRL.leave ? Math.min(1, 0.45 + (q - WHIRL.launch) / 0.25) : Math.max(0, 1 - (q - WHIRL.leave) / 0.35)
            bladeStorm(d, x, t, grow, 50, STEEL)
            if (q < WHIRL.arrive) for (let k = 1; k < 5; k++) rect(d, x - 10 - k * 5, FLOOR - 4 - k * 4, 5, 1, k < 2 ? C.steel3 : C.steel1)
        }
        WHIRL_HITS.forEach((h, i) => {
            const f = F[i]!
            const cy = chestOf(f)
            const age = (q - h) / 0.3
            // a crescent cut through each rank as the storm takes it, alternating direction
            if (age >= 0 && age < 0.7) {
                const flip = i & 1 ? -1 : 1
                arcBand(d, f.x, cy, 12, flip > 0 ? -2.4 : -0.7, flip > 0 ? 0.5 : -3.8, 5, age * 3, C.steel3, C.white, C.steel1)
            }
            blast(d, f.x, cy, t, h + 0.04, 9, 0.4, STEEL, 200 + i, 'steel')
        })
    }
}

// ── Barbarian: Threatening Roar ────────────────────────────────────────────────────

// No damage: every foe's PWR drops, and the Barbarian draws their eyes (a taunt). The roar
// leaves his mouth as great rings of red sound that break over the whole enemy line.
const ROAR = { at: 0.45, waves: 4, gap: 0.13, life: 0.7 }

const threateningRoar: CinematicVfx = {
    id: 'skill_threatening_roar', name: 'Threatening Roar', source: 'class', owner: 'Barbarian', dur: 2.2,
    cinematic: { hits: [], tint: 'dusk0', spread: false },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.4, C.red0, C.red1, C.red3)
        const mx = CX + 7
        const my = HEAD_Y + 4
        // the roar's breath gathering at his mouth, then the sound rolling out
        if (q >= 0.2 && q < ROAR.at) disc(d, mx, my, pr(t, 0.2, ROAR.at) * 3, C.red2)
        for (let k = 0; k < ROAR.waves; k++) {
            const t0 = ROAR.at + k * ROAR.gap
            const u = (q - t0) / ROAR.life
            if (u < 0 || u >= 1) continue
            const r = 6 + eo(u) * 120
            const w = R(2 + 6 * (1 - u))
            arcBand(d, mx, my, r, -0.55, 0.55, w, 1, u < 0.5 ? C.red2 : C.red1, u < 0.6 ? C.white : C.red3, C.red0)
        }
        shockRing(d, mx, my, t, ROAR.at, 0.35, 3, 14, C.white)
        if (q >= ROAR.at && q < ROAR.at + 0.6) burst(d, mx, my, t, ROAR.at, 14, 70, 'blood', 210, 0.5, 0, 0, 1.1)
        // the taunt: a big mark over the roarer, pulsing
        if (q >= ROAR.at && q < 2.2) {
            const y = HEAD_Y - 14 + (Math.floor(q * 4) & 1)
            rect(d, CX - 1, y, 3, 7, C.red2); rect(d, CX, y, 1, 6, C.red3); rect(d, CX - 1, y + 8, 3, 3, C.red2)
            d.set(CX, y, C.white)
        }
        // every foe cowed as the sound reaches it: a red flare, then PWR-down chevrons
        F.forEach((f, i) => {
            const reach = ROAR.at + ((f.x - mx) / 120) * ROAR.life * 0.6
            blast(d, f.x, chestOf(f) - 6, t, reach, 4, 0.3, BLOOD, 220 + i, 'blood')
            if (q >= reach + 0.1) chevrons(d, f.x, chestOf(f) - 14, t, false, C.red2, C.red3)
        })
    }
}

// ── Berserker: Enrage ──────────────────────────────────────────────────────────────

// Self only: PWR up, DEF down. A blood-red blast takes him, and he stands wreathed in red
// flame, the ground cracking under him; red chevrons climb and grey ones fall.
const ENRAGE_AT = 0.45

const enrage: CinematicVfx = {
    id: 'skill_enrage', name: 'Enrage', source: 'class', owner: 'Berserker', dur: 2.2,
    cinematic: { hits: [], tint: 'dusk0', spread: false },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.8, C.red0, C.red1, C.red2)
        // the rage gathering: red motes drawn in to his chest
        if (q >= 0.1 && q < ENRAGE_AT) for (let i = 0; i < 12; i++) {
            const a = hash2(i, 31) * Math.PI * 2
            const ph = (q * 2.5 + hash2(i, 32)) % 1
            const dist = (1 - ph) * 20
            d.set(R(CX + Math.cos(a) * dist), R(FLOOR - 12 + Math.sin(a) * dist * 0.8), ph > 0.7 ? C.white : C.red2)
        }
        blast(d, CX, FLOOR - 12, t, ENRAGE_AT, 15, 0.6, BLOOD, 230, 'blood')
        // cracks run out from his feet
        if (q >= ENRAGE_AT) {
            const u = pr(t, ENRAGE_AT, ENRAGE_AT + 0.3)
            for (const [dx, dy] of [[-1, 0.2], [1, 0.25], [-0.7, -0.1], [0.8, -0.12]] as const) {
                const L = 16 * u
                for (let k = 2; k < L; k++) d.set(R(CX + dx * k), R(FLOOR - 1 + dy * k + (hash2(k, R(dx * 10)) > 0.6 ? 1 : 0)), k < L - 2 ? C.red0 : C.red2)
            }
        }
        // the aura: red flame tongues licking up round his body
        if (q >= ENRAGE_AT + 0.05 && q < 2.2) {
            const fade = Math.min(1, (2.2 - q) / 0.4)
            const f = Math.floor(q * 15)
            for (let i = 0; i < 12; i++) {
                const xx = CX - 15 + i * 2 + (i > 5 ? 6 : 0)
                const edge = Math.abs(i - 5.5) / 5.5
                const h = R((14 + 20 * (1 - edge * edge)) * fade * (0.55 + 0.45 * hash2(f, i)))
                for (let k = 0; k < h; k++) {
                    const u = k / Math.max(1, h)
                    // tongues on either side of him, kept off his body so he reads inside the flame
                    if (Math.abs(xx - CX) < 8 && k < 28) continue
                    const c = u < 0.25 ? C.red3 : u < 0.6 ? C.red2 : C.red1
                    d.set(xx, FLOOR - 1 - k, c); d.set(xx + 1, FLOOR - 1 - k, u < 0.6 ? C.red1 : C.red0)
                }
                if (h > 0) d.set(xx, FLOOR - 1 - h, (f + i) & 1 ? C.white : C.red3)
            }
            // a crown of flame leaping off his head
            for (let i = 0; i < 5; i++) {
                const h = R((6 + 6 * hash2(f + 3, i)) * fade)
                for (let k = 0; k < h; k++) d.set(CX - 4 + i * 2, HEAD_Y - 6 - k, k < h / 2 ? C.red2 : C.red1)
                if (h > 0) d.set(CX - 4 + i * 2, HEAD_Y - 6 - h, C.red3)
            }
            motes(d, CX, FLOOR - 4, 22, 36, t, 12, 'fire', 240, 40)
        }
        if (q >= ENRAGE_AT + 0.2) {
            chevrons(d, CX - 2, HEAD_Y - 6, t, true, C.red2, C.red3)
            chevrons(d, CX + 12, HEAD_Y + 2, t, false, C.steel1, C.steel2)
        }
    }
}

// ── Knight: Shockwave ──────────────────────────────────────────────────────────────

// Every foe, and each is stunned: the Knight slams the ground, and a ridge of ice-bound rock
// tears out along the floor to each foe and erupts under it.
const SLAM = 0.45
const SHOCK_HITS = [0.95, 1.1, 1.25]

const shockwave: CinematicVfx = {
    id: 'skill_shockwave', name: 'Shockwave', source: 'class', owner: 'Knight', dur: 2.3,
    cinematic: { hits: SHOCK_HITS, tint: 'night0', spread: true },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.2, C.blue0, C.blue1, C.cyan)
        blast(d, CX + 8, FLOOR - 1, t, SLAM, 12, 0.5, ROCK, 250, 'dust', true)
        shockRing(d, CX + 8, FLOOR - 1, t, SLAM, 0.5, 4, 30, C.white, true)
        SHOCK_HITS.forEach((h, i) => {
            const f = F[i]!
            const x0 = CX + 12
            const y0 = FLOOR - 1
            // the ridge: spikes of rock bursting up in turn along the floor toward the foe
            const n = 9
            for (let k = 0; k < n; k++) {
                const u = (k + 1) / (n + 1)
                const at = SLAM + (h - SLAM) * u
                const age = (q - at) / 0.45
                if (age < 0 || age >= 1) continue
                const sx = R(x0 + (f.x - x0) * u)
                const sy = R(y0 + (f.g - 1 - y0) * u)
                const hh = R((7 + u * 6) * (age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85))
                if (hh < 1) continue
                // a shard of rock rimed in ice: lit face, shadowed face, a frost edge and a white tip
                tri(d, sx - 3, sy, sx + 3, sy, sx, sy - hh, C.stone1)
                tri(d, sx - 3, sy, sx, sy, sx, sy - hh, C.stone2)
                line(d, sx, sy - hh, sx - 2, sy - 1, C.frost)
                d.set(sx, sy - hh, C.white)
                if (age < 0.3) burst(d, sx, sy - 1, t, at, 4, 40, 'frost', 255 + k + i * 9, 0.3, 80, -Math.PI / 2, 1.6)
            }
            blast(d, f.x, f.g - 1, t, h, 13, 0.55, ROCK, 260 + i, 'frost', true)
            if (q >= h + 0.15 && q < 2.3) stunStars(d, f.x, chestOf(f) - 12, t)
        })
    }
}

// ── Mage: Ethereal Bouncebolt ──────────────────────────────────────────────────────

// The front line: one ball of arcane fire, charged in the Mage's hand, ricochets from rank to
// rank down the front line.
const BOUNCE = [0.6, 0.85, 1.15, 1.45] as const

const bouncebolt: CinematicVfx = {
    id: 'skill_ethereal_bouncebolt', name: 'Ethereal Bouncebolt', source: 'class', owner: 'Mage', dur: 2.2,
    cinematic: { hits: BOUNCE.slice(1), tint: 'night0', spread: true },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.1, C.purple0, C.purple1, C.pink)
        // charging in the hand: motes drawn in, the ball swelling
        if (q >= 0.15 && q < BOUNCE[0]) {
            const u = pr(t, 0.15, BOUNCE[0])
            for (let i = 0; i < 10; i++) {
                const a = hash2(i, 41) * Math.PI * 2
                const ph = (q * 2.2 + hash2(i, 42)) % 1
                const dist = (1 - ph) * 16
                d.set(R(HAND.x + Math.cos(a) * dist), R(HAND.y + Math.sin(a) * dist), ph > 0.7 ? C.white : C.pink)
            }
            disc(d, HAND.x, HAND.y, 1 + u * 3, C.purple2); disc(d, HAND.x, HAND.y, u * 2, C.white)
        }
        const pts = [[HAND.x, HAND.y], ...F.slice(0, 3).map(f => [f.x, chestOf(f)])] as const
        for (let k = 0; k < 3; k++) {
            const u = travel(t, BOUNCE[k]!, BOUNCE[k + 1]!)
            if (u >= 0) {
                const [x0, y0] = pts[k]!
                const [x1, y1] = pts[k + 1]!
                lob(x0!, y0!, x1!, y1!, k === 0 ? 6 : 14, u)
                comet(d, VP.x, VP.y, VP.a, 4, ARCANE, t, 270 + k)
            }
            const [hx, hy] = pts[k + 1]!
            blast(d, hx!, hy!, t, BOUNCE[k + 1]!, 10 + k * 2, 0.5, ARCANE, 280 + k, 'arcane')
        }
        // the spent bolt flickering out
        if (q >= BOUNCE[3]) burst(d, pts[3]![0]!, pts[3]![1]!, t, BOUNCE[3], 16, 60, 'arcane', 290, 0.6, -30, -Math.PI / 2, 1.6)
    }
}

// ── Wizard: Lightning Storm ────────────────────────────────────────────────────────

// Every foe: a thunderhead boils up over the enemy line and drives a bolt down into each.
const STORM_HITS = [0.72, 0.97, 1.22]

function thunderhead(d: Surface, t: number, s: number): void {
    if (s <= 0) return
    const q = qt(t)
    for (let i = 0; i < 9; i++) {
        const cx = 108 + i * 8 + (hash2(i, 51) - 0.5) * 4
        const cy = 6 + hash2(i, 52) * 5 + Math.sin(q * 2 + i) * 0.6
        const r = (6 + hash2(i, 53) * 4) * s
        disc(d, cx, cy + 1, r + 1, C.night0)
        disc(d, cx, cy, r, C.slate0)
        disc(d, cx - 1, cy - 1, r - 1.5, C.slate1)
        disc(d, cx - 2, cy - 2, r - 3.5, C.slate2)
    }
    // lightning flickering inside it
    if ((Math.floor(q * 12) % 5) === 0) for (let i = 0; i < 6; i++) d.set(R(112 + hash2(i, Math.floor(q * 12)) * 64), R(6 + hash2(i + 9, Math.floor(q * 12)) * 8), C.cyan)
}

const lightningStorm: CinematicVfx = {
    id: 'skill_lightning_storm', name: 'Lightning Storm', source: 'class', owner: 'Wizard', dur: 2.4,
    cinematic: { hits: STORM_HITS, tint: 'night0', spread: true },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.4, C.blue0, C.blue2, C.cyan)
        // a bolt climbs from the staff into the sky to call the storm
        if (q >= 0.25 && q < 0.4) fatBolt(d, CX + 6, HEAD_Y - 6, CX + 16, -2, t, 300)
        const s = q < 0.35 ? 0 : q < 2.0 ? Math.min(1, (q - 0.35) / 0.3) : Math.max(0, 1 - (q - 2.0) / 0.4)
        if (q >= 0.5 && q < 2.1) rain(d, 100, 186, 12, FLOOR, t, 0.5, 2.1, 18, C.night3, C.haze, -0.3, 310, 5)
        thunderhead(d, t, s)
        STORM_HITS.forEach((h, i) => {
            const f = F[i]!
            const cy = chestOf(f)
            // each bolt strikes twice in quick flicker, then the blast
            if (inWin(t, h - 0.06, h + 0.12) && (Math.floor(q * 30) % 3) !== 2) fatBolt(d, f.x + 4, 12, f.x, cy, t, 320 + i)
            blast(d, f.x, cy, t, h, 12, 0.5, STORM, 330 + i, 'storm')
            shockRing(d, f.x, f.g - 1, t, h, 0.4, 3, 16, C.cyan, true)
        })
    }
}

// ── Shaman: Totem Storm ────────────────────────────────────────────────────────────

// No damage: every ally's PWR rises. A carved totem bursts up out of the ground, a storm of
// teal wind spins up round it and sweeps back over the party, empowering each of them.
const TOTEM = { x: CX + 15, up: 0.2, storm: 0.6, sweep: 0.95, sink: 2.0 }

function totemPole(d: Surface, x: number, h: number, glow: boolean): void {
    if (h < 1) return
    const top = FLOOR - h
    rect(d, x - 3, top, 7, h, C.brown1)
    rect(d, x - 3, top, 2, h, C.brown2)
    // carved faces stacked up the pole, their eyes lit while the storm runs
    for (let fy = top + 3; fy < FLOOR - 3; fy += 8) {
        rect(d, x - 3, fy + 5, 7, 1, C.brown0)
        d.set(x - 2, fy + 1, glow ? C.teal3 : C.brown0); d.set(x + 2, fy + 1, glow ? C.teal3 : C.brown0)
        rect(d, x - 1, fy + 3, 3, 1, C.brown0)
    }
    if (h > 14) {
        // spread wings at the crown
        tri(d, x - 3, top + 2, x - 10, top - 3, x - 3, top + 6, C.teal1)
        tri(d, x + 3, top + 2, x + 10, top - 3, x + 3, top + 6, C.teal1)
        line(d, x - 3, top + 2, x - 10, top - 3, C.teal3); line(d, x + 3, top + 2, x + 10, top - 3, C.teal3)
        disc(d, x, top - 1, 2, glow ? C.white : C.teal2)
    }
}

const totemStorm: CinematicVfx = {
    id: 'skill_totem_storm', name: 'Totem Storm', source: 'class', owner: 'Shaman', dur: 2.5,
    cinematic: { hits: [], tint: 'night0', spread: false },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.6, C.teal0, C.teal1, C.teal3)
        const h = q < TOTEM.sink ? R(eo(pr(t, TOTEM.up, TOTEM.up + 0.2)) * 26) : R(26 * (1 - pr(t, TOTEM.sink, TOTEM.sink + 0.4)))
        if (q >= TOTEM.up) burst(d, TOTEM.x, FLOOR - 1, t, TOTEM.up, 14, 50, 'dust', 340, 0.5, 80, -Math.PI / 2, 2)
        // the storm spinning up round the totem
        if (q >= TOTEM.storm && q < TOTEM.sink + 0.3) {
            const grow = q < TOTEM.sink ? Math.min(1, (q - TOTEM.storm) / 0.3) : Math.max(0, 1 - (q - TOTEM.sink) / 0.3)
            bladeStorm(d, TOTEM.x + 4, t, grow, 40, TEAL, 0.6)
        }
        totemPole(d, TOTEM.x, h, q >= TOTEM.storm && q < TOTEM.sink)
        // wind streaming back over the party: spiralling streaks passing each ally
        if (q >= TOTEM.sweep && q < TOTEM.sweep + 0.7) for (let i = 0; i < 6; i++) {
            const a = A[i]!
            const ph = (q - TOTEM.sweep) / 0.7
            const x = TOTEM.x - ph * 70 + (i % 3) * 4
            for (let k = 0; k < 14; k++) {
                const aa = q * 14 + k * 0.45
                const px = R(x + k * 1.6)
                if (px > TOTEM.x) continue
                d.set(px, R(chestOf(a) - 2 + Math.sin(aa) * 3), k < 3 ? C.white : C.teal3)
            }
        }
        // each ally empowered as the wind passes it
        A.forEach((a, i) => {
            const at = TOTEM.sweep + ((TOTEM.x - a.x) / 70) * 0.7
            blast(d, a.x, chestOf(a), t, at, 5, 0.35, TEAL, 350 + i, 'water')
            if (q >= at + 0.1) chevrons(d, a.x, chestOf(a) - 14, t, true, C.teal3, C.white)
        })
    }
}

// ── Archer: Piercing Arrow ─────────────────────────────────────────────────────────

// A column: the front foe and the one behind it. A green arrow of wind, drawn long, bores
// straight through both and out, rings of air spiralling off its shaft.
const PIERCE = { fire: 0.95, exit: 1.3 }
const PIERCE_ROW = [F[0], F[3]] as const
const pierceAt = (x: number) => PIERCE.fire + (x - HAND.x) / (VL.W + 20 - HAND.x) * (PIERCE.exit - PIERCE.fire)

const piercingArrow: CinematicVfx = {
    id: 'skill_piercing_arrow', name: 'Piercing Arrow', source: 'class', owner: 'Archer', dur: 2.0,
    cinematic: { hits: PIERCE_ROW.map(f => pierceAt(f.x)), tint: 'night0', spread: true },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.3, C.green0, C.green2, C.green4)
        const y = chestOf(F[0])
        // the draw: wind gathering into the arrowhead
        if (q >= 0.2 && q < PIERCE.fire) {
            const u = pr(t, 0.2, PIERCE.fire)
            for (let i = 0; i < 12; i++) {
                const a = hash2(i, 61) * Math.PI * 2
                const ph = (q * 2 + hash2(i, 62)) % 1
                const dist = (1 - ph) * 18
                d.set(R(HAND.x + Math.cos(a) * dist), R(HAND.y + Math.sin(a) * dist), ph > 0.7 ? C.white : C.green4)
            }
            disc(d, HAND.x, HAND.y, 1 + u * 2.5, C.green3); disc(d, HAND.x, HAND.y, u * 1.5, C.white)
        }
        // the arrow: a white-cored shaft in a green glow, a broad head, its wake collapsing behind it
        const u = travel(t, PIERCE.fire, PIERCE.exit)
        if (u >= 0) {
            const x = HAND.x + u * (VL.W + 20 - HAND.x)
            const yy = HAND.y + (y - HAND.y) * Math.min(1, u * 4)
            for (let k = 0; k < 40; k++) {
                const px = x - 6 - k * 1.5
                if (px < HAND.x) break
                const w = k < 10 ? 3 : k < 24 ? 2 : 1
                for (let dy = -w; dy <= w; dy++) d.set(R(px), R(yy) + dy, Math.abs(dy) === w ? C.green2 : Math.abs(dy) === w - 1 ? C.green3 : k < 16 ? C.white : C.green4)
            }
            tri(d, x - 8, yy - 6, x - 8, yy + 6, x + 5, yy, C.green3)
            tri(d, x - 7, yy - 3, x - 7, yy + 3, x + 3, yy, C.white)
            // rings of air spun off the shaft
            for (let k = 0; k < 3; k++) {
                const rx = x - 14 - k * 12
                if (rx > HAND.x) ellipseRing(d, rx, yy, 2, 5 - k, k === 0 ? C.white : C.green3)
            }
        }
        PIERCE_ROW.forEach((f, i) => {
            const h = pierceAt(f.x)
            blast(d, f.x, y, t, h, 11 - i * 2, 0.5, NATURE, 360 + i, 'nature')
            burst(d, f.x + 4, y, t, h, 14, 100, 'nature', 370 + i, 0.4, 40, 0, 0.6, 2)
        })
    }
}

// ── Bowman: Fan of Arrows ──────────────────────────────────────────────────────────

// The front line: a fan of seven glowing arrows bursts off the bow; three find the front
// ranks, the rest go wide and on out of the scene.
const FAN = { loose: 0.7, fly: 0.22 }
const FAN_SHOTS = [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42] as const
/** Which shots land, and on whom: the front rank's three, near to far. */
const FAN_HITS = [{ shot: 4, foe: 0 }, { shot: 3, foe: 1 }, { shot: 2, foe: 2 }] as const

const fanOfArrows: CinematicVfx = {
    id: 'skill_fan_of_arrows', name: 'Fan of Arrows', source: 'class', owner: 'Bowman', dur: 2.0,
    cinematic: { hits: FAN_HITS.map((_, i) => FAN.loose + FAN.fly + i * 0.06), tint: 'night0', spread: true },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.2, C.gold0, C.gold1, C.gold3)
        // the bow drawn: gold light gathering in an arc at the string
        if (q >= 0.2 && q < FAN.loose) arcBand(d, HAND.x - 4, HAND.y, 7, -1.0, 1.0, 2, pr(t, 0.2, FAN.loose - 0.1), C.gold2, C.white, C.gold1)
        // the release: a fan of light thrown off the bow
        if (q >= FAN.loose && q < FAN.loose + 0.2) arcBand(d, HAND.x, HAND.y, 10, -0.6, 0.6, 4, 1, C.gold3, C.white, C.gold1)
        FAN_SHOTS.forEach((a, s) => {
            const hit = FAN_HITS.find(h => h.shot === s)
            const order = hit ? FAN_HITS.indexOf(hit) : 0
            const t0 = FAN.loose + (hit ? order * 0.06 : s * 0.02)
            const u = travel(t, t0, t0 + FAN.fly * (hit ? 1 : 1.6))
            if (u < 0) return
            const f = hit ? F[hit.foe]! : null
            const x1 = f ? f.x : HAND.x + Math.cos(a) * 200
            const y1 = f ? chestOf(f) : HAND.y + Math.sin(a) * 200
            const x = HAND.x + (x1 - HAND.x) * u
            const y = HAND.y + (y1 - HAND.y) * u
            const ang = Math.atan2(y1 - HAND.y, x1 - HAND.x)
            for (let k = 0; k < 16; k++) {
                const px = R(x - Math.cos(ang) * k)
                const py = R(y - Math.sin(ang) * k)
                d.set(px, py, k < 3 ? C.white : k < 8 ? C.gold3 : C.gold1)
                if (k < 9) d.set(px, py + 1, k < 4 ? C.gold3 : C.gold2)
            }
            tri(d, R(x + Math.cos(ang) * 4), R(y + Math.sin(ang) * 4), R(x - Math.sin(ang) * 3), R(y + Math.cos(ang) * 3), R(x + Math.sin(ang) * 3), R(y - Math.cos(ang) * 3), C.white)
        })
        FAN_HITS.forEach((h, i) => {
            const f = F[h.foe]!
            blast(d, f.x, chestOf(f), t, FAN.loose + FAN.fly + i * 0.06, 9, 0.45, GOLD, 380 + i, 'gold')
        })
    }
}

// ── Marksman: Arrow Rain ───────────────────────────────────────────────────────────

// Every foe: one arrow loosed straight up bursts into a rune high over the enemy line, and a
// rain of glowing arrows pours out of it onto the whole of it.
const RAIN = { up: 0.35, burst: 0.6, pour: 0.75, stop: 1.7 }
const RAIN_HITS = [0.95, 1.2, 1.45]
const SKY = { x: 146, y: 10 }

function fallingArrow(d: Surface, x: number, y: number): void {
    for (let k = 0; k < 7; k++) d.set(R(x - k * 0.35), R(y - k), k < 1 ? C.white : k < 4 ? C.gold3 : C.gold1)
    d.set(R(x) - 1, R(y) - 1, C.gold3); d.set(R(x) + 1, R(y) - 1, C.gold3)
}

const arrowRain: CinematicVfx = {
    id: 'skill_arrow_rain', name: 'Arrow Rain', source: 'class', owner: 'Marksman', dur: 2.4,
    cinematic: { hits: RAIN_HITS, tint: 'night0', spread: true },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.2, C.gold0, C.gold1, C.gold3)
        // the signal arrow, climbing out of sight
        const su = travel(t, RAIN.up, RAIN.burst)
        if (su >= 0) {
            const x = HAND.x + (SKY.x - HAND.x) * su
            const y = HAND.y + (SKY.y - HAND.y) * su - Math.sin(su * Math.PI) * 20
            disc(d, x, y, 2, C.gold3); d.set(R(x), R(y), C.white)
            for (let k = 1; k < 8; k++) d.set(R(x - k * (SKY.x - HAND.x) / 60), R(y + k * 1.2), k < 3 ? C.gold3 : C.gold1)
        }
        // the rune it bursts into, hanging over the enemy line while the rain pours
        if (q >= RAIN.burst && q < RAIN.stop + 0.3) {
            const s = Math.min(1, (q - RAIN.burst) / 0.15, (RAIN.stop + 0.3 - q) / 0.3)
            const rx = 34 * s
            ellipseRing(d, SKY.x, SKY.y, rx, rx * 0.22, C.gold3)
            ellipseRing(d, SKY.x, SKY.y, rx - 4, (rx - 4) * 0.22, C.gold1)
            for (let i = 0; i < 12; i++) {
                const a = q * 2 + i / 12 * Math.PI * 2
                d.set(R(SKY.x + Math.cos(a) * (rx - 2)), R(SKY.y + Math.sin(a) * (rx - 2) * 0.22), i & 1 ? C.gold2 : C.white)
            }
        }
        blast(d, SKY.x, SKY.y, t, RAIN.burst, 8, 0.35, GOLD, 390, 'gold')
        // the rain: arrows falling from the rune onto the whole line, each leaving a puff where it lands
        if (q >= RAIN.pour && q < RAIN.stop + 0.4) for (let i = 0; i < 26; i++) {
            const period = 0.32
            const ph = (q - RAIN.pour) / period + hash2(i, 71)
            const cycle = Math.floor(ph)
            const u = ph - cycle
            const birth = RAIN.pour + (cycle - hash2(i, 71)) * period
            if (birth > RAIN.stop) continue
            const lane = (i % 3)
            const ground = [84, 68, 52][lane]!
            const x = 112 + hash2(i, 72 + cycle) * 64
            const y = SKY.y + (ground - 1 - SKY.y) * u
            fallingArrow(d, x + u * 3, y)
        }
        RAIN_HITS.forEach((h, i) => {
            const f = F[i]!
            blast(d, f.x, chestOf(f), t, h, 9, 0.45, GOLD, 400 + i, 'gold')
        })
        // arrows left standing in the ground
        if (q >= RAIN.pour + 0.3) for (let i = 0; i < 12; i++) {
            const ground = [84, 68, 52][i % 3]!
            const x = R(114 + hash2(i, 81) * 60)
            if (hash2(i, 82) > pr(t, RAIN.pour + 0.3, RAIN.stop)) continue
            line(d, x, ground - 1, x - 1, ground - 5, C.brown2); d.set(x - 1, ground - 6, C.gold2)
        }
    }
}

// ── Beast Master: Man's Best Friend ────────────────────────────────────────────────

// Self only: PWR up. A spirit wolf comes bounding in, wheels to stand at the Beast Master's
// side, and a ring of green-gold light binds the two.
const WOLF_RUN = { from: 0.2, to: 0.85, x0: -20, x1: CX + 16 }

const mansBestFriend: CinematicVfx = {
    id: 'skill_mans_best_friend', name: "Man's Best Friend", source: 'class', owner: 'Beast Master', dur: 2.4,
    cinematic: { hits: [], tint: 'night0', spread: false },
    draw(d, t) {
        const q = qt(t)
        casterRing(d, CX, t, 0, 1.8, C.green1, C.green3, C.gold3)
        const u = pr(t, WOLF_RUN.from, WOLF_RUN.to)
        const x = R(WOLF_RUN.x0 + (WOLF_RUN.x1 - WOLF_RUN.x0) * eo(u))
        if (q >= WOLF_RUN.from) {
            // spirit trail behind the running wolf
            if (u < 1) for (let k = 1; k < 4; k++) motes(d, x - k * 8, FLOOR - 6, 8, 12, t, 3, 'heal', 410 + k, 30)
            drawCreature(d, x, FLOOR, WOLF, u < 1 ? 'move' : 'attack', u < 1 ? q : Math.min(0.25, q - WOLF_RUN.to), 1)
        }
        // the bond: a flash at the wolf's arrival, then a ring of light round the pair
        blast(d, (CX + WOLF_RUN.x1) / 2, FLOOR - 1, t, WOLF_RUN.to, 14, 0.5, NATURE, 420, 'heal', true)
        shockRing(d, (CX + WOLF_RUN.x1) / 2, FLOOR - 1, t, WOLF_RUN.to, 0.5, 6, 30, C.gold3, true)
        if (q >= WOLF_RUN.to + 0.1 && q < 2.4) {
            const cx = (CX + WOLF_RUN.x1) / 2
            for (let i = 0; i < 16; i++) {
                const a = q * 3 + i / 16 * Math.PI * 2
                d.set(R(cx + Math.cos(a) * 16), R(FLOOR - 2 + Math.sin(a) * 4), i & 1 ? C.green3 : C.gold3)
            }
            motes(d, cx, FLOOR - 2, 30, 30, t, 14, 'heal', 430, 30)
            chevrons(d, CX, HEAD_Y - 6, t, true, C.green3, C.gold3)
        }
    }
}

export const CINEMATIC_VFX: readonly CinematicVfx[] = [
    haste, whirlwind, threateningRoar, enrage, shockwave, bouncebolt, lightningStorm, meteorShower, totemStorm,
    piercingArrow, fanOfArrows, arrowRain, killShot, mansBestFriend
]
export const CINEMATIC_BY_ID: Readonly<Record<string, CinematicVfx>> = Object.fromEntries(CINEMATIC_VFX.map(v => [v.id, v]))

// ── Preview stage ──────────────────────────────────────────────────────────────────

const CAST_BY_SKILL: Readonly<Record<string, string>> = {
    skill_haste: 'class_beginner', skill_whirlwind: 'class_warrior', skill_threatening_roar: 'class_barbarian',
    skill_enrage: 'class_berserker', skill_shockwave: 'class_knight', skill_ethereal_bouncebolt: 'class_mage',
    skill_lightning_storm: 'class_wizard', skill_meteor_shower: 'class_sorcerer', skill_totem_storm: 'class_shaman',
    skill_piercing_arrow: 'class_archer', skill_fan_of_arrows: 'class_bowman', skill_arrow_rain: 'class_marksman',
    skill_kill_shot: 'class_hunter', skill_mans_best_friend: 'class_beast_master'
}
const STAGE_ACTOR = new Actor(64)

/**
 * The gallery underlay for a cinematic VFX: night floor, the caster standing on it and a
 * training dummy on every enemy mark — what the reference video stages its skills on.
 */
export function cinematicStage(skillId: string): (d: Surface) => void {
    const classId = CAST_BY_SKILL[skillId]!
    return (d) => {
        rect(d, 0, 0, VL.W, FLOOR, C.void)
        for (let y = 0; y < FLOOR; y += 4) rect(d, 0, y, VL.W, 2, y < FLOOR / 2 ? C.void : C.night0)
        rect(d, 0, FLOOR, VL.W, VL.H - FLOOR, C.night0)
        rect(d, 0, FLOOR, VL.W, 1, C.night2)
        // furthest rank first, so the nearer bodies overlap it
        for (const f of [...F].sort((a, b) => a.g - b.g)) drawCreature(d, f.x, f.g, TRAINING_DUMMY, 'static', 0, -1)
        const art = HERO_ART[classId]!
        STAGE_ACTOR.draw(d, CX, FLOOR, art.look, art.clips.idle, 0)
    }
}
