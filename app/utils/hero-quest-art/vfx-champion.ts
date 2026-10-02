// Champion ability VFX in the reference-video style (sixth pass, from Round 15): the same kit as
// the Hero cinematics — filled blobs, crescents and comets, `blast` impacts — but short, and
// without the cinematic's rune ring, tint and held stage, since five Champions cast all fight.
//
// Like every ability effect they are drawn in the VL layout as pure functions of time. The live
// stage plays them in fixed VL space whichever Champion casts, so each is staged at its target.
// They replace their round-1 `vfx.ts` entries by ID, as the cinematics do the Hero skills'.

import { C } from './palette'
import { hash2, line, rect, tri, type Surface } from './surface'
import { VL, pr, qt, eo, travel, lob, VP, motes, R } from './vfx-kit'
import { abilityId } from '../../../shared/utils/hero-quest/content/champions'
import { drawCreature } from './creature'
import { TRAINING_DUMMY } from './raids'
import { arcBand, blast, comet, chestOf, groundFire, shockRing, BLOOD, FIRE, GOLD, STEEL, STORM, type Ramp6 } from './vfx-cinematic'
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
    // one foe: a skull sigil marks it, then a red blade drops on it like a guillotine
    champ('Execute Strike', 'Damage', 1.3, (d, t) => {
        const f = F[0]
        const cy = chestOf(f)
        const q = qt(t)
        if (q >= 0.1 && q < 0.6) {
            const y = cy - 22 + (Math.floor(q * 8) & 1)
            rect(d, f.x - 3, y, 7, 5, C.red2); rect(d, f.x - 2, y + 5, 5, 2, C.red2)
            d.set(f.x - 1, y + 2, C.ink); d.set(f.x + 1, y + 2, C.ink); d.set(f.x - 2, y, C.red3)
        }
        const u = pr(t, 0.45, 0.62)
        if (u > 0 && q < 0.75) {
            const tip = R(cy - 46 + u * 42)
            // the blade: a broad slanted edge, white along its cutting line, speed lines above it
            rect(d, f.x - 9, tip - 22, 19, 14, C.red1)
            tri(d, f.x - 9, tip - 8, f.x + 9, tip - 8, f.x + 9, tip, C.red1)
            tri(d, f.x - 9, tip - 8, f.x - 9, tip - 5, f.x + 9, tip, C.red2)
            rect(d, f.x - 9, tip - 22, 19, 2, C.red0)
            line(d, f.x - 9, tip - 5, f.x + 9, tip, C.white); line(d, f.x - 9, tip - 6, f.x + 9, tip - 1, C.red3)
            for (let k = 1; k < 5; k++) line(d, f.x - 7 + k * 3, tip - 26 - k * 2, f.x - 7 + k * 3, tip - 30 - k * 3, C.red2)
        }
        blast(d, f.x, cy, t, 0.62, 14, 0.55, BLOOD, 530, 'blood')
        shockRing(d, f.x, f.g - 1, t, 0.65, 0.4, 4, 18, C.red3, true)
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

export const CHAMPION_STYLED: readonly VfxDef[] = [...DAMAGE]
export const CHAMPION_STYLED_BY_ID: Readonly<Record<string, VfxDef>> = Object.fromEntries(CHAMPION_STYLED.map(v => [v.id, v]))

/** The gallery underlay for a restyled Champion ability: the night floor and a training dummy on every enemy mark. */
export function championStage(d: Surface): void {
    rect(d, 0, 0, VL.W, FLOOR, C.void)
    for (let y = 0; y < FLOOR; y += 4) rect(d, 0, y, VL.W, 2, y < FLOOR / 2 ? C.void : C.night0)
    rect(d, 0, FLOOR, VL.W, VL.H - FLOOR, C.night0)
    rect(d, 0, FLOOR, VL.W, 1, C.night2)
    for (const f of [...F].sort((a, b) => a.g - b.g)) drawCreature(d, f.x, f.g, TRAINING_DUMMY, 'static', 0, -1)
}
