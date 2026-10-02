// Champion ability VFX in the reference-video style (sixth pass, from Round 15): the same kit as
// the Hero cinematics — filled blobs, crescents and comets, `blast` impacts — but short, and
// without the cinematic's rune ring, tint and held stage, since five Champions cast all fight.
//
// Like every ability effect they are drawn in the VL layout as pure functions of time. The live
// stage plays them in fixed VL space whichever Champion casts, so each is staged at its target.
// They replace their round-1 `vfx.ts` entries by ID, as the cinematics do the Hero skills'.

import { C } from './palette'
import { ditherDisc, hash2, line, rect, ring, tri, type Surface } from './surface'
import { VL, pr, qt, eo, travel, lob, VP, burst, motes, stunStars, R } from './vfx-kit'
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
const TC = chestOf(T)
const STONE: Ramp6 = [C.white, C.bone1, C.stone3, C.stone2, C.stone1, C.stone0]
const SHIELD: Ramp6 = [C.white, C.gold3, C.gold3, C.gold2, C.gold1, C.gold0]

/** A dome of light over a body standing on `g`: hex cells, a glint sweeping across. */
function dome(d: Surface, x: number, g: number, r: number, t: number, rim: number, cell: number): void {
    if (r < 2) return
    const q = qt(t)
    const sweep = ((q * 1.2) % 1) * r * 2 - r
    for (let dy = -R(r * 1.25); dy <= 0; dy++) {
        for (let dx = -R(r); dx <= R(r); dx++) {
            const k = Math.hypot(dx, dy / 1.25) / r
            if (k > 1) continue
            const x0 = x + dx
            const y0 = g - 1 + dy
            if (k > 0.86) { d.set(x0, y0, rim); continue }
            // the hex lattice: every third column and a staggered row, only where the shell curves away
            const hx = (dx + 30) % 6
            const hy = (dy + 30 + (Math.floor((dx + 30) / 6) & 1) * 3) % 6
            if ((hx === 0 || hy === 0) && k > 0.4) d.set(x0, y0, cell)
            if (Math.abs(dx - sweep) < 1.5 && k > 0.3) d.set(x0, y0, C.white)
        }
    }
}

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
    // self, DEF up: a golden shield-dome rises over the Tank, a glint sweeping its hex cells
    champ('Bulwark Stance', 'Tank', 1.4, (d, t) => {
        const q = qt(t)
        const grow = eo(pr(t, 0.15, 0.4)) * (q < 1.1 ? 1 : 1 - (q - 1.1) / 0.3)
        blast(d, T.x, T.g - 1, t, 0.15, 10, 0.4, SHIELD, 610, 'gold', true)
        dome(d, T.x, T.g, 14 * grow, t, C.gold3, C.gold1)
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
            const r = 6 + eo(u) * 60
            arcBand(d, T.x - 2, TC + 8, r, Math.PI * 0.35, Math.PI * 1.35, R(2 + 4 * (1 - u)), 1, C.gold2, u < 0.5 ? C.white : C.gold3, C.gold1)
        }
        VL.allies.forEach((a, i) => {
            const at = 0.35 + Math.hypot(a.x - T.x, a.g - T.g) / 60 * 0.4
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
            rect(d, R(px) - 2, R(py) - 2, 5, 4, C.steel3); rect(d, R(px) - 2, R(py) + 2, 5, 1, C.steel1); rect(d, R(px) - 2, R(py) - 2, 5, 1, C.white)
            d.set(R(px), R(py), C.steel1)
        }
        const u = pr(t, 0.55, 0.9)
        if (u > 0 && u < 1) {
            const y = R(T.g - 1 - u * 26)
            for (let dx = -8; dx <= 8; dx++) { d.set(T.x + dx, y - 1, C.steel3); d.set(T.x + dx, y, C.white); d.set(T.x + dx, y + 1, C.steel3) }
        }
        blast(d, T.x, TC, t, 0.9, 10, 0.4, STEEL, 640, 'steel')
        if (q > 0.9) chevrons(d, T.x, TC - 22, t, true, C.steel2, C.white)
    }),
    // the front line, stun: the Tank's slam heaves the ground, and it bursts up under each front foe
    champ('Ground Slam', 'Tank', 1.4, (d, t) => {
        const q = qt(t)
        blast(d, T.x + 6, T.g - 1, t, 0.25, 12, 0.45, STONE, 650, 'dust', true)
        shockRing(d, T.x + 6, T.g - 1, t, 0.25, 0.5, 4, 36, C.bone1, true)
        shockRing(d, T.x + 6, T.g - 1, t, 0.32, 0.5, 3, 24, C.stone3, true)
        for (let i = 0; i < 3; i++) {
            const f = F[i]!
            const at = 0.45 + i * 0.06
            blast(d, f.x, f.g - 1, t, at, 11, 0.5, STONE, 651 + i, 'dust', true)
            burst(d, f.x, f.g - 2, t, at, 10, 60, 'dust', 655 + i, 0.6, 140, -Math.PI / 2, 1.6, 2)
            if (q >= at + 0.15) stunStars(d, f.x, chestOf(f) - 12, t)
        }
    }),
    // self, redirect: golden tethers run from the Tank to every ally, light flowing back along them
    champ("Guardian's Vow", 'Tank', 1.5, (d, t) => {
        const q = qt(t)
        blast(d, T.x, TC, t, 0.1, 7, 0.35, SHIELD, 660, 'gold')
        if (q >= 0.2 && q < 1.5) {
            const reach = eo(pr(t, 0.2, 0.5))
            const fade = q < 1.2 ? 1 : 1 - (q - 1.2) / 0.3
            VL.allies.forEach((a, i) => {
                if (i === 0) return
                const ex = T.x + (a.x - T.x) * reach
                const ey = TC + (chestOf(a) - TC) * reach
                const n = Math.max(2, R(Math.hypot(ex - T.x, ey - TC) / 3))
                for (let k = 0; k <= n; k++) {
                    const u = k / n
                    const x = T.x + (ex - T.x) * u
                    const y = TC + (ey - TC) * u + Math.sin(u * Math.PI) * 3
                    if (fade < 0.5 && (k & 1)) continue
                    d.set(R(x), R(y), k & 1 ? C.gold2 : C.gold3); d.set(R(x), R(y) + 1, C.gold1)
                }
                // light flowing back along the tether to the Tank
                if (reach >= 1) for (let k = 0; k < 2; k++) {
                    const ph = 1 - ((q * 1.4 + k / 2 + i * 0.13) % 1)
                    d.set(R(T.x + (a.x - T.x) * ph), R(TC + (chestOf(a) - TC) * ph + Math.sin(ph * Math.PI) * 3), C.white)
                }
                if (reach >= 1) { ring(d, a.x, chestOf(a), 6, C.gold2); d.set(a.x, chestOf(a) - 7, C.white) }
            })
            // a halo of the vow over the Tank
            for (let i = 0; i < 12; i++) {
                const ang = q * 2 + i / 12 * Math.PI * 2
                d.set(R(T.x + Math.cos(ang) * 7), R(TC - 18 + Math.sin(ang) * 2), i & 1 ? C.gold2 : C.white)
            }
        }
    })
]

export const CHAMPION_STYLED: readonly VfxDef[] = [...DAMAGE, ...TANK]
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
