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
import { disc, ellipseRing, ditherEllipse, hash2, line, rect, type Surface } from './surface'
import { VL, pr, qt, inWin, eo, burst, motes, R } from './vfx-kit'
import { Actor } from './rig'
import { HERO_ART } from './heroes'
import { drawCreature } from './creature'
import { TRAINING_DUMMY } from './raids'
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

// ── The four ───────────────────────────────────────────────────────────────────────

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

// Whirlwind reaches the front line only: a blood-red cyclone tears across and grinds there.
const WW = { launch: 0.8, arrive: 1.15, leave: 1.9 }
const WW_HITS = [1.2, 1.45, 1.7]

function cyclone(d: Surface, x: number, t: number, grow: number): void {
    const q = qt(t)
    const layers = 7
    for (let i = 0; i < layers; i++) {
        const u = i / (layers - 1)
        const y = FLOOR - 2 - u * 26 * grow
        const r = (5 + u * 9) * grow
        const a = q * 14 + i * 0.9
        const c = i & 1 ? C.red2 : C.red1
        // each layer: a flat spinning crescent
        const n = R(r * 5)
        for (let k = 0; k < n; k++) {
            const aa = a + k / n * Math.PI * 1.3
            const px = R(x + Math.cos(aa) * r)
            const py = R(y + Math.sin(aa) * r * 0.32)
            d.set(px, py, k > n - 3 ? C.white : c)
            if (k > n * 0.25) d.set(px, py - 1, k > n - 4 ? C.red3 : C.red2)
            if (k > n * 0.6) d.set(px, py + 1, C.red1)
        }
    }
    burst(d, x, FLOOR - 1, t, q - 0.1, 6, 40, 'dust', 90 + Math.floor(q * 10), 0.3, 0, Math.PI, Math.PI)
}

const whirlwind: CinematicVfx = {
    id: 'skill_whirlwind', name: 'Whirlwind', source: 'class', owner: 'Warrior', dur: 2.3,
    cinematic: { hits: WW_HITS, tint: 'dusk0', spread: false },
    draw(d, t) {
        casterRing(d, CX, t, 0, 1.0, C.red0, C.red1, C.red2)
        const q = qt(t)
        const tx = F[0].x
        if (q >= WW.launch && q < WW.leave + 0.3) {
            const x = q < WW.arrive ? CX + (tx - CX) * eo(pr(t, WW.launch, WW.arrive)) : tx
            const grow = q < WW.leave ? Math.min(1, (q - WW.launch) / 0.2 + 0.4) : Math.max(0, 1 - (q - WW.leave) / 0.3)
            cyclone(d, x, t, grow)
            if (q < WW.arrive) for (let k = 1; k < 5; k++) rect(d, x - 8 - k * 5, FLOOR - 4 - k * 3, 4, 1, k < 2 ? C.red2 : C.red1)
        }
        WW_HITS.forEach((h, i) => {
            const age = (q - h) / 0.35
            if (age >= 0 && age < 1) {
                // a big crescent swipe through the target, alternating direction each tick
                const flip = i & 1 ? -1 : 1
                const a0 = flip > 0 ? -2.4 : -0.7
                const a1 = flip > 0 ? 0.5 : -3.8
                const cy = CHEST + 4 - i * 3
                if (age < 0.7) arcBand(d, tx, cy, 13, a0, a1, 6, age * 3, age < 0.35 ? C.red2 : C.red1, C.white, C.red0)
            }
            blast(d, tx + 2, CHEST, t, h + 0.05, 5 + i * 2, 0.35, BLOOD, 110 + i, 'blood')
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

export const CINEMATIC_VFX: readonly CinematicVfx[] = [haste, whirlwind, meteorShower, killShot]
export const CINEMATIC_BY_ID: Readonly<Record<string, CinematicVfx>> = Object.fromEntries(CINEMATIC_VFX.map(v => [v.id, v]))

// ── Preview stage ──────────────────────────────────────────────────────────────────

const CAST_BY_SKILL: Readonly<Record<string, string>> = {
    skill_haste: 'class_beginner', skill_whirlwind: 'class_warrior',
    skill_meteor_shower: 'class_sorcerer', skill_kill_shot: 'class_hunter'
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
