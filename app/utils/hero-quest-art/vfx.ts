// Ability VFX (asset-list §2.1): one custom effect per ability — 16 Hero skills, 28 Champion
// abilities and the 18 Training Grounds Actives. 62 in all, none shared: a pulled Skill must
// not look like a skin of something already owned.
//
// Every effect is authored on the VL stage (party left, three enemies right) and is a pure
// function of time, so any frame can be drawn on its own. The live battle passes the same
// functions its own coordinates through `VL` before drawing.

import { C } from './palette'
import type { Surface} from './surface';
import { line, rect, ditherEllipse } from './surface'
import { VL, pr, inWin, qt, motes, shock, travel, impact, healRise, column, runeCircle, R, type VfxDim } from './vfx-kit'
import { arrow } from './weapons'
import { Actor, HP } from './rig'
import { sample } from './anim'
import { DISCIPLE_CLIPS, DISCIPLE_LOOK, RAISED_DEAD_CLIPS, RAISED_DEAD_LOOK } from './summons'
import { CLASS_NODES } from '../../../shared/utils/hero-quest/content/classes'
import { CINEMATIC_BY_ID } from './vfx-cinematic'
import { CHAMPION_STYLED } from './vfx-champion'
import { TRAINING_STYLED } from './vfx-training'

export type VfxSource = 'class' | 'champion' | 'training'

export interface VfxDef {
    id: string
    name: string
    source: VfxSource
    /** Who owns it: a class node, an archetype, or a rarity. */
    owner: string
    dur: number
    draw(dst: Surface, t: number): void
    /** Screens the whole stage toward ink while it plays, behind the bodies (`dimLevel`). */
    dim?: VfxDim
}

const F = VL.foes
const A = VL.allies
const CX = VL.caster.x
const CY = VL.caster.y
const FLOOR = VL.floor

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

// All 18 are drawn in vfx-training.ts (sixth pass, Round 19); the round-1 effects were deleted when
// they locked (2026-10-02).

// every Hero skill in class-tree order: its cinematic, or the classic summon effect above
const CLASSIC_BY_ID: Readonly<Record<string, VfxDef>> = Object.fromEntries(CLASS_VFX.map(v => [v.id, v]))
// the Ascendant's own skill is never cast: Convergence fires the masters' skills, which have theirs
const CLASS_VFX_LIVE: VfxDef[] = CLASS_NODES.filter(n => n.tier !== 'capstone').map(n => CINEMATIC_BY_ID[n.skill.id] ?? CLASSIC_BY_ID[n.skill.id]!)

export const VFX: readonly VfxDef[] = [...CLASS_VFX_LIVE, ...CHAMPION_STYLED, ...TRAINING_STYLED]
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

