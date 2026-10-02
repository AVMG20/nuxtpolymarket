// Training Grounds active VFX in the reference-video style (sixth pass, Round 19). Every rarity
// carries the same three kinds of skill (a strike, a self-heal and a Gold burst), so each kind
// climbs a ladder: Common is one simple beat, and every rarity up adds weight, until the Legendary
// and Mythic ones are set-pieces that dim the scene and fill the stage.
//
// The Hero casts them, so they are staged from the Hero's mark (VL.caster), striking the near front
// foe. They replace their round-1 `vfx.ts` entries by ID, as the Hero and Champion effects did.

import { C } from './palette'
import { disc, dither, ditherDisc, ditherEllipse, ellipseRing, hash2, line, poly, rect, ring, taper, tri, type Surface } from './surface'
import { VL, pr, qt, eo, travel, lob, VP, burst, motes, healRise, R } from './vfx-kit'
import {
    arcBand, blast, casterRing, chestOf, chevrons, groundFire, shockRing, skyPortal,
    BLOOD, FIRE, GOLD, STEEL, STORM, TEAL, type Ramp6
} from './vfx-cinematic'
import type { VfxDef } from './vfx'

const F = VL.foes
const CX = VL.caster.x
const FLOOR = VL.floor
const FOE = F[0]
const FC = chestOf(FOE)
const HC = FLOOR - 14
const HEAD = FLOOR - 24
const HAND = { x: CX + 10, y: FLOOR - 13 }

const HEAL: Ramp6 = [C.white, C.green4, C.green4, C.green3, C.teal2, C.teal1]
const EMBER: Ramp6 = [C.white, C.gold3, C.orange, C.orange, C.lava1, C.red1]

function tg(id: string, name: string, owner: string, dur: number, draw: VfxDef['draw']): VfxDef {
    return { id, name, source: 'training', owner, dur, draw }
}

/** The set-pieces' dimming: the whole stage screened toward ink over [t0, t1], easing in and out. */
function dim(d: Surface, t: number, t0: number, t1: number, level = 6): void {
    const q = qt(t)
    if (q < t0 || q >= t1) return
    const k = Math.min(1, (q - t0) / 0.15, (t1 - q) / 0.25)
    dither(d, 0, 0, VL.W, VL.H, C.ink, R(level * k))
}

/** A gold coin at (x, y), spinning: its face narrows to an edge and back with `spin`. */
function coin(d: Surface, x: number, y: number, r: number, spin: number): void {
    const w = Math.max(0.6, Math.abs(Math.cos(spin)) * r)
    ditherEllipse(d, x, y, w + 0.5, r + 0.5, C.gold1, 16)
    ditherEllipse(d, x, y, w, r, C.gold2, 16)
    if (w > 1.5) d.set(R(x - w * 0.4), R(y - r * 0.4), C.gold3)
    if (w > 2) line(d, R(x), R(y - r + 1), R(x), R(y + r - 1), C.gold1)
}

/** A die at (x, y) showing `pips` (1–6) on its face, its top face lit. */
function die(d: Surface, x: number, y: number, pips: number): void {
    x = R(x); y = R(y)
    rect(d, x - 3, y - 3, 7, 7, C.bone1)
    rect(d, x - 3, y - 3, 7, 1, C.white)
    rect(d, x + 3, y - 3, 1, 7, C.stone2); rect(d, x - 3, y + 3, 7, 1, C.stone2)
    const P: Record<number, readonly (readonly [number, number])[]> = {
        1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-2, -2], [0, 0], [2, 2]], 4: [[-2, -2], [2, -2], [-2, 2], [2, 2]],
        5: [[-2, -2], [2, -2], [0, 0], [-2, 2], [2, 2]], 6: [[-2, -2], [2, -2], [-2, 0], [2, 0], [-2, 2], [2, 2]]
    }
    for (const [px, py] of P[pips]!) d.set(x + px, y + py, pips === 6 ? C.red2 : C.ink)
}

/** A four-point glint, `r` px a ray. */
function glint(d: Surface, x: number, y: number, r: number, c: number = C.white): void {
    for (let i = -r; i <= r; i++) { d.set(R(x) + i, R(y), Math.abs(i) < 2 ? C.white : c); d.set(R(x), R(y) + i, Math.abs(i) < 2 ? C.white : c) }
}

// ── Common: one simple beat each ───────────────────────────────────────────────────

const COMMON: VfxDef[] = [
    // a quick steel cut across the front foe
    tg('skill_quick_strike', 'Quick Strike', 'Common', 0.8, (d, t) => {
        if (qt(t) < 0.45) arcBand(d, FOE.x - 4, FC, 9, -2.3, -0.4, 3, pr(t, 0.1, 0.25), C.steel3, C.white, C.steel1)
        blast(d, FOE.x, FC, t, 0.22, 5, 0.3, STEEL, 1000, 'steel')
    }),
    // a calm green ring breathed out round the Hero, a few pluses
    tg('skill_steadying_breath', 'Steadying Breath', 'Common', 1.2, (d, t) => {
        shockRing(d, CX, FLOOR - 1, t, 0.15, 0.6, 3, 14, C.green3, true)
        if (qt(t) > 0.25 && qt(t) < 1.2) healRise(d, CX, HC, t, 1010, C.green4, C.white)
    }),
    // a gold coin flipped up off the thumb, spinning, glinting at the top of its arc
    tg('skill_coin_toss', 'Coin Toss', 'Common', 1.2, (d, t) => {
        const u = travel(t, 0.1, 0.9)
        if (u >= 0) {
            const y = HAND.y - Math.sin(u * Math.PI) * 26
            coin(d, HAND.x + u * 4, y, 3, qt(t) * 18)
            if (u > 0.45 && u < 0.6) glint(d, HAND.x + u * 4 + 4, y - 3, 2, C.gold3)
        }
        if (qt(t) >= 0.9) burst(d, HAND.x + 4, HAND.y, t, 0.9, 8, 30, 'gold', 1020, 0.4)
    })
]

// ── Uncommon: a heavier beat ───────────────────────────────────────────────────────

const UNCOMMON: VfxDef[] = [
    // a broad orange cut swung through the front foe, a solid blast behind it
    tg('skill_focused_blow', 'Focused Blow', 'Uncommon', 1.0, (d, t) => {
        if (qt(t) < 0.5) arcBand(d, FOE.x - 6, FC - 2, 13, -2.5, 0.2, 5, pr(t, 0.12, 0.3), C.orange, C.white, C.lava1)
        blast(d, FOE.x, FC, t, 0.28, 8, 0.4, EMBER, 1100, 'spark')
    }),
    // a heartbeat: two red-green pulses rolling out of the Hero, pluses climbing
    tg('skill_adrenaline_surge', 'Adrenaline Surge', 'Uncommon', 1.3, (d, t) => {
        for (const t0 of [0.15, 0.42]) {
            shockRing(d, CX, HC, t, t0, 0.4, 4, 16, C.red3)
            blast(d, CX, HC, t, t0, 5, 0.25, HEAL, 1110 + R(t0 * 10), 'heal')
        }
        if (qt(t) > 0.45) healRise(d, CX, HC, t, 1115, C.green4, C.red3)
    }),
    // gold nuggets popping up out of the ground at the Hero's feet, sparkling
    tg('skill_prospectors_instinct', 'Prospector\'s Instinct', 'Uncommon', 1.3, (d, t) => {
        for (let i = 0; i < 4; i++) {
            const t0 = 0.15 + i * 0.1
            const u = travel(t, t0, t0 + 0.45)
            const x = CX - 9 + i * 6
            if (u >= 0) {
                const y = FLOOR - 1 - Math.sin(u * Math.PI) * (10 + i * 2)
                disc(d, x, y, 2, C.gold2); d.set(R(x) - 1, R(y) - 1, C.gold3); d.set(R(x) + 1, R(y) + 1, C.gold1)
            }
            if (qt(t) > t0 + 0.45 && qt(t) < 1.3) { disc(d, x, FLOOR - 2, 1.5, C.gold2); if ((Math.floor(qt(t) * 8) + i) % 4 === 0) glint(d, x, FLOOR - 4, 2, C.gold3) }
        }
        burst(d, CX, FLOOR - 2, t, 0.15, 10, 40, 'dust', 1120, 0.5, 80, -Math.PI / 2, 1.6)
    })
]

// ── Rare: a shaped strike, a real flourish ─────────────────────────────────────────

const RARE: VfxDef[] = [
    // a blue lance driven through the foe's guard, shards of its armour bursting off the far side
    tg('skill_piercing_focus', 'Piercing Focus', 'Rare', 1.2, (d, t) => {
        const q = qt(t)
        const u = pr(t, 0.2, 0.35)
        if (q >= 0.2 && q < 0.6) {
            const tip = HAND.x + (FOE.x + 12 - HAND.x) * eo(u)
            const fade = q < 0.45 ? 1 : 1 - (q - 0.45) / 0.15
            for (let dy = -1; dy <= 1; dy++) line(d, HAND.x + 4, FC + dy, R(tip - 6), FC + dy, dy === 0 ? C.white : fade > 0.5 ? C.cyan : C.blue2)
            tri(d, R(tip - 7), FC - 3, R(tip - 7), FC + 3, R(tip), FC, C.frost)
        }
        blast(d, FOE.x, FC, t, 0.33, 9, 0.4, STORM, 1200, 'frost')
        if (q >= 0.33 && q < 0.9) for (let i = 0; i < 7; i++) {
            const age = (q - 0.33) / 0.57
            const a = -0.6 + hash2(i, 1201) * 1.2
            const x = FOE.x + 4 + Math.cos(a) * age * 26
            const y = FC + Math.sin(a) * age * 26 + age * age * 12
            tri(d, R(x), R(y) - 1, R(x) + 2, R(y), R(x), R(y) + 1, C.steel3)
        }
        if (q > 0.5) chevrons(d, FOE.x, FC - 18, t, false, C.steel2, C.white)
    }),
    // a spiral of green leaves and light rising round the Hero, a heal bursting out of it
    tg('skill_vigor_renewal', 'Vigor Renewal', 'Rare', 1.5, (d, t) => {
        const q = qt(t)
        if (q >= 0.1 && q < 1.2) {
            const fade = q < 0.9 ? 1 : 1 - (q - 0.9) / 0.3
            for (let i = 0; i < 10; i++) {
                const v = ((q * 0.9 + i / 10) % 1)
                if (v > fade) continue
                const a = q * 6 + i * 0.63
                const x = CX + Math.cos(a) * 10
                const y = FLOOR - 2 - v * 30 + Math.sin(a) * 3
                tri(d, R(x), R(y), R(x) + 2, R(y) - 1, R(x) + 1, R(y) + 1, Math.sin(a) > 0 ? C.green3 : C.green2)
            }
        }
        blast(d, CX, HC, t, 0.6, 10, 0.45, HEAL, 1210, 'heal')
        if (q > 0.65) healRise(d, CX, HC, t, 1211, C.green4, C.white)
    }),
    // a pair of dice rolled at the front foe, tumbling, landing on sixes, blowing up in gold
    tg('skill_gamblers_strike', 'Gambler\'s Strike', 'Rare', 1.4, (d, t) => {
        const q = qt(t)
        for (let k = 0; k < 2; k++) {
            const u = travel(t, 0.15 + k * 0.06, 0.6 + k * 0.06)
            if (u < 0) continue
            lob(HAND.x, HAND.y, FOE.x - 6 + k * 6, FOE.g - 4, 14 - k * 4, u)
            die(d, VP.x, VP.y, u < 0.92 ? 1 + (Math.floor(q * 14) + k * 3) % 6 : 6)
        }
        if (q >= 0.66 && q < 0.8) { die(d, FOE.x - 6, FOE.g - 4, 6); die(d, FOE.x, FOE.g - 4, 6) }
        blast(d, FOE.x - 3, FC, t, 0.8, 11, 0.45, GOLD, 1220, 'gold')
        if (q >= 0.8) burst(d, FOE.x - 3, FC, t, 0.8, 12, 60, 'gold', 1221, 0.5, 80, -Math.PI / 2, 2.2, 2)
    })
]

// ── Epic: two-part effects ─────────────────────────────────────────────────────────

const EPIC: VfxDef[] = [
    // two cuts crossing through the front foe, the second burning, the burn left licking up its body
    tg('skill_twin_strike', 'Twin Strike', 'Epic', 1.4, (d, t) => {
        const q = qt(t)
        if (q < 0.5) arcBand(d, FOE.x - 4, FC - 2, 13, -2.6, -0.1, 5, pr(t, 0.12, 0.26), C.steel3, C.white, C.steel1)
        if (q >= 0.22 && q < 0.7) arcBand(d, FOE.x + 4, FC - 2, 13, -0.55, -3.0, 5, pr(t, 0.24, 0.38), C.orange, C.gold3, C.red1)
        blast(d, FOE.x, FC, t, 0.25, 7, 0.3, STEEL, 1300, 'steel')
        blast(d, FOE.x, FC, t, 0.38, 10, 0.45, FIRE, 1301, 'ember')
        if (q >= 0.5 && q < 1.4) {
            const fade = q < 1.1 ? 1 : 1 - (q - 1.1) / 0.3
            const f = Math.floor(q * 15)
            for (let i = 0; i < 6; i++) {
                const xx = FOE.x - 6 + i * 2 + (i > 2 ? 2 : 0)
                const h = R((5 + 8 * hash2(f, i)) * fade)
                for (let k = 0; k < h; k++) d.set(xx, FC + 8 - k, k < h * 0.5 ? C.orange : C.red1)
            }
        }
    }),
    // heal and speed: a teal-white column takes the Hero, and he leaves it streaming speed lines
    tg('skill_battlefield_surge', 'Battlefield Surge', 'Epic', 1.5, (d, t) => {
        const q = qt(t)
        const pu = (q - 0.2) / 0.5
        if (pu >= 0 && pu < 1) {
            const half = R(6 * (1 - pu * pu))
            for (let dx = -half; dx <= half; dx++) {
                const k = Math.abs(dx) / Math.max(1, half)
                for (let y = 0; y < FLOOR; y++) if (k < 0.7 || ((y + dx) & 1)) d.set(CX + dx, y, k < 0.3 ? C.white : k < 0.7 ? C.teal3 : C.teal2)
            }
        }
        blast(d, CX, FLOOR - 1, t, 0.2, 10, 0.45, TEAL, 1310, 'water', true)
        if (q >= 0.6 && q < 1.5) {
            for (let i = 0; i < 5; i++) {
                const ph = (q * 3 + hash2(i, 1311)) % 1
                const y = FLOOR - 6 - i * 5
                const x = CX - 7 - ph * 26
                for (let k = 0; k < 8; k++) if (k < 3 || ((k + i) & 1) === 0) d.set(R(x - k), y, k < 2 ? C.white : C.teal3)
            }
            healRise(d, CX, HC, t, 1312, C.green4, C.white)
            chevrons(d, CX, HEAD - 6, t, true, C.teal3, C.white)
        }
    }),
    // a wealth-scaled hit and a Gold burst: a sack of gold hurled at the front foe bursts on it,
    // coins spraying out and showering back down round the Hero
    tg('skill_treasure_hunters_gambit', 'Treasure Hunter\'s Gambit', 'Epic', 1.7, (d, t) => {
        const q = qt(t)
        const u = travel(t, 0.15, 0.55)
        if (u >= 0) {
            lob(HAND.x, HAND.y, FOE.x, FC, 18, u)
            disc(d, VP.x, VP.y + 1, 4, C.brown1); disc(d, VP.x - 1, VP.y, 3, C.brown2)
            rect(d, R(VP.x) - 1, R(VP.y) - 5, 3, 2, C.gold2); d.set(R(VP.x), R(VP.y) - 6, C.gold3)
        }
        blast(d, FOE.x, FC, t, 0.55, 12, 0.5, GOLD, 1320, 'gold')
        // coins sprayed out of the burst, arcing back over to rain round the Hero
        for (let i = 0; i < 12; i++) {
            const cu = travel(t, 0.55 + i * 0.03, 1.25 + i * 0.03)
            if (cu < 0) continue
            lob(FOE.x, FC, CX - 14 + i * 2.5, FLOOR - 2, 24 + hash2(i, 1321) * 12, cu)
            coin(d, VP.x, VP.y, 2, q * 16 + i)
        }
        if (q > 1.2) for (let i = 0; i < 4; i++) if ((Math.floor(q * 8) + i) % 3 === 0) glint(d, CX - 10 + i * 6, FLOOR - 4, 2, C.gold3)
    })
]

// ── Legendary: set-pieces ──────────────────────────────────────────────────────────

const LEGENDARY: VfxDef[] = [
    // the foe marked, the stage darkening; a colossal spectral executioner's axe forms high over it
    // and comes down through it in one stroke, splitting the ground in a red shock
    tg('skill_executioners_edge', 'Executioner\'s Edge', 'Legendary', 2.1, (d, t) => {
        const q = qt(t)
        dim(d, t, 0.1, 1.6, 6)
        casterRing(d, CX, t, 0, 1.2, C.red0, C.red1, C.red3)
        // the axe: a crescent blade on a long haft, swung down from the upper left
        const SWING = { from: 0.7, to: 0.88 }
        if (q >= 0.3 && q < 1.05) {
            const form = pr(t, 0.3, 0.6)
            // pivoting low and behind the foe, so the head comes up and over and down onto it in frame
            const a = q < SWING.from ? -2.6 : -2.6 + 2.6 * eo(pr(t, SWING.from, SWING.to))
            const px = FOE.x - 40
            const py = FC + 2
            const L = 40
            const hx = px + Math.cos(a) * L
            const hy = py + Math.sin(a) * L
            const fade = q < 0.95 ? 1 : 1 - (q - 0.95) / 0.1
            if (form > 0.2 && fade > 0) {
                line(d, R(px), R(py), R(hx), R(hy), C.red1); line(d, R(px) + 1, R(py), R(hx) + 1, R(hy), C.red0)
                // the blade, a broad crescent across the haft's head, a white edge on its cutting side
                const ba = a + Math.PI / 2
                for (let k = -9; k <= 9; k++) {
                    const w = Math.round(5 * Math.cos(k / 9 * Math.PI / 2) * form)
                    for (let j = 0; j <= w; j++) {
                        const x = hx + Math.cos(ba) * k - Math.cos(a) * j
                        const y = hy + Math.sin(ba) * k - Math.sin(a) * j
                        d.set(R(x), R(y), j === 0 ? C.white : j < 2 ? C.red3 : j < 4 ? C.red2 : C.red1)
                    }
                }
            }
            // the stroke's trail: a great red crescent swept behind the blade as it falls
            if (q >= SWING.from && q < SWING.to + 0.15) arcBand(d, px, py, L, -2.6, -2.6 + 2.6 * eo(pr(t, SWING.from, SWING.to)), 8, 1, C.red2, C.white, C.red0)
        }
        // the mark over the foe while the axe forms
        if (q >= 0.15 && q < SWING.to) {
            const r = R(12 - pr(t, 0.15, 0.6) * 5)
            ring(d, FOE.x, FC - 24, r, C.red2)
            rect(d, FOE.x - 2, FC - 27, 5, 4, C.red3); rect(d, FOE.x - 1, FC - 23, 3, 2, C.red3)
            d.set(FOE.x - 1, FC - 26, C.ink); d.set(FOE.x + 1, FC - 26, C.ink)
        }
        // the cleave: a white flash line split down the foe, the blast, the ground torn open
        if (q >= SWING.to && q < SWING.to + 0.12) for (let y = FC - 30; y < FOE.g; y++) { d.set(FOE.x, y, C.white); d.set(FOE.x + 1, y, C.red3) }
        blast(d, FOE.x, FC, t, SWING.to, 20, 0.7, BLOOD, 1400, 'blood')
        shockRing(d, FOE.x, FOE.g - 1, t, SWING.to, 0.6, 6, 44, C.red3, true)
        shockRing(d, FOE.x, FC, t, SWING.to + 0.04, 0.45, 8, 32, C.white)
        if (q >= SWING.to && q < 2.1) {
            const L = R(30 * eo(pr(t, SWING.to, SWING.to + 0.2)))
            for (let k = -L; k <= L; k++) d.set(FOE.x + k, FOE.g - 1 + (hash2(k, 1401) > 0.6 ? 1 : 0), Math.abs(k) < L - 3 ? C.red0 : C.red2)
        }
        burst(d, FOE.x + 3, FC, t, SWING.to, 26, 120, 'blood', 1402, 0.6, 80, 0, 1.4, 2)
    }),
    // the Hero rises out of a burst of fire as a phoenix: great wings of flame unfold from his back
    // and beat once, a pillar of fire climbs off him, and burning feathers drift down healing him
    tg('skill_phoenix_draught', 'Phoenix Draught', 'Legendary', 2.2, (d, t) => {
        const q = qt(t)
        dim(d, t, 0.1, 1.8, 5)
        casterRing(d, CX, t, 0, 1.6, C.lava0, C.orange, C.gold3)
        blast(d, CX, HC, t, 0.35, 14, 0.6, FIRE, 1410, 'ember')
        // the wings: from each shoulder an arm of flame sweeps up and out, broad feathers hanging
        // off it, unfolding and then giving one great beat
        if (q >= 0.45 && q < 1.9) {
            const open = eo(pr(t, 0.45, 0.75))
            const beat = Math.sin(pr(t, 0.9, 1.3) * Math.PI)
            const fade = q < 1.6 ? 1 : 1 - (q - 1.6) / 0.3
            const k = open * fade
            for (const side of [-1, 1]) {
                const sx = CX + side * 3
                const sy = HC - 6
                // the arm: a curve up and out to the wing tip, which dips on the beat
                const tx = sx + side * 34 * k
                const ty = sy - (24 - beat * 14) * k
                const arm = (u: number) => ({ x: sx + (tx - sx) * u, y: sy + (ty - sy) * u - Math.sin(u * Math.PI) * 6 * k })
                // feathers hanging off the arm, longest at the tip, fanning down and out
                for (let f = 7; f >= 0; f--) {
                    const u = 0.15 + f * 0.12
                    const p = arm(u)
                    const L = (8 + f * 3) * k
                    const ang = Math.PI / 2 - side * (0.25 + f * 0.11)
                    const ex = p.x + Math.cos(ang) * L
                    const ey = p.y + Math.sin(ang) * L
                    taper(d, p.x, p.y, ex, ey, 4, 1, f > 5 ? C.gold3 : f > 2 ? C.orange : C.lava1)
                    d.set(R(ex), R(ey), f > 4 ? C.white : C.gold3)
                }
                // the leading edge of the arm, white-hot
                for (let i = 0; i <= 20; i++) { const p = arm(i / 20); d.set(R(p.x), R(p.y), i > 14 ? C.white : C.gold3); d.set(R(p.x), R(p.y) + 1, C.orange) }
            }
        }
        // the pillar of fire climbing off him, and the phoenix's cry: a ring of flame thrown out on the beat
        if (q >= 0.55 && q < 1.5) {
            const h = R(eo(pr(t, 0.55, 0.8)) * 70)
            const f = Math.floor(q * 15)
            for (let dx = -4; dx <= 4; dx++) {
                const k = Math.abs(dx) / 4
                const top = FLOOR - R(h * (1 - k * k * 0.5)) - R(hash2(f, dx + 9) * 5)
                for (let y = Math.max(0, top); y < FLOOR - 26; y++) d.set(CX + dx, y, k < 0.4 ? C.gold3 : k < 0.75 ? C.orange : C.lava1)
            }
        }
        shockRing(d, CX, HC - 6, t, 1.1, 0.5, 8, 40, C.gold3)
        // burning feathers drifting down, healing as they fall
        if (q >= 0.9 && q < 2.2) for (let i = 0; i < 12; i++) {
            const ph = ((q - 0.9) * 0.6 + hash2(i, 1411)) % 1
            const x = R(CX - 28 + hash2(i, 1412) * 56 + Math.sin(q * 4 + i) * 3)
            const y = R(10 + ph * 74)
            d.set(x, y, C.gold3); d.set(x + 1, y + 1, C.orange); d.set(x - 1, y + 1, C.lava1)
        }
        if (q > 1.0) healRise(d, CX, HC, t, 1413, C.gold3, C.white)
    }),
    // a great wheel of fortune spins up over the front foe, slows, and lands on the jackpot; the
    // wheel pays out twice, two gold strikes down onto the foe, coins bursting off each
    tg('skill_fortunes_gambit', 'Fortune\'s Gambit', 'Legendary', 2.2, (d, t) => {
        const q = qt(t)
        dim(d, t, 0.1, 1.8, 6)
        casterRing(d, CX, t, 0, 1.4, C.gold0, C.gold1, C.gold3)
        const W = { x: FOE.x, y: 20, r: 13 }
        if (q >= 0.2 && q < 1.7) {
            const s = Math.min(1, (q - 0.2) / 0.2, (1.7 - q) / 0.2)
            const r = W.r * s
            // spin: fast, easing to rest on the jackpot wedge at the top
            const spin = q < 1.0 ? q * 14 : 14 - (1 - Math.pow(1 - pr(t, 1.0, 1.15), 2)) * 0.5 + 0.5
            disc(d, W.x, W.y, r + 1, C.gold1)
            for (let i = 0; i < 8; i++) {
                const a0 = spin + i / 8 * Math.PI * 2
                const a1 = a0 + Math.PI * 2 / 8
                tri(d, W.x, W.y, R(W.x + Math.cos(a0) * r), R(W.y + Math.sin(a0) * r), R(W.x + Math.cos(a1) * r), R(W.y + Math.sin(a1) * r), i === 0 ? C.gold3 : i & 1 ? C.purple1 : C.red1)
            }
            ring(d, W.x, W.y, r, C.gold2)
            disc(d, W.x, W.y, 2, C.gold3)
            // the pointer at the top, and lights chasing round the rim
            tri(d, W.x - 2, W.y - r - 4, W.x + 2, W.y - r - 4, W.x, W.y - r, C.white)
            for (let i = 0; i < 12; i++) if ((i + Math.floor(q * 12)) % 3 === 0) {
                const a = i / 12 * Math.PI * 2
                d.set(R(W.x + Math.cos(a) * (r + 1)), R(W.y + Math.sin(a) * (r + 1)), C.white)
            }
            if (q >= 1.15 && (Math.floor(q * 10) & 1)) glint(d, W.x, W.y - r + 2, 4, C.gold3)
        }
        // the payout: two strikes of gold down onto the foe, coins bursting off each
        for (const [k, at] of [[0, 1.25], [1, 1.5]] as const) {
            if (q >= at - 0.08 && q < at + 0.12) for (let dx = -2; dx <= 2; dx++) for (let y = W.y + W.r; y < FC; y++) d.set(FOE.x + dx, y, Math.abs(dx) < 1 ? C.white : C.gold3)
            blast(d, FOE.x, FC, t, at, 14, 0.5, GOLD, 1420 + k, 'gold')
            burst(d, FOE.x, FC, t, at, 18, 80, 'gold', 1422 + k, 0.6, 100, -Math.PI / 2, 2.4, 2)
        }
    })
]

// ── Mythic: the biggest the stage holds ────────────────────────────────────────────

const MYTHIC: VfxDef[] = [
    // the sky tears open over the enemy line, and a burning greatsword the size of the stage falls
    // through the portal onto the front foe: the ground erupts in fire, shock rings roll across
    // the whole field, embers rain down and the burn is left raging
    tg('skill_ragnarok_strike', 'Ragnarok Strike', 'Mythic', 2.6, (d, t) => {
        const q = qt(t)
        dim(d, t, 0.05, 2.2, 8)
        casterRing(d, CX, t, 0, 1.6, C.red1, C.orange, C.gold3)
        skyPortal(d, FOE.x, 8, t, 0.2, 1.4)
        const FALL = { from: 0.75, to: 1.0 }
        // the sword: a broad burning blade point down, guard and grip above, falling out of the portal
        if (q >= FALL.from && q < FALL.to + 0.35) {
            const u = eo(pr(t, FALL.from, FALL.to))
            const tip = R(-40 + (FOE.g - 4 + 40) * u)
            const sink = q < FALL.to ? 0 : R(pr(t, FALL.to, FALL.to + 0.08) * 6)
            const fade = q < FALL.to + 0.2 ? 1 : 1 - (q - FALL.to - 0.2) / 0.15
            if (fade > 0) {
                const y0 = tip + sink
                for (let k = 0; k < 62; k++) {
                    const y = y0 - k
                    const w = k < 8 ? R(k * 0.9) : 7
                    for (let dx = -w; dx <= w; dx++) d.set(FOE.x + dx, y, dx === -w ? C.white : dx < 0 ? C.gold3 : dx < w - 1 ? C.orange : C.lava1)
                }
                rect(d, FOE.x - 15, y0 - 66, 31, 5, C.gold1); rect(d, FOE.x - 15, y0 - 66, 31, 1, C.gold3)
                rect(d, FOE.x - 2, y0 - 78, 5, 12, C.brown1); disc(d, FOE.x, y0 - 81, 3.5, C.red2)
                // flames streaming up off the falling blade
                if (q < FALL.to) for (let i = 0; i < 10; i++) {
                    const fx = FOE.x - 8 + hash2(i, 1501 + Math.floor(q * 15)) * 16
                    for (let k = 0; k < 6; k++) d.set(R(fx), y0 - 62 - k * 2 - R(hash2(i, k) * 2), k < 2 ? C.gold3 : k < 4 ? C.orange : C.red1)
                }
            }
        }
        // the impact: a white flash across the stage, a towering fire blast, rings across the whole field
        // the flash: a burst of white light round the impact, thinning outward
        if (q >= FALL.to && q < FALL.to + 0.08) { ditherDisc(d, FOE.x, FOE.g - 10, 60, C.white, 4); ditherDisc(d, FOE.x, FOE.g - 10, 34, C.white, 10); disc(d, FOE.x, FOE.g - 10, 16, C.white) }
        blast(d, FOE.x, FOE.g - 1, t, FALL.to, 26, 0.8, FIRE, 1500, 'ember', true)
        blast(d, FOE.x, FC - 8, t, FALL.to + 0.05, 16, 0.6, FIRE, 1502, 'ember')
        shockRing(d, FOE.x, FOE.g - 1, t, FALL.to, 0.8, 6, 110, C.white, true)
        shockRing(d, FOE.x, FOE.g - 1, t, FALL.to + 0.1, 0.8, 4, 80, C.orange, true)
        burst(d, FOE.x, FOE.g - 2, t, FALL.to, 30, 140, 'ember', 1503, 0.9, 160, -Math.PI / 2, 2.0, 2)
        // the burn left raging round the foe, embers raining over the whole field
        groundFire(d, FOE.x, 30, t, FALL.to + 0.2, 2.6, 1504, 16)
        if (q > FALL.to + 0.2) motes(d, VL.W / 2, VL.H, VL.W, 90, t, 26, 'ember', 1505, 30)
        if (q > FALL.to + 0.3) for (let i = 0; i < 14; i++) {
            const ph = ((q - FALL.to) * 0.8 + hash2(i, 1506)) % 1
            d.set(R(hash2(i, 1507) * VL.W), R(ph * VL.H), ph < 0.5 ? C.gold3 : C.orange)
        }
    }),
    // a colossal aegis of gold and teal forms over the Hero out of a ring of runes; light pours
    // down through it, every debuff is burned out of him, and its glow washes out over the party
    tg('skill_aegis_of_renewal', 'Aegis of Renewal', 'Mythic', 2.6, (d, t) => {
        const q = qt(t)
        dim(d, t, 0.05, 2.2, 7)
        casterRing(d, CX, t, 0, 2.2, C.gold0, C.gold2, C.white)
        // a great ring of runes in the air over the Hero
        if (q >= 0.2 && q < 2.3) {
            const s = Math.min(1, (q - 0.2) / 0.3, (2.3 - q) / 0.3)
            ellipseRing(d, CX, HC - 4, 30 * s, 30 * s * 0.9, C.gold2)
            ellipseRing(d, CX, HC - 4, 27 * s, 27 * s * 0.9, C.teal2)
            for (let i = 0; i < 16; i++) {
                const a = q * 1.5 + i / 16 * Math.PI * 2
                d.set(R(CX + Math.cos(a) * 28.5 * s), R(HC - 4 + Math.sin(a) * 28.5 * s * 0.9), i & 1 ? C.white : C.gold3)
            }
        }
        // the aegis: a towering kite shield of gold, a teal field, a white cross, forming out of light
        if (q >= 0.6 && q < 2.3) {
            const s = eo(pr(t, 0.6, 0.85)) * (q < 2.0 ? 1 : 1 - (q - 2.0) / 0.3)
            const x = CX
            const y = HC - 6
            const w = R(16 * s)
            const h = R(20 * s)
            if (w > 1) {
                const pts = [-w, -h, w, -h, w, R(h * 0.2), 0, h + 4, -w, R(h * 0.2)]
                poly(d, pts, x, y, C.gold1)
                poly(d, pts.map(v => v === 0 ? 0 : v > 0 ? v - 2 : v + 2), x, y, C.teal2)
                poly(d, pts.map(v => v === 0 ? 0 : v > 0 ? v - 3 : v + 3), x, y, C.teal1)
                ditherDisc(d, x, y, w, C.teal3, 4)
                rect(d, x - 1, y - h + 4, 3, h * 2 - 4, C.white); rect(d, x - w + 5, y - 4, w * 2 - 9, 3, C.white)
                rect(d, x - w, y - h, w * 2, 1, C.gold3)
                // the glint sweeping once across its face
                const g = pr(t, 0.95, 1.3)
                if (g > 0 && g < 1) {
                    const gx = x - w + g * w * 2
                    for (let dy = -h + 1; dy < h; dy++) d.set(R(gx + dy * 0.4), y + dy, C.white)
                }
            }
        }
        // light pouring down through it onto the Hero, the debuffs burned out of him as dark motes turning white
        if (q >= 0.9 && q < 1.8) {
            for (let dx = -3; dx <= 3; dx++) for (let y = 0; y < FLOOR; y++) if (Math.abs(dx) < 2 || ((y + dx) & 1)) d.set(CX + dx, y, Math.abs(dx) < 1 ? C.white : C.gold3)
            for (let i = 0; i < 10; i++) {
                const ph = ((q - 0.9) * 1.5 + hash2(i, 1511)) % 1
                d.set(R(CX - 8 + hash2(i, 1512) * 16), R(HC + 8 - ph * 30), ph < 0.4 ? C.purple0 : ph < 0.7 ? C.purple2 : C.white)
            }
        }
        blast(d, CX, HC, t, 0.9, 16, 0.7, [C.white, C.gold3, C.gold3, C.teal3, C.teal2, C.teal1], 1510, 'gold')
        shockRing(d, CX, FLOOR - 1, t, 1.0, 0.8, 6, 70, C.gold3, true)
        shockRing(d, CX, FLOOR - 1, t, 1.15, 0.8, 4, 50, C.teal3, true)
        if (q > 1.1) { healRise(d, CX, HC, t, 1513, C.green4, C.white); chevrons(d, CX, HEAD - 8, t, true, C.gold3, C.white) }
    }),
    // a golden portal opens over the enemy line and a king's ransom pours out of it: a torrent of
    // coins crashing down onto the front foe, a crown coming down last in a blast of gold, the
    // Hero showered in coin and stars of XP
    tg('skill_kings_ransom', 'King\'s Ransom', 'Mythic', 2.6, (d, t) => {
        const q = qt(t)
        dim(d, t, 0.05, 2.2, 7)
        casterRing(d, CX, t, 0, 2.0, C.gold0, C.gold2, C.gold3)
        // the vault: a ring of gold in the sky over the front foe, swirling
        if (q >= 0.2 && q < 1.9) {
            const s = Math.min(1, (q - 0.2) / 0.25, (1.9 - q) / 0.3)
            ditherEllipse(d, FOE.x, 8, 24 * s, 6 * s, C.gold1, 10)
            ellipseRing(d, FOE.x, 8, 24 * s, 6 * s, C.gold3)
            ellipseRing(d, FOE.x, 8, 18 * s, 4.5 * s, C.white)
            for (let i = 0; i < 10; i++) {
                const a = q * 4 + i / 10 * Math.PI * 2
                d.set(R(FOE.x + Math.cos(a) * 21 * s), R(8 + Math.sin(a) * 5 * s), C.white)
            }
        }
        // the torrent: coins pouring down onto the foe, spinning
        if (q >= 0.45 && q < 1.5) for (let i = 0; i < 26; i++) {
            const period = 0.35
            const ph = (q - 0.45) / period + hash2(i, 1521)
            const u = ph % 1
            const birth = 0.45 + (Math.floor(ph) - hash2(i, 1521)) * period
            if (birth > 1.2) continue
            const x = FOE.x - 14 + hash2(i, 1522 + Math.floor(ph)) * 28
            coin(d, x, 10 + u * (FC + 4), 2.5, q * 14 + i)
        }
        for (let k = 0; k < 4; k++) blast(d, FOE.x - 6 + k * 4, FC, t, 0.7 + k * 0.12, 8, 0.35, GOLD, 1523 + k, 'gold')
        // the crown, coming down last in a blast of gold
        const cu = pr(t, 1.3, 1.5)
        if (q >= 1.3 && q < 1.6) {
            const y = R(4 + (FC - 4) * eo(cu))
            rect(d, FOE.x - 8, y, 17, 5, C.gold2); rect(d, FOE.x - 8, y + 4, 17, 1, C.gold1)
            for (let i = 0; i < 5; i++) tri(d, FOE.x - 8 + i * 4, y, FOE.x - 6 + i * 4, y, FOE.x - 7 + i * 4, y - 6, C.gold3)
            d.set(FOE.x, y + 2, C.red2); d.set(FOE.x - 4, y + 2, C.cyan); d.set(FOE.x + 4, y + 2, C.cyan)
        }
        if (q >= 1.5 && q < 1.56) dither(d, 0, 0, VL.W, VL.H, C.gold3, 6)
        blast(d, FOE.x, FC, t, 1.5, 24, 0.8, GOLD, 1530, 'gold')
        shockRing(d, FOE.x, FOE.g - 1, t, 1.5, 0.8, 6, 100, C.gold3, true)
        burst(d, FOE.x, FC, t, 1.5, 30, 130, 'gold', 1531, 0.8, 120, -Math.PI / 2, 2.6, 2)
        // the payout to the Hero: coins arcing back to rain round him, stars of XP rising
        for (let i = 0; i < 14; i++) {
            const pu = travel(t, 1.55 + i * 0.03, 2.2 + i * 0.03)
            if (pu < 0) continue
            lob(FOE.x, FC, CX - 16 + i * 2.4, FLOOR - 2, 30 + hash2(i, 1532) * 14, pu)
            coin(d, VP.x, VP.y, 2, q * 16 + i)
        }
        if (q > 1.7) for (let i = 0; i < 6; i++) {
            const ph = ((q - 1.7) * 1.2 + hash2(i, 1533)) % 1
            glint(d, CX - 12 + hash2(i, 1534) * 24, HC + 8 - ph * 34, 2, C.cyan)
        }
    })
]

export const TRAINING_STYLED: readonly VfxDef[] = [...COMMON, ...UNCOMMON, ...RARE, ...EPIC, ...LEGENDARY, ...MYTHIC]
export const TRAINING_STYLED_BY_ID: Readonly<Record<string, VfxDef>> = Object.fromEntries(TRAINING_STYLED.map(v => [v.id, v]))

