// Champion ability VFX in the reference-video style (sixth pass, from Round 15): the same kit as
// the Hero cinematics — filled blobs, crescents and comets, `blast` impacts — but short, and
// without the cinematic's rune ring, tint and held stage, since five Champions cast all fight.
//
// Like every ability effect they are drawn in the VL layout as pure functions of time. The live
// stage plays them in fixed VL space whichever Champion casts, so each is staged at its target.
// They replace their round-1 `vfx.ts` entries by ID, as the cinematics do the Hero skills'.

import { C } from './palette'
import { disc, ditherDisc, ditherEllipse, ellipseRing, hash2, line, poly, rect, ring, tri, type Surface } from './surface'
import { VL, pr, qt, eo, travel, lob, VP, burst, motes, stunStars, healRise, R } from './vfx-kit'
import { abilityId, CHAMPIONS } from '../../../shared/utils/hero-quest/content/champions'
import type { ChampionArchetype } from '../../../shared/utils/hero-quest/types'
import { Actor } from './rig'
import { HERO_ART } from './heroes'
import { CHASSIS, championLook } from './champions'
import { drawCreature } from './creature'
import { TRAINING_DUMMY } from './raids'
import { arcBand, blast, comet, chestOf, chevrons, groundFire, shockRing, BLOOD, FIRE, GOLD, STEEL, STORM, type Ramp6 } from './vfx-cinematic'
import type { VfxDef } from './vfx'

const F = VL.foes
const CX = VL.caster.x
const FLOOR = VL.floor
/** Where a Champion's shot leaves from: the front of the party. */
const MUZZLE = { x: CX + 12, y: FLOOR - 14 }

const ORANGE: Ramp6 = [C.white, C.gold3, C.orange, C.orange, C.lava1, C.red1]

function champ(name: string, owner: string, dur: number, draw: VfxDef['draw']): VfxDef {
    return { id: abilityId(name), name, source: 'champion', owner, dur, draw }
}

// ── Damage ─────────────────────────────────────────────────────────────────────────

const DAMAGE: VfxDef[] = [
    // the front line: one great steel crescent cut down through every rank of it
    champ('Cleave', 'Damage', 1.1, (d, t) => {
        const u = pr(t, 0.15, 0.4)
        if (qt(t) < 0.6) arcBand(d, F[1].x - 12, chestOf(F[1]), 26, -1.35, 1.35, 7, u, C.steel3, C.white, C.steel1)
        for (let i = 0; i < 3; i++) {
            const f = F[i]!
            blast(d, f.x, chestOf(f), t, 0.22 + (2 - i) * 0.05, 8, 0.4, STEEL, 500 + i, 'steel')
        }
    }),
    // a column: a frost bolt driven straight through the front foe and the one behind it
    champ('Piercing Bolt', 'Damage', 1.1, (d, t) => {
        const y = chestOf(F[0])
        const x1 = VL.W + 10
        const u = travel(t, 0.15, 0.5)
        if (u >= 0) comet(d, MUZZLE.x + (x1 - MUZZLE.x) * u, MUZZLE.y + (y - MUZZLE.y) * Math.min(1, u * 4), 0, 3, STORM, t, 510)
        for (const [i, f] of [F[0], F[3]].entries()) {
            const at = 0.15 + (f.x - MUZZLE.x) / (x1 - MUZZLE.x) * 0.35
            blast(d, f.x, y, t, at, 9 - i * 2, 0.4, STORM, 511 + i, 'frost')
        }
    }),
    // a burn on one foe: the ground under it glows, then a pillar of fire bursts up through it
    champ('Rising Flame', 'Damage', 1.4, (d, t) => {
        const f = F[0]
        const q = qt(t)
        if (q >= 0.1 && q < 0.35) {
            const u = pr(t, 0.1, 0.35)
            for (let i = 0; i < 6; i++) d.set(R(f.x - 8 * u + i * 3 * u), FLOOR - 1, i & 1 ? C.orange : C.lava1)
        }
        if (q >= 0.35 && q < 0.95) {
            const h = R(eo(pr(t, 0.35, 0.5)) * 44 * (q < 0.8 ? 1 : 1 - (q - 0.8) / 0.15))
            const fr = Math.floor(q * 15)
            for (let dx = -5; dx <= 5; dx++) {
                const k = Math.abs(dx) / 5
                const top = FLOOR - R(h * (1 - k * k * 0.6)) - R(hash2(fr, dx + 9) * 4)
                for (let y = top; y < FLOOR; y++) {
                    const v = (FLOOR - y) / Math.max(1, h)
                    d.set(f.x + dx, y, k < 0.35 ? (v > 0.7 ? C.gold3 : C.white) : k < 0.7 ? (v > 0.6 ? C.orange : C.gold2) : C.lava1)
                }
            }
        }
        blast(d, f.x, FLOOR - 1, t, 0.35, 12, 0.5, FIRE, 520, 'ember', true)
        groundFire(d, f.x, 14, t, 0.6, 1.4, 521)
        if (q > 0.6) motes(d, f.x, chestOf(f), 12, 24, t, 6, 'ember', 522, 24)
    }),
    // one foe: the world darkens round it as a death mark locks on, two huge cuts cross through
    // it in an X, and a beat later the cut lands — a blast of blood, the mark shattering
    champ('Execute Strike', 'Damage', 1.4, (d, t) => {
        const f = F[0]
        const cy = chestOf(f)
        const q = qt(t)
        const CUT = [0.5, 0.58] as const
        const LAND = 0.78
        // the dark closing in round the target while the mark locks on
        if (q >= 0.15 && q < LAND + 0.05) ditherDisc(d, f.x, cy - 6, 28, C.ink, R(4 + pr(t, 0.15, 0.45) * 6))
        // the mark: a big skull, inked so it stands off anything behind it, in a closing ring
        if (q >= 0.08 && q < LAND) {
            const u = pr(t, 0.08, 0.4)
            const my = cy - 26
            ring(d, f.x, my, R(14 - u * 5), C.red2)
            ring(d, f.x, my, R(15 - u * 5), C.red0)
            const c = Math.floor(q * 10) & 1 ? C.red3 : C.red2
            rect(d, f.x - 5, my - 5, 11, 8, C.ink); rect(d, f.x - 3, my + 3, 7, 4, C.ink)
            rect(d, f.x - 4, my - 4, 9, 6, c); rect(d, f.x - 2, my + 2, 5, 3, c)
            rect(d, f.x - 3, my - 2, 2, 2, C.ink); rect(d, f.x + 2, my - 2, 2, 2, C.ink); d.set(f.x, my + 1, C.ink)
            d.set(f.x - 1, my + 4, C.ink); d.set(f.x + 1, my + 4, C.ink)
            d.set(f.x - 3, my - 4, C.white)
        }
        // the two cuts: a long white line flashed across, a thick red crescent sweeping behind it
        CUT.forEach((c0, i) => {
            const age = (q - c0) / 0.25
            if (age < 0 || age >= 1) return
            const flip = i ? -1 : 1
            const x0 = f.x - 28 * flip
            const x1 = f.x + 28 * flip
            if (age < 0.45) {
                line(d, x0, cy - 26, x1, cy + 22, C.white)
                line(d, x0 + flip, cy - 26, x1 + flip, cy + 22, C.white)
                line(d, x0 + 2 * flip, cy - 26, x1 + 2 * flip, cy + 22, C.red3)
            }
            const a0 = i ? -2.7 : -0.45
            arcBand(d, f.x - 12 * flip, cy - 12, 30, a0, a0 + 1.6 * flip, 10, age * 3, age < 0.5 ? C.red2 : C.red1, C.white, C.red0)
        })
        // the beat after: the cut lands
        blast(d, f.x, cy, t, LAND, 20, 0.6, BLOOD, 530, 'blood')
        shockRing(d, f.x, cy, t, LAND, 0.4, 8, 30, C.white)
        shockRing(d, f.x, f.g - 1, t, LAND + 0.05, 0.45, 4, 24, C.red3, true)
        // the mark shattering into red shards, spray thrown out the far side
        burst(d, f.x, cy - 26, t, LAND, 20, 80, 'blood', 531, 0.6, 90, -Math.PI / 2, Math.PI * 1.4, 2)
        burst(d, f.x + 3, cy, t, LAND, 24, 110, 'blood', 532, 0.5, 70, 0, 1.0, 2)
    }),
    // the front line: six glowing arrows lobbed high, two coming down on each rank
    champ('Volley', 'Damage', 1.3, (d, t) => {
        for (let i = 0; i < 6; i++) {
            const f = F[i % 3]!
            const t0 = 0.1 + i * 0.06
            const tx = f.x + ((i >> 1) & 1 ? 3 : -3)
            const u = travel(t, t0, t0 + 0.42)
            if (u >= 0) {
                lob(MUZZLE.x, MUZZLE.y - 4, tx, chestOf(f), 26, u)
                for (let k = 0; k < 11; k++) {
                    const px = R(VP.x - Math.cos(VP.a) * k)
                    const py = R(VP.y - Math.sin(VP.a) * k)
                    d.set(px, py, k < 2 ? C.white : k < 6 ? C.gold3 : C.gold1)
                    if (k < 6) d.set(px, py + 1, C.gold2)
                }
            }
            blast(d, tx, chestOf(f), t, t0 + 0.42, 6, 0.35, GOLD, 540 + i, 'gold')
        }
    }),
    // one foe, many small hits: a flurry of orange cuts crossing back and forth through it
    champ('Focused Barrage', 'Damage', 1.3, (d, t) => {
        const f = F[0]
        const cy = chestOf(f)
        for (let i = 0; i < 5; i++) {
            const t0 = 0.12 + i * 0.16
            const age = (qt(t) - t0) / 0.2
            if (age >= 0 && age < 1) {
                const flip = i & 1
                arcBand(d, f.x, cy - 2 + i, 11, flip ? 0.6 : -2.5, flip ? 2.9 : -0.2, 4, age * 2.5, age < 0.5 ? C.orange : C.lava1, C.white, C.red1)
            }
            blast(d, f.x + (i & 1 ? 3 : -3), cy - 3 + i * 2, t, t0 + 0.1, 5, 0.3, ORANGE, 550 + i, 'spark')
        }
    }),
    // a bleed on one foe: spikes of blood burst out of it, then it keeps dripping
    champ('Rupture', 'Damage', 1.4, (d, t) => {
        const f = F[0]
        const cy = chestOf(f)
        const q = qt(t)
        const u = pr(t, 0.3, 0.45)
        if (q >= 0.3 && q < 0.85) {
            const shrink = q < 0.6 ? 1 : 1 - (q - 0.6) / 0.25
            for (let i = 0; i < 7; i++) {
                const a = i / 7 * Math.PI * 2 + 0.3
                const L = (13 + hash2(i, 61) * 7) * u * shrink
                const ex = f.x + Math.cos(a) * L
                const ey = cy + Math.sin(a) * L
                tri(d, R(f.x + Math.cos(a + 1.6) * 3), R(cy + Math.sin(a + 1.6) * 3), R(f.x + Math.cos(a - 1.6) * 3), R(cy + Math.sin(a - 1.6) * 3), R(ex), R(ey), C.red1)
                line(d, f.x, cy, R(ex), R(ey), C.red2)
                d.set(R(ex), R(ey), C.red3)
            }
        }
        blast(d, f.x, cy, t, 0.3, 9, 0.4, BLOOD, 560, 'blood')
        if (q > 0.5) for (let i = 0; i < 6; i++) {
            const ph = (q * 1.6 + hash2(i, 62)) % 1
            d.set(R(f.x - 5 + hash2(i, 63) * 10), R(cy + ph * 14), ph < 0.5 ? C.red2 : C.red1)
        }
    })
]

// ── Tank ───────────────────────────────────────────────────────────────────────────

// The live stage fields the Tank on the front row's far mark (CHAMP_MARKS[0] in demo.ts), so its
// self-effects are staged there rather than on the Hero's mark.
const T = VL.allies[0]
/** A four-point glint, its rays one or two pixels as it twinkles. */
function glint(d: Surface, x: number, y: number, t: number): void {
    const r = 1 + (Math.floor(qt(t) * 10) & 1)
    for (let i = -r; i <= r; i++) { d.set(x + i, y, C.white); d.set(x, y + i, C.white) }
}
const TC = chestOf(T)
const STONE: Ramp6 = [C.white, C.bone1, C.stone3, C.stone2, C.stone1, C.stone0]
const EARTH: Ramp6 = [C.white, C.bone1, C.sand2, C.brown2, C.brown1, C.brown0]
const SHIELD: Ramp6 = [C.white, C.gold3, C.gold3, C.gold2, C.gold1, C.gold0]

const TANK: VfxDef[] = [
    // self, taunt: a shield-bang rolls red rings out over the enemy line; every foe glares round
    champ('Provoke', 'Tank', 1.3, (d, t) => {
        const q = qt(t)
        blast(d, T.x + 6, TC, t, 0.2, 6, 0.3, BLOOD, 600, 'blood')
        for (let k = 0; k < 3; k++) {
            const u = (q - 0.25 - k * 0.12) / 0.6
            if (u < 0 || u >= 1) continue
            arcBand(d, T.x + 6, TC, 6 + eo(u) * 110, -0.5, 0.9, R(2 + 5 * (1 - u)), 1, C.red2, u < 0.5 ? C.white : C.red3, C.red0)
        }
        if (q >= 0.25 && q < 1.3) {
            const y = TC - 22 + (Math.floor(q * 4) & 1)
            rect(d, T.x - 1, y, 3, 7, C.red2); rect(d, T.x, y, 1, 6, C.red3); rect(d, T.x - 1, y + 8, 3, 3, C.red2)
        }
        F.forEach((f, i) => {
            const at = 0.3 + (f.x - T.x) / 110 * 0.4
            if (q < at || q >= 1.3) return
            // an angry mark over each: a red vein-cross, pulsing
            const y = chestOf(f) - 18
            const c = Math.floor(q * 8 + i) & 1 ? C.red3 : C.red2
            for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) { d.set(f.x + a, y + b, c); d.set(f.x + a / 2, y + b / 2, c) }
        })
    }),
    // self, DEF up: a great golden shield raised before the Tank, a glint running across its face
    champ('Bulwark Stance', 'Tank', 1.4, (d, t) => {
        const q = qt(t)
        const s = eo(pr(t, 0.15, 0.35)) * (q < 1.15 ? 1 : 1 - (q - 1.15) / 0.25)
        blast(d, T.x + 8, TC, t, 0.15, 8, 0.35, SHIELD, 610, 'gold')
        if (s > 0.05) {
            const x = T.x + 9
            const w = R(7 * s)
            const h = R(9 * s)
            // a heater shield: flat top, sides running down to a point; rim, face, cross and boss
            const pts = [-w, -h, w, -h, w, R(h * 0.25), 0, h + 2, -w, R(h * 0.25)]
            poly(d, pts, x, TC, C.gold1)
            poly(d, pts.map(v => v === 0 ? 0 : v > 0 ? v - 1 : v + 1), x, TC, C.gold2)
            rect(d, x - w + 1, TC - h + 1, w * 2 - 1, 1, C.gold3)
            if (s > 0.8) { line(d, x, TC - h + 2, x, TC + h - 1, C.gold1); line(d, x - w + 2, TC - 2, x + w - 2, TC - 2, C.gold1); disc(d, x, TC - 2, 1.5, C.gold3) }
            // the glint: a bright diagonal band sweeping once across the face
            const g = pr(t, 0.45, 0.75)
            if (g > 0 && g < 1) {
                const gx = x - w - 4 + g * (w * 2 + 8)
                for (let dy = -h + 1; dy <= h; dy++) {
                    const half = w - 1 - (dy > h * 0.25 ? (dy - h * 0.25) : 0)
                    for (const k of [0, 1]) {
                        const px = R(gx + dy * 0.5) + k
                        if (Math.abs(px - x) < half) d.set(px, TC + dy, k ? C.gold3 : C.white)
                    }
                }
            }
            if (g >= 1 && q < 0.9) glint(d, x + w - 1, TC - h + 1, t)
        }
        if (q > 0.4) chevrons(d, T.x, TC - 22, t, true, C.gold3, C.white)
    }),
    // self, reflect: a crystal mirror flares before the Tank; a bolt from the foes strikes it and
    // is thrown back as a white-cyan comet into the front foe
    champ("Guardian's Reflect", 'Tank', 1.4, (d, t) => {
        const q = qt(t)
        const mx = T.x + 10
        if (q >= 0.1 && q < 1.0) {
            const s = Math.min(1, (q - 0.1) / 0.15, (1.0 - q) / 0.15)
            const h = R(10 * s)
            // the mirror: a tall diamond of facets, lit down its near side
            tri(d, mx, TC - h, mx + 4, TC, mx, TC + h, C.blue2)
            tri(d, mx, TC - h, mx - 3, TC, mx, TC + h, C.frost)
            line(d, mx, TC - h, mx, TC + h, C.white)
            if (Math.floor(q * 10) & 1) d.set(mx - 1, TC - R(h / 2), C.white)
        }
        const f = F[0]
        const fy = chestOf(f)
        const inn = travel(t, 0.15, 0.45)
        if (inn >= 0) comet(d, f.x - (f.x - mx) * inn, fy + (TC - fy) * inn, Math.PI + Math.atan2(TC - fy, mx - f.x) * -1, 3, [C.white, C.pink, C.pink, C.purple2, C.purple1, C.purple0], t, 620)
        blast(d, mx, TC, t, 0.45, 7, 0.3, STORM, 621, 'frost')
        const out = travel(t, 0.5, 0.78)
        if (out >= 0) comet(d, mx + (f.x - mx) * out, TC + (fy - TC) * out, Math.atan2(fy - TC, f.x - mx), 3, STORM, t, 622)
        blast(d, f.x, fy, t, 0.78, 10, 0.45, STORM, 623, 'frost')
    }),
    // the party, DEF up: a golden shout rolls back over every ally, each lit with a shield flash
    champ('Rallying Shout', 'Tank', 1.4, (d, t) => {
        const q = qt(t)
        blast(d, T.x - 2, TC, t, 0.15, 6, 0.3, SHIELD, 630, 'gold')
        for (let k = 0; k < 3; k++) {
            const u = (q - 0.2 - k * 0.12) / 0.6
            if (u < 0 || u >= 1) continue
            const r = 4 + eo(u) * 28
            arcBand(d, T.x - 2, TC + 4, r, Math.PI * 0.4, Math.PI * 1.3, R(1 + 3 * (1 - u)), 1, C.gold2, u < 0.5 ? C.white : C.gold3, C.gold1)
        }
        VL.allies.forEach((a, i) => {
            const at = 0.3 + Math.hypot(a.x - T.x, a.g - T.g) / 40 * 0.3
            blast(d, a.x, chestOf(a), t, at, 5, 0.35, SHIELD, 631 + i, 'gold')
            if (q >= at + 0.1) chevrons(d, a.x, chestOf(a) - 14, t, true, C.gold3, C.white)
        })
    }),
    // self, stacking DEF: plates of iron fly in and clamp on, a steel sheen climbs the body
    champ('Iron Skin', 'Tank', 1.4, (d, t) => {
        const q = qt(t)
        for (let i = 0; i < 6; i++) {
            const a = i / 6 * Math.PI * 2 + 0.4
            const u = travel(t, 0.1 + i * 0.04, 0.4 + i * 0.04)
            if (u < 0) continue
            const dist = (1 - eo(u)) * 22 + 6
            const px = T.x + Math.cos(a) * dist
            const py = TC + Math.sin(a) * dist * 0.9
            // a round iron plate, rimmed dark, lit on its upper left, a rivet in its middle
            disc(d, px, py, 2.5, C.steel1)
            disc(d, px - 0.5, py - 0.5, 1.8, C.steel3)
            d.set(R(px) - 1, R(py) - 1, C.white); d.set(R(px), R(py), C.steel1)
        }
        const u = pr(t, 0.55, 0.9)
        if (u > 0 && u < 1) {
            const y = R(T.g - 1 - u * 26)
            for (let dx = -8; dx <= 8; dx++) { d.set(T.x + dx, y - 1, C.steel3); d.set(T.x + dx, y, C.white); d.set(T.x + dx, y + 1, C.steel3) }
        }
        blast(d, T.x, TC, t, 0.9, 10, 0.4, STEEL, 640, 'steel')
        if (q > 0.9) chevrons(d, T.x, TC - 22, t, true, C.steel2, C.white)
    }),
    // the front line, stun: the slam cracks the ground in a crater, and a beat later the earth
    // bursts up under each front foe in spikes of rock, throwing chunks into the air
    champ('Ground Slam', 'Tank', 1.5, (d, t) => {
        const q = qt(t)
        const sx = T.x + 7
        const SLAM = 0.25
        // the crater: a dark dish with a heaved rim
        if (q >= SLAM && q < 1.5) {
            const fade = q < 1.1 ? 1 : 1 - (q - 1.1) / 0.4
            ditherEllipse(d, sx, T.g, 9 * fade, 2.5 * fade, C.ink, 12)
            for (const dx of [-9, -7, 7, 9]) d.set(sx + dx, T.g - 2, C.stone2)
        }
        blast(d, sx, T.g - 1, t, SLAM, 13, 0.45, EARTH, 650, 'dust', true)
        shockRing(d, sx, T.g - 1, t, SLAM, 0.45, 4, 28, C.bone1, true)
        burst(d, sx, T.g - 2, t, SLAM, 16, 90, 'dust', 649, 0.7, 180, -Math.PI / 2, 1.4, 2)
        for (let i = 0; i < 3; i++) {
            const f = F[i]!
            const at = 0.5 + i * 0.07
            blast(d, f.x, f.g - 1, t, at, 13, 0.5, EARTH, 651 + i, 'dust', true)
            blast(d, f.x, chestOf(f), t, at + 0.05, 7, 0.3, STONE, 660 + i, 'dust')
            // the spikes: stone bursting up under the foe over the blast, then sinking
            const age = (q - at) / 0.6
            if (age >= 0 && age < 1) {
                const h = R(20 * (age < 0.12 ? age / 0.12 : 1 - (age - 0.12) / 0.88))
                if (h > 1) for (const [dx, k] of [[-5, 0.6], [5, 0.7], [0, 1]] as const) {
                    const hh = R(h * k)
                    tri(d, f.x + dx - 3, f.g - 1, f.x + dx + 3, f.g - 1, f.x + dx, f.g - 1 - hh, C.stone2)
                    tri(d, f.x + dx - 3, f.g - 1, f.x + dx, f.g - 1, f.x + dx, f.g - 1 - hh, C.stone3)
                    d.set(f.x + dx, f.g - 1 - hh, C.white); d.set(f.x + dx, f.g - hh, C.bone1)
                }
            }
            burst(d, f.x, f.g - 2, t, at, 16, 90, 'dust', 655 + i, 0.7, 170, -Math.PI / 2, 1.4, 2)
            if (q >= at + 0.2) stunStars(d, f.x, chestOf(f) - 12, t)
        }
    }),
    // self, redirect: glowing gold tethers run from the Tank to every ally, light flowing back
    // along them to it, and a small gold shield flashes up over each ally it now guards
    champ("Guardian's Vow", 'Tank', 1.5, (d, t) => {
        const q = qt(t)
        blast(d, T.x, TC, t, 0.1, 7, 0.35, SHIELD, 660, 'gold')
        if (q >= 0.2 && q < 1.5) {
            const reach = eo(pr(t, 0.2, 0.5))
            const fade = q < 1.2 ? 1 : 1 - (q - 1.2) / 0.3
            VL.allies.forEach((a, i) => {
                if (i === 0) return
                const ax = a.x
                const ay = chestOf(a)
                const n = Math.max(3, R(Math.hypot(ax - T.x, ay - TC) / 2))
                for (let k = 0; k <= n; k++) {
                    const u = k / n * reach
                    const x = T.x + (ax - T.x) * u
                    const y = TC + (ay - TC) * u + Math.sin(u * Math.PI) * 4
                    if (fade < 0.6 && (k & 1)) continue
                    d.set(R(x), R(y), C.gold2); d.set(R(x), R(y) + 1, C.gold1); d.set(R(x), R(y) - 1, C.gold3)
                }
                if (reach < 1) return
                for (let k = 0; k < 2; k++) {
                    const ph = 1 - ((q * 1.4 + k / 2 + i * 0.13) % 1)
                    disc(d, T.x + (ax - T.x) * ph, TC + (ay - TC) * ph + Math.sin(ph * Math.PI) * 4, 1, C.white)
                }
                // the ward over the ally: a tiny gold shield
                const sy = ay - 14
                rect(d, ax - 2, sy, 5, 3, C.gold2); rect(d, ax - 1, sy + 3, 3, 1, C.gold2); d.set(ax, sy + 4, C.gold2)
                d.set(ax - 2, sy, C.gold3); d.set(ax, sy + 1, C.white)
            })
            // the Tank's own glow where the tethers meet
            disc(d, T.x, TC, 2 + (Math.floor(q * 8) & 1), C.gold3)
            d.set(T.x, TC, C.white)
        }
    })
]

// ── Support ────────────────────────────────────────────────────────────────────────

// The live stage fields the Support on the back row's far mark (CHAMP_MARKS[2]). A single-ally
// heal or shield is staged on the front row's middle Champion, a hurt front-liner; a buff on the
// strongest ally lands on the Hero.
const SU = VL.allies[3]
const SUC = chestOf(SU)
const STAFF = { x: SU.x + 7, y: SUC - 10 }
const HURT = VL.allies[1]
const BEST = VL.allies[2]
const HEAL: Ramp6 = [C.white, C.green4, C.green4, C.green3, C.teal2, C.teal1]
const BLESS: Ramp6 = [C.white, C.frost, C.cyan, C.cyan, C.blue2, C.blue1]

/** A glow gathering at the Support's staff head over [t0, t1]: motes drawn in, a swelling orb. */
function staffCharge(d: Surface, t: number, t0: number, t1: number, ramp: Ramp6, seed: number): void {
    const q = qt(t)
    if (q < t0 || q >= t1) return
    const u = pr(t, t0, t1)
    for (let i = 0; i < 8; i++) {
        const a = hash2(i, seed) * Math.PI * 2
        const ph = (q * 2.5 + hash2(i, seed + 1)) % 1
        const dist = (1 - ph) * 12
        d.set(R(STAFF.x + Math.cos(a) * dist), R(STAFF.y + Math.sin(a) * dist), ph > 0.7 ? C.white : ramp[2])
    }
    disc(d, STAFF.x, STAFF.y, 1 + u * 2, ramp[3]); disc(d, STAFF.x, STAFF.y, u * 1.2, C.white)
}

/** A shaft of light down onto a body standing on `g`, `w` px each side, narrowing as it fades. */
function lightShaft(d: Surface, x: number, g: number, w: number, t: number, t0: number, t1: number, ramp: Ramp6): void {
    const q = qt(t)
    if (q < t0 || q >= t1) return
    const u = (q - t0) / (t1 - t0)
    const half = R(w * (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8 * 0.7))
    for (let dx = -half; dx <= half; dx++) {
        const k = Math.abs(dx) / Math.max(1, half)
        const c = k < 0.3 ? ramp[0] : k < 0.65 ? ramp[1] : ramp[3]
        for (let y = 0; y < g; y++) if (k < 0.65 || ((y + dx) & 1)) d.set(x + dx, y, c)
    }
}

const SUPPORT: VfxDef[] = [
    // one ally, heal: a mote of green light thrown from the staff, a shaft of light on the
    // wounded ally, a heal bursting out of it and pluses rising
    champ('Mending Light', 'Support', 1.4, (d, t) => {
        const q = qt(t)
        const hc = chestOf(HURT)
        staffCharge(d, t, 0.05, 0.35, HEAL, 700)
        const u = travel(t, 0.35, 0.6)
        if (u >= 0) {
            lob(STAFF.x, STAFF.y, HURT.x, hc, 10, u)
            comet(d, VP.x, VP.y, VP.a, 2, HEAL, t, 701)
        }
        lightShaft(d, HURT.x, HURT.g, 5, t, 0.55, 1.2, HEAL)
        blast(d, HURT.x, hc, t, 0.6, 9, 0.45, HEAL, 702, 'heal')
        if (q > 0.65 && q < 1.4) healRise(d, HURT.x, hc, t, 703, C.green4, C.white)
    }),
    // one ally, shield: a bubble of light closes round the wounded ally, a glint running round it
    champ('Sanctuary', 'Support', 1.5, (d, t) => {
        const q = qt(t)
        const hc = chestOf(HURT)
        staffCharge(d, t, 0.05, 0.3, BLESS, 710)
        const u = travel(t, 0.3, 0.5)
        if (u >= 0) comet(d, STAFF.x + (HURT.x - STAFF.x) * u, STAFF.y + (hc - STAFF.y) * u, Math.atan2(hc - STAFF.y, HURT.x - STAFF.x), 2, BLESS, t, 711)
        if (q >= 0.5 && q < 1.5) {
            const s = eo(pr(t, 0.5, 0.7)) * (q < 1.25 ? 1 : 1 - (q - 1.25) / 0.25)
            const r = 12 * s
            const cy = hc - 2
            ditherDisc(d, HURT.x, cy, r, C.cyan, 3)
            ring(d, HURT.x, cy, r, C.frost)
            ring(d, HURT.x, cy, Math.max(1, r - 1), C.blue2)
            // the glint wheeling round the shell, and its lit upper-left arc
            for (let i = 0; i < 8; i++) {
                const a = Math.PI * (1.05 + i * 0.06)
                d.set(R(HURT.x + Math.cos(a) * (r - 2)), R(cy + Math.sin(a) * (r - 2)), C.white)
            }
            const ga = q * 5
            d.set(R(HURT.x + Math.cos(ga) * r), R(cy + Math.sin(ga) * r), C.white)
        }
        blast(d, HURT.x, hc, t, 0.5, 6, 0.3, BLESS, 712, 'frost')
    }),
    // the party, heal over time: a tide of teal light rolls across under them, ripples rising at
    // the party, heal over time: one small curling wave of teal water rolls in from behind the
    // party along the floor, splashing up healing spray at every ally's feet as it passes them,
    // and green pluses keep rising after it
    champ('Tide of Renewal', 'Support', 1.7, (d, t) => {
        const q = qt(t)
        staffCharge(d, t, 0.05, 0.3, HEAL, 720)
        // its crest reaches halfway up the far rank's Champions (the user's call)
        const WAVE = { from: 0.3, to: 1.2, x0: -30, x1: 112, h: 44, back: 42, face: 13 }
        const u = pr(t, WAVE.from, WAVE.to)
        const cx = WAVE.x0 + (WAVE.x1 - WAVE.x0) * u
        if (u > 0 && u < 1) {
            const f = Math.floor(q * 15)
            const grow = Math.min(1, u * 5, (1 - u) * 5)
            const H = WAVE.h * grow
            // the body: a swell rising toward the crest, banded by height, screened lightly so the
            // party's legs still show through it
            for (let dx = -WAVE.back; dx <= 0; dx++) {
                const k = (dx + WAVE.back) / WAVE.back
                const h = R(H * k * k * (3 - 2 * k))
                const x = R(cx + dx)
                for (let y = 0; y < h; y++) {
                    const v = y / Math.max(1, h)
                    // see-through water, so the party shows inside it: a half screen, solid only at the crest
                    if (y < h - 3 && ((x + y) & 1)) continue
                    d.set(x, FLOOR - 1 - y, y >= h - 2 ? C.teal3 : v > 0.65 ? C.teal2 : C.teal1)
                }
            }
            // the face: lit water curving down from the crest to the floor ahead of it
            for (let dx = 1; dx <= WAVE.face; dx++) {
                const k = dx / WAVE.face
                const h = R(H * (1 - k * k))
                const x = R(cx + dx)
                for (let y = 0; y < h; y++) {
                    if (y < h - 3 && ((x + y) & 1)) continue
                    d.set(x, FLOOR - 1 - y, y > h - 3 ? C.frost : C.teal3)
                }
            }
            // the lip: the crest throwing forward over the face and curling down, white foam on its rim
            const r = H * 0.32
            for (let i = 0; i <= 10; i++) {
                const a = -Math.PI * 0.5 + i / 10 * Math.PI * 0.95
                const x = R(cx + 2 + Math.cos(a) * r * 1.4)
                const y = R(FLOOR - 1 - H + r + Math.sin(a) * r)
                d.set(x, y, i < 7 ? C.white : C.frost)
                if (i < 8) d.set(x - 1, y, C.teal3)
            }
            // foam bubbling along the crest and spray thrown off the lip
            for (let dx = -16; dx <= 0; dx++) if (hash2(dx + 20, f) > 0.55) {
                const k = (dx + WAVE.back) / WAVE.back
                d.set(R(cx + dx), R(FLOOR - 1 - H * k * k * (3 - 2 * k)) - 1, C.white)
            }
            for (let i = 0; i < 12; i++) {
                const ph = (q * 3 + hash2(i, 726)) % 1
                d.set(R(cx + 4 + ph * 10 + i * 0.8), R(FLOOR - H - 2 - ph * 8 + ph * ph * 16), ph < 0.4 ? C.white : C.teal3)
            }
        }
        VL.allies.forEach((a, i) => {
            const at = WAVE.from + (a.x - WAVE.x0) / (WAVE.x1 - WAVE.x0) * (WAVE.to - WAVE.from)
            // spray splashing up at the ally's feet as the wave passes, and a ripple left behind
            burst(d, a.x, a.g - 2, t, at, 8, 45, 'water', 727 + i, 0.5, 120, -Math.PI / 2, 1.0)
            if (q >= at && q < at + 0.6) {
                const r = (q - at) / 0.6
                ellipseRing(d, a.x, a.g - 1, 3 + r * 9, (3 + r * 9) * 0.3, r < 0.5 ? C.teal3 : C.teal1)
            }
            if (q > at + 0.1) healRise(d, a.x, chestOf(a), t, 721 + i, C.green4, C.white)
        })
    }),
    // the strongest ally, PWR: a mote of warm gold light drifts over to the Hero and sinks into
    // him; a ring of gold spreads at his feet and light climbs up through him (a buff, not a blow)
    champ('Empower', 'Support', 1.6, (d, t) => {
        const q = qt(t)
        const bc = chestOf(BEST)
        staffCharge(d, t, 0.05, 0.35, SHIELD, 730)
        const u = travel(t, 0.35, 0.8)
        if (u >= 0) {
            lob(STAFF.x, STAFF.y, BEST.x, bc, 8, eo(u))
            disc(d, VP.x, VP.y, 3.5, C.gold1); disc(d, VP.x, VP.y, 2.5, C.gold2); disc(d, VP.x, VP.y, 1.5, C.gold3); d.set(R(VP.x), R(VP.y), C.white)
            for (let k = 1; k < 4; k++) d.set(R(VP.x - Math.cos(VP.a) * k * 3), R(VP.y - Math.sin(VP.a) * k * 3 + Math.sin(q * 12 + k)), k < 2 ? C.gold3 : C.gold1)
        }
        // it settles in at his feet: a soft flare on the ground, not a hit to the body
        blast(d, BEST.x, BEST.g - 1, t, 0.8, 10, 0.5, SHIELD, 736, 'gold', true)
        shockRing(d, BEST.x, BEST.g - 1, t, 0.8, 0.5, 3, 18, C.gold3, true)
        if (q >= 0.8 && q < 1.6) {
            const fade = q < 1.3 ? 1 : 1 - (q - 1.3) / 0.3
            // streaks of light climbing up the body
            // a warm glow at his edges, and streaks of light climbing up through him
            for (const dx of [-8, 8]) for (let y = BEST.g - 26; y < BEST.g - 1; y++) if (((y + (dx > 0 ? 1 : 0)) & 1) && hash2(y, dx + R(q * 8)) < 0.6 * fade) d.set(BEST.x + dx, y, C.gold2)
            for (let i = 0; i < 8; i++) {
                const ph = (q * 1.8 + hash2(i, 733)) % 1
                if (ph > fade) continue
                const x = BEST.x - 7 + R(hash2(i, 734) * 14)
                const y = R(BEST.g - 2 - ph * 30)
                for (let k = 0; k < 5; k++) d.set(x, y + k, k === 0 ? C.white : k < 2 ? C.gold3 : C.orange)
            }
            motes(d, BEST.x, BEST.g - 2, 18, 30, t, 10, 'spark', 735, 26)
            chevrons(d, BEST.x, bc - 16, t, true, C.orange, C.gold3)
        }
    }),
    // the strongest ally, SPD: ribbons of cyan wind wheel round the Hero, speed lines streaming off
    champ('Haste Blessing', 'Support', 1.5, (d, t) => {
        const q = qt(t)
        const bc = chestOf(BEST)
        staffCharge(d, t, 0.05, 0.35, BLESS, 740)
        const u = travel(t, 0.35, 0.55)
        if (u >= 0) comet(d, STAFF.x + (BEST.x - STAFF.x) * u, STAFF.y + (bc - STAFF.y) * u, Math.atan2(bc - STAFF.y, BEST.x - STAFF.x), 2, BLESS, t, 741)
        blast(d, BEST.x, bc, t, 0.55, 8, 0.35, BLESS, 742, 'frost')
        if (q >= 0.55 && q < 1.5) {
            const fade = q < 1.2 ? 1 : 1 - (q - 1.2) / 0.3
            // two ribbons spiralling up round the body
            for (let rib = 0; rib < 2; rib++) {
                for (let k = 0; k < 26; k++) {
                    const v = k / 26
                    if (v > fade) break
                    const a = q * 9 + rib * Math.PI + v * Math.PI * 3
                    const x = BEST.x + Math.cos(a) * 9
                    const y = BEST.g - 2 - v * 24 + Math.sin(a) * 2.5
                    const c = Math.sin(a) > 0 ? (k > 22 ? C.white : C.cyan) : C.blue2
                    d.set(R(x), R(y), c); d.set(R(x), R(y) - 1, Math.sin(a) > 0 ? C.frost : C.blue1)
                }
            }
            for (let i = 0; i < 4; i++) {
                const ph = (q * 3 + hash2(i, 743)) % 1
                const y = bc - 8 + i * 5
                const x = BEST.x - 8 - ph * 16
                for (let k = 0; k < 5; k++) d.set(R(x - k), y, k < 2 ? C.white : C.cyan)
            }
            chevrons(d, BEST.x, bc - 16, t, true, C.cyan, C.white)
        }
    }),
    // the party, revive: the sky opens in gold over the party, a shaft of light comes down on every
    // ally, and feathers of light drift down through them
    champ('Second Wind', 'Support', 1.7, (d, t) => {
        const q = qt(t)
        staffCharge(d, t, 0.05, 0.4, SHIELD, 750)
        if (q >= 0.3 && q < 1.5) {
            const s = Math.min(1, (q - 0.3) / 0.2, (1.5 - q) / 0.3)
            // the sky opening: a band of gold light, white-hot at its heart, dithered only at its edge
            ditherEllipse(d, 45, 3, 44 * s, 6 * s, C.gold1, 6)
            ditherEllipse(d, 45, 3, 38 * s, 5 * s, C.gold2, 16)
            ditherEllipse(d, 45, 2, 26 * s, 3 * s, C.gold3, 16)
            ditherEllipse(d, 45, 2, 14 * s, 1.5 * s, C.white, 16)
        }
        VL.allies.forEach((a, i) => {
            lightShaft(d, a.x, a.g, 4, t, 0.45 + i * 0.04, 1.4 + i * 0.04, SHIELD)
            blast(d, a.x, a.g - 1, t, 0.55 + i * 0.04, 8, 0.45, SHIELD, 751 + i, 'gold', true)
        })
        // feathers of light drifting down, rocking as they fall
        if (q >= 0.5 && q < 1.7) for (let i = 0; i < 10; i++) {
            const ph = ((q - 0.5) * 0.7 + hash2(i, 760)) % 1
            const x = R(10 + hash2(i, 761) * 70 + Math.sin(q * 4 + i) * 3)
            const y = R(4 + ph * 80)
            d.set(x, y, C.white); d.set(x + 1, y + 1, C.gold3); d.set(x - 1, y + 1, C.gold2)
        }
    }),
    // the party, cleanse and immunity: a ring of white light washes out over the party, the dark
    // of every debuff drawn up out of them and burning away, a glint of ward left on each
    champ('Purify', 'Support', 1.6, (d, t) => {
        const q = qt(t)
        staffCharge(d, t, 0.05, 0.35, BLESS, 770)
        shockRing(d, SU.x + 10, SU.g - 1, t, 0.35, 0.6, 4, 60, C.white, true)
        shockRing(d, SU.x + 10, SU.g - 1, t, 0.45, 0.6, 3, 44, C.frost, true)
        VL.allies.forEach((a, i) => {
            const at = 0.4 + Math.hypot(a.x - SU.x, a.g - SU.g) / 60 * 0.4
            const ac = chestOf(a)
            // the debuffs drawn up out of the body: dark motes rising and turning white as they burn
            if (q >= at && q < at + 0.7) for (let k = 0; k < 6; k++) {
                const ph = ((q - at) * 1.6 + hash2(k, 780 + i)) % 1
                const x = R(a.x - 5 + hash2(k, 790 + i) * 10)
                const y = R(ac + 6 - ph * 22)
                d.set(x, y, ph < 0.5 ? C.purple0 : ph < 0.8 ? C.purple2 : C.white)
            }
            blast(d, a.x, ac, t, at, 5, 0.35, BLESS, 800 + i, 'frost')
            // the ward: a brief glint of bubble round the ally
            if (q >= at + 0.4 && q < at + 0.8) {
                const r = 9
                for (let k = 0; k < 6; k++) {
                    const ang = Math.PI * (1.1 + k * 0.08)
                    d.set(R(a.x + Math.cos(ang) * r), R(ac + Math.sin(ang) * r), k < 2 ? C.white : C.frost)
                }
            }
        })
    })
]

export const CHAMPION_STYLED: readonly VfxDef[] = [...DAMAGE, ...TANK, ...SUPPORT]
export const CHAMPION_STYLED_BY_ID: Readonly<Record<string, VfxDef>> = Object.fromEntries(CHAMPION_STYLED.map(v => [v.id, v]))

/** The live stage's party, as demo.ts fields it: the Hero, and a Champion of each archetype on its mark. */
const PARTY: readonly { mark: number, arch: ChampionArchetype | null }[] = [
    { mark: 0, arch: 'tank' }, { mark: 1, arch: 'damage' }, { mark: 2, arch: null },
    { mark: 3, arch: 'support' }, { mark: 4, arch: 'control' }, { mark: 5, arch: 'damage' }
]
const STAGE_ACTOR = new Actor(64)

/**
 * The gallery underlay for a restyled Champion ability: the night floor, a training dummy on
 * every enemy mark, and the party standing on theirs, so an effect aimed at an ally lands on one.
 */
export function championStage(d: Surface): void {
    rect(d, 0, 0, VL.W, FLOOR, C.void)
    for (let y = 0; y < FLOOR; y += 4) rect(d, 0, y, VL.W, 2, y < FLOOR / 2 ? C.void : C.night0)
    rect(d, 0, FLOOR, VL.W, VL.H - FLOOR, C.night0)
    rect(d, 0, FLOOR, VL.W, 1, C.night2)
    for (const f of [...F].sort((a, b) => a.g - b.g)) drawCreature(d, f.x, f.g, TRAINING_DUMMY, 'static', 0, -1)
    for (const p of [...PARTY].sort((a, b) => VL.allies[a.mark]!.g - VL.allies[b.mark]!.g)) {
        const a = VL.allies[p.mark]!
        if (!p.arch) { const art = HERO_ART.class_beginner!; STAGE_ACTOR.draw(d, a.x, a.g, art.look, art.clips.idle, 0); continue }
        const id = CHAMPIONS.find(c => c.archetype === p.arch)!.id
        STAGE_ACTOR.draw(d, a.x, a.g, championLook(id), CHASSIS[p.arch].idle, 0)
    }
}
