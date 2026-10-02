// Ability VFX (asset-list §2.1): one custom effect per ability — 16 Hero skills, 28 Champion
// abilities and the 18 Training Grounds Actives. 62 in all, none shared: a pulled Skill must
// not look like a skin of something already owned.
//
// Every effect is authored on the VL stage (party left, three enemies right) and is a pure
// function of time, so any frame can be drawn on its own. The live battle passes the same
// functions its own coordinates through `VL` before drawing.

import { C } from './palette'
import type { Surface} from './surface';
import { line, rect, disc, tri, ditherDisc, ditherEllipse } from './surface'
import {
    VL, pr, inWin, eo, qt, burst, motes, shock, bolt, travel, lob, VP, star, impact, arrows, healRise,
    column, bubble, runeCircle, rain, slash, R
} from './vfx-kit'
import { arrow } from './weapons'
import { Actor, HP } from './rig'
import { sample } from './anim'
import { DISCIPLE_CLIPS, DISCIPLE_LOOK, RAISED_DEAD_CLIPS, RAISED_DEAD_LOOK } from './summons'
import { CLASS_NODES } from '../../../shared/utils/hero-quest/content/classes'
import { CINEMATIC_BY_ID } from './vfx-cinematic'
import { CHAMPION_STYLED } from './vfx-champion'

export type VfxSource = 'class' | 'champion' | 'training'

export interface VfxDef {
    id: string
    name: string
    source: VfxSource
    /** Who owns it: a class node, an archetype, or a rarity. */
    owner: string
    dur: number
    draw(dst: Surface, t: number): void
}

const F = VL.foes
const A = VL.allies
const CX = VL.caster.x
const CY = VL.caster.y
const FLOOR = VL.floor

const HEAD = -10
const ACTOR = new Actor(64)

function summonIn(dst: Surface, x: number, look: typeof DISCIPLE_LOOK, clip: typeof DISCIPLE_CLIPS.move, t: number, u: number): void {
    sample(clip, t, ACTOR.pose)
    ACTOR.pose[HP.fade] = R((1 - u) * 16)
    ACTOR.drawPose(dst, x, FLOOR, look, t, 1)
}

// ═══════════════════════════════════════════════════════════════ Hero skills (16)

// The other fourteen are cinematics (vfx-cinematic.ts); only the two summons keep a
// sprite-level effect here, the user's call (2026-10-02).
const CLASS_VFX: VfxDef[] = [
    {
        id: 'skill_disciple', name: 'Disciple', source: 'class', owner: 'Paladin', dur: 1.6,
        draw(d, t) {
            const x = A[1].x
            const u = pr(t, 0, 0.5)
            if (qt(t) < 1.4) column(d, x, 0, FLOOR, R(2 + u * 5), 'holy', t, 6 + R(u * 6))
            shock(d, x, FLOOR, t, 0.3, 0.6, 4, 20, 'holy', true, 2)
            if (qt(t) >= 0.4) summonIn(d, x, DISCIPLE_LOOK, DISCIPLE_CLIPS.move, 0, pr(t, 0.4, 1.0))
            motes(d, x, FLOOR, 22, 50, t, 12, 'holy', 12, 30)
            if (inWin(t, 0.9, 1.6)) for (const a of A) healRise(d, a.x, a.y, t, a.x, C.gold3, C.white)
        }
    },
    {
        id: 'skill_raise_dead', name: 'Raise Dead', source: 'class', owner: 'Witch Doctor', dur: 1.8,
        draw(d, t) {
            const x = A[0].x + 6
            const u = pr(t, 0, 0.3)
            ditherEllipse(d, x, FLOOR - 1, 16 * u + 1, 3, C.green1, 12)
            runeCircle(d, x, FLOOR - 2, 14, t, C.green3, 6, 0.25)
            // hands clawing up first
            if (inWin(t, 0.2, 0.7)) for (let i = 0; i < 3; i++) {
                const hx = x - 8 + i * 8
                const h = R(pr(t, 0.2 + i * 0.05, 0.5) * 6)
                line(d, hx, FLOOR - 1, hx, FLOOR - 1 - h, C.bone1)
                d.set(hx - 1, FLOOR - 1 - h, C.bone1); d.set(hx + 1, FLOOR - 1 - h, C.bone1)
            }
            if (qt(t) >= 0.5) summonIn(d, x, RAISED_DEAD_LOOK, RAISED_DEAD_CLIPS.move, 0, pr(t, 0.5, 1.2))
            motes(d, x, FLOOR, 24, 40, t, 10, 'poison', 60, 26)
        }
    }
]

// ═══════════════════════════════════════════════════════════════ Champion abilities (28)

// All 28 are drawn in vfx-champion.ts (sixth pass, Rounds 15–18); the round-1 effects were deleted
// once every archetype locked (2026-10-02).

// ═══════════════════════════════════════════════════════════════ Training Grounds Actives (18)

function tg(id: string, name: string, owner: string, dur: number, draw: VfxDef['draw']): VfxDef {
    return { id, name, source: 'training', owner, dur, draw }
}

const TRAINING_VFX: VfxDef[] = [
    tg('skill_quick_strike', 'Quick Strike', 'Common', 0.8, (d, t) => {
        const u = pr(t, 0.1, 0.3)
        if (u > 0 && u < 1) line(d, CX + 10, CY - 2, CX + 10 + u * (F[0].x - CX - 10), CY - 2, C.white)
        slash(d, F[0].x - 4, F[0].y, 10, -0.8, 0.8, pr(t, 0.2, 0.4), C.steel2)
        impact(d, F[0].x, F[0].y, t, 0.3, 'steel', 1)
    }),
    tg('skill_steadying_breath', 'Steadying Breath', 'Common', 1.4, (d, t) => {
        for (let k = 0; k < 2; k++) shock(d, CX, CY - 4, t, 0.1 + k * 0.5, 0.8, 18, 6, 'frost')
        motes(d, CX, CY - 10, 10, 10, t, 4, 'frost', 2, 10)
    }),
    tg('skill_coin_toss', 'Coin Toss', 'Common', 1.3, (d, t) => {
        const u = travel(t, 0.1, 0.9)
        if (u >= 0) {
            lob(CX + 4, CY - 10, F[0].x, F[0].y, 30, u)
            const flip = Math.floor(qt(t) * 10) % 3
            if (flip === 0) { disc(d, VP.x, VP.y, 2, C.gold2); d.set(R(VP.x) - 1, R(VP.y) - 1, C.gold3) } else if (flip === 1) { line(d, VP.x - 2, VP.y, VP.x + 2, VP.y, C.gold1) } else disc(d, VP.x, VP.y, 2, C.gold1)
        }
        impact(d, F[0].x, F[0].y, t, 0.9, 'gold', 3)
        if (inWin(t, 0.95, 1.3)) star(d, F[0].x, F[0].y - 12, 3, C.gold2)
    }),
    tg('skill_focused_blow', 'Focused Blow', 'Uncommon', 1.1, (d, t) => {
        if (inWin(t, 0, 0.5)) for (let i = 0; i < 6; i++) { const a = i * 1.05; const r = 10 - pr(t, 0, 0.5) * 8; d.set(R(CX + 10 + Math.cos(a) * r), R(CY - 4 + Math.sin(a) * r), C.gold3) }
        const u = pr(t, 0.5, 0.6)
        if (u > 0 && u < 1) line(d, CX + 10, CY - 4, F[0].x, F[0].y, C.gold3)
        impact(d, F[0].x, F[0].y, t, 0.6, 'spark', 4, true)
        shock(d, F[0].x, F[0].y, t, 0.6, 0.3, 2, 12, 'spark')
    }),
    tg('skill_adrenaline_surge', 'Adrenaline Surge', 'Uncommon', 1.3, (d, t) => {
        const beat = inWin(t, 0.2, 0.3) || inWin(t, 0.5, 0.6)
        // a heart that thumps twice
        const hx = CX
        const hy = CY - 26
        const r = beat ? 3 : 2
        disc(d, hx - r + 1, hy, r, C.red2); disc(d, hx + r - 1, hy, r, C.red2); tri(d, hx - r * 2 + 1, hy + 1, hx + r * 2 - 1, hy + 1, hx, hy + r * 2 + 1, C.red2)
        d.set(hx - 1, hy - 1, C.red3)
        if (beat) shock(d, CX, CY, t, qt(t), 0.1, 8, 14, 'blood')
        if (inWin(t, 0.4, 1.3)) arrows(d, CX + 10, CY - 12, t, true, C.red3)
    }),
    tg('skill_prospectors_instinct', 'Prospector\'s Instinct', 'Uncommon', 1.4, (d, t) => {
        for (let i = 0; i < 3; i++) if (inWin(t, 0.2 + i * 0.2, 0.5 + i * 0.2)) star(d, F[i]!.x, F[i]!.y - 18, 2, C.gold2)
        burst(d, F[0].x, F[0].y, t, 0.8, 10, 40, 'gold', 5, 0.6, 120, -Math.PI / 2, 1.6)
        motes(d, CX, CY + 10, 16, 24, t, 6, 'gold', 6, 20)
    }),
    tg('skill_piercing_focus', 'Piercing Focus', 'Rare', 1.2, (d, t) => {
        const tg0 = F[0]
        if (inWin(t, 0, 0.6)) { const r = R(8 - pr(t, 0, 0.5) * 4); line(d, tg0.x - r - 3, tg0.y, tg0.x - r, tg0.y, C.cyan); line(d, tg0.x + r, tg0.y, tg0.x + r + 3, tg0.y, C.cyan); line(d, tg0.x, tg0.y - r - 3, tg0.x, tg0.y - r, C.cyan); line(d, tg0.x, tg0.y + r, tg0.x, tg0.y + r + 3, C.cyan) }
        if (inWin(t, 0.6, 0.8)) line(d, CX + 10, CY - 4, 160, CY - 4, C.white)
        impact(d, tg0.x, CY - 4, t, 0.65, 'frost', 7); impact(d, F[1].x, CY - 4, t, 0.7, 'frost', 8)
    }),
    tg('skill_vigor_renewal', 'Vigor Renewal', 'Rare', 1.5, (d, t) => {
        const q = qt(t)
        for (let i = 0; i < 14; i++) {
            const a = q * 6 + i * 0.45
            const y = FLOOR - ((q * 30 + i * 3) % 34)
            d.set(R(CX + Math.cos(a) * 9), R(y), i & 1 ? C.green4 : C.green3)
        }
        healRise(d, CX, CY, t, 9)
    }),
    tg('skill_gamblers_strike', 'Gambler\'s Strike', 'Rare', 1.3, (d, t) => {
        // a die tumbles, lands on a face, and the strike follows
        const u = travel(t, 0.05, 0.6)
        const x = u >= 0 ? CX + 8 + u * 40 : CX + 48
        const y = u >= 0 ? CY - 20 - Math.sin(u * Math.PI) * 10 : CY - 20
        rect(d, x - 3, y - 3, 7, 7, C.white); rect(d, x - 3, y + 3, 7, 1, C.bone0)
        const face = u >= 0 ? Math.floor(qt(t) * 10) % 6 : 5
        const pips = [[0, 0], [-2, -2], [2, 2], [-2, 2], [2, -2], [-2, 0], [2, 0]]
        const show = [[0], [1, 2], [0, 1, 2], [1, 2, 3, 4], [0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]][face]!
        for (const k of show) d.set(x + pips[k]![0]!, y + pips[k]![1]!, C.red1)
        slash(d, F[0].x - 4, F[0].y, 12, -1.2, 1.0, pr(t, 0.7, 0.9), C.gold2)
        impact(d, F[0].x, F[0].y, t, 0.8, 'gold', 10, true)
    }),
    tg('skill_twin_strike', 'Twin Strike', 'Epic', 1.1, (d, t) => {
        slash(d, F[0].x - 4, F[0].y, 14, -2.2, 0.2, pr(t, 0.1, 0.35), C.purple2)
        slash(d, F[0].x + 4, F[0].y, 14, -0.9, 1.9, pr(t, 0.35, 0.6), C.pink)
        impact(d, F[0].x, F[0].y - 3, t, 0.3, 'arcane', 11); impact(d, F[0].x, F[0].y + 3, t, 0.55, 'arcane', 12)
    }),
    tg('skill_battlefield_surge', 'Battlefield Surge', 'Epic', 1.4, (d, t) => {
        shock(d, CX, FLOOR - 1, t, 0.1, 0.6, 4, 90, 'spark', true, 2)
        burst(d, CX, FLOOR - 2, t, 0.1, 20, 70, 'spark', 13, 0.7, 60, -Math.PI / 2, 2.6)
        if (inWin(t, 0.4, 1.4)) for (const a of A) arrows(d, a.x, a.y + HEAD - 6, t, true, C.orange)
        for (let i = 0; i < 3; i++) impact(d, F[i]!.x, FLOOR - 6, t, 0.35 + i * 0.1, 'spark', 14 + i)
    }),
    tg('skill_treasure_hunters_gambit', 'Treasure Hunter\'s Gambit', 'Epic', 1.5, (d, t) => {
        // a chest bursts open and spills gold
        const x = F[0].x - 16
        const y = FLOOR - 6
        rect(d, x - 6, y, 13, 6, C.brown2); rect(d, x - 6, y, 13, 1, C.brown3); rect(d, x - 1, y + 1, 3, 3, C.gold2)
        const lid = pr(t, 0.2, 0.4)
        line(d, x - 6, y - 1, R(x - 6 + 12 * Math.cos(lid * 1.8)), R(y - 1 - 12 * Math.sin(lid * 1.8)), C.brown1, 2)
        burst(d, x, y - 2, t, 0.4, 20, 60, 'gold', 18, 0.9, 140, -Math.PI / 2, 1.6)
        if (inWin(t, 0.4, 1.0)) ditherDisc(d, x, y - 2, 8, C.gold3, 4)
    }),
    tg('skill_executioners_edge', 'Executioner\'s Edge', 'Legendary', 1.4, (d, t) => {
        const tg0 = F[0]
        const u = pr(t, 0.2, 0.55)
        const y = R(-20 + eo(u) * (tg0.y + 20))
        if (u > 0 && qt(t) < 1.0) {
            // a guillotine blade dropping out of the sky
            tri(d, tg0.x - 10, y, tg0.x + 10, y - 6, tg0.x + 10, y + 4, C.steel2)
            line(d, tg0.x - 10, y, tg0.x + 10, y + 4, C.white)
            rect(d, tg0.x - 12, y - 14, 3, 14, C.brown1); rect(d, tg0.x + 10, y - 14, 3, 14, C.brown1)
        }
        impact(d, tg0.x, tg0.y, t, 0.55, 'blood', 19, true)
        shock(d, tg0.x, tg0.y, t, 0.55, 0.4, 4, 20, 'blood', false, 2)
    }),
    tg('skill_phoenix_draught', 'Phoenix Draught', 'Legendary', 1.6, (d, t) => {
        if (inWin(t, 0, 0.4)) { rect(d, CX + 6, CY - 12, 4, 6, C.red1); rect(d, CX + 7, CY - 14, 2, 2, C.bone1); d.set(CX + 7, CY - 11, C.orange) }
        const u = eo(pr(t, 0.4, 1.0))
        if (u > 0) {
            // fire wings opening behind the drinker
            for (let s2 = -1; s2 <= 1; s2 += 2) for (let i = 0; i < 6; i++) {
                const len = R((10 + i * 2) * u)
                line(d, CX, CY - 8, CX + s2 * len, CY - 16 - i * 2 + i * i * 0.3, i < 2 ? C.gold3 : i < 4 ? C.orange : C.lava1)
            }
            motes(d, CX, CY + 10, 20, 36, t, 12, 'fire', 20, 40)
        }
        if (inWin(t, 0.8, 1.6)) healRise(d, CX, CY, t, 21, C.orange, C.gold3)
    }),
    tg('skill_fortunes_gambit', 'Fortune\'s Gambit', 'Legendary', 1.6, (d, t) => {
        // three cards fan out, turn, and the winning one flares
        for (let i = 0; i < 3; i++) {
            const u = eo(pr(t, 0.1 + i * 0.08, 0.5 + i * 0.08))
            const x = R(CX + 16 + u * (i - 1) * 14)
            const y = R(CY - 22 - u * 6)
            const faceUp = qt(t) > 0.7 + i * 0.1
            rect(d, x - 3, y - 4, 7, 9, faceUp ? C.white : C.red1)
            if (!faceUp) { rect(d, x - 2, y - 3, 5, 7, C.red2); d.set(x, y, C.gold2) } else { d.set(x, y, i === 1 ? C.gold2 : C.ink) }
        }
        if (inWin(t, 1.0, 1.6)) { star(d, CX + 16, CY - 28, 5, C.gold2); burst(d, CX + 16, CY - 28, t, 1.0, 14, 50, 'gold', 22, 0.5) }
    }),
    tg('skill_ragnarok_strike', 'Ragnarok Strike', 'Mythic', 1.8, (d, t) => {
        ditherDisc(d, 124, 18, 22, C.red0, R(pr(t, 0, 0.4) * 8)) // the sky reddening where it splits
        if (inWin(t, 0.2, 0.7)) bolt(d, 124, 0, 120, 30, t, 23, C.gold3, C.orange, 6) // the sky splits
        const u = pr(t, 0.5, 0.8)
        const y = R(-40 + eo(u) * (FLOOR + 30))
        if (u > 0 && qt(t) < 1.2) {
            // a colossal burning sword falls point-first
            const x = 124
            rect(d, x - 3, y - 40, 7, 40, C.orange); rect(d, x - 1, y - 40, 3, 40, C.gold3)
            tri(d, x - 3, y, x + 3, y, x, y + 8, C.gold3)
            rect(d, x - 10, y - 42, 21, 3, C.gold1); rect(d, x - 2, y - 52, 5, 10, C.brown1)
        }
        if (qt(t) >= 0.8) { shock(d, 124, FLOOR - 1, t, 0.8, 0.6, 6, 70, 'fire', true, 3); burst(d, 124, FLOOR - 4, t, 0.8, 26, 90, 'ember', 24, 0.8, 100, -Math.PI / 2, 2.4, 2) }
        for (let i = 0; i < 3; i++) impact(d, F[i]!.x, F[i]!.y, t, 0.85 + i * 0.05, 'fire', 25 + i, true)
    }),
    tg('skill_aegis_of_renewal', 'Aegis of Renewal', 'Mythic', 1.8, (d, t) => {
        const u = eo(pr(t, 0.1, 0.6))
        if (u > 0) {
            bubble(d, 30, CY, R(6 + u * 26), C.gold3, C.teal3, 3)
            runeCircle(d, 30, CY, 22 * u, t, C.white, 8, 0.9)
        }
        if (inWin(t, 0.6, 1.8)) for (const a of A) healRise(d, a.x, a.y, t, a.x + 26, C.teal3, C.gold3)
        motes(d, 30, FLOOR, 50, 50, t, 12, 'holy', 27, 26)
    }),
    tg('skill_kings_ransom', 'King\'s Ransom', 'Mythic', 1.8, (d, t) => {
        // a crown descends, then a rain of gold across the field
        const u = eo(pr(t, 0, 0.5))
        const cy = R(-8 + u * 26)
        rect(d, CX - 7, cy, 15, 4, C.gold1)
        for (let i = 0; i < 5; i++) tri(d, CX - 7 + i * 3, cy, CX - 5 + i * 3, cy, CX - 6 + i * 3, cy - 5 - (i === 2 ? 2 : 0), C.gold2)
        d.set(CX, cy + 1, C.red2)
        rain(d, 60, 158, 0, FLOOR - 2, t, 0.5, 1.4, 34, C.gold1, C.gold3, 0, 28, 2)
        for (let i = 0; i < 3; i++) if (qt(t) > 0.7) burst(d, F[i]!.x, FLOOR - 2, t, 0.7 + i * 0.2, 6, 30, 'gold', 29 + i, 0.4, 80, -Math.PI / 2, 2)
    })
]

// every Hero skill in class-tree order: its cinematic, or the classic summon effect above
const CLASSIC_BY_ID: Readonly<Record<string, VfxDef>> = Object.fromEntries(CLASS_VFX.map(v => [v.id, v]))
const CLASS_VFX_LIVE: VfxDef[] = CLASS_NODES.map(n => CINEMATIC_BY_ID[n.skill.id] ?? CLASSIC_BY_ID[n.skill.id]!)

export const VFX: readonly VfxDef[] = [...CLASS_VFX_LIVE, ...CHAMPION_STYLED, ...TRAINING_VFX]
export const VFX_BY_ID: Readonly<Record<string, VfxDef>> = Object.fromEntries(VFX.map(v => [v.id, v]))

// ── Multi-strike (asset-list §2.2): the Archer-path single strike, recoloured and repeated ──

export const MULTI_STRIKE = [
    { id: 'archer', label: 'Archer-path single strike (base)', shots: 1, shaft: C.brown3, head: C.steel3, fletch: C.white, ramp: 'steel' as const },
    { id: 'hunter', label: 'Hunter triple strike — recolour, fired 3×', shots: 3, shaft: C.brown2, head: C.orange, fletch: C.gold3, ramp: 'spark' as const },
    { id: 'beast_master', label: 'Beast Master quad strike — recolour, fired 4×', shots: 4, shaft: C.stone2, head: C.steel3, fletch: C.bone1, ramp: 'bone' as const }
]

export function drawMultiStrike(d: Surface, t: number, m: typeof MULTI_STRIKE[number]): void {
    for (let i = 0; i < m.shots; i++) {
        const t0 = 0.05 + i * 0.18
        const u = travel(t, t0, t0 + 0.3)
        const ty = F[0].y - 2 + (i - (m.shots - 1) / 2) * 3
        if (u >= 0) arrow(d, CX + 10 + u * (F[0].x - CX - 12), CY - 6 + (ty - CY + 6) * u, 0, m.shaft, m.head, m.fletch)
        impact(d, F[0].x - 2, ty, t, t0 + 0.3, m.ramp, 70 + i)
    }
}

/** Dim stand-ins for the party and the enemies, for previews (never exported). */
export function drawVfxStage(d: Surface): void {
    rect(d, 0, FLOOR, VL.W, VL.H - FLOOR, C.night0)
    for (const a of A) ditherEllipse(d, a.x, a.y + 4, 4, 11, C.night3, 6)
    for (const f of F) ditherEllipse(d, f.x, f.y + 4, 5, 11, C.stone2, 6)
}

