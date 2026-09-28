// Non-humanoid bodies: the Wolf, world bosses, super bosses and raid bosses.
//
// A creature is a bespoke drawer rather than a rig — Pixel Crusade's monster approach. Each
// drawer receives the state name and the seconds into it, and derives its own pose from a
// few shared phase helpers (wind-up → strike → recover, hit recoil, collapse), sampled on the
// 10 fps grid so every creature steps like hand-drawn frames. The drawer paints into the
// sprite buffer facing right; CreatureActor stamps it with outline, flash, dissolve and flip.

import { ANIM_FPS, frameTime } from './anim'
import { C, CLEAR, type ColorName } from './palette'
import { Surface, StampStyle, stamp, ditherEllipse } from './surface'

export interface StateSpec { dur: number, loop: boolean }

/** Where a boss and the party stand while a special plays, in the space its effect draws in. */
export interface SpecialStage {
    /** The boss's anchor (its feet), and the way it faces: −1, toward the party on its left. */
    bx: number
    by: number
    dir: number
    /** The party's feet, nearest the boss first. */
    party: readonly { readonly x: number, readonly y: number }[]
    /** The feet of the boss's adds still standing, for a special that works on them. */
    adds?: readonly { readonly x: number, readonly y: number }[]
}

/**
 * A boss's special attack, presentation only (bosses have no abilities in the game yet): its body
 * plays the `special` state while `fx` draws what it throws at the party, live over the stage.
 * The stage presents it like a Hero skill: a banner, the scene dimmed toward `tint`, everyone else
 * holding, and `hits` landing on the party on the special's own clock.
 */
export interface BossSpecial {
    name: string
    tint: ColorName
    /** Seconds into the special at which each impact lands. */
    hits: readonly number[]
    /** The hits walk along the party rather than all landing on the nearest. */
    spread: boolean
    /**
     * Who its `hits` land on: the party (the default), or the boss's own adds, for a special that
     * strengthens them rather than striking anyone. The stage only reaches for it while adds stand.
     */
    target?: 'party' | 'adds'
    /** Which party member (nearest first) each hit lands on, when the effect reaches them in its own order. */
    order?: readonly number[]
    fx(s: Surface, t: number, st: SpecialStage): void
}

export interface CreatureDef {
    name: string
    /** Sprite buffer size (square) and the feet anchor's distance from its bottom edge. */
    size: number
    foot?: number
    /**
     * Extra buffer round the body, on each side and twice over at the top, for a swing that
     * reaches past `size`. The anchor keeps its place on the body and the entries still travel by
     * `size`, so room changes nothing but what gets cut off.
     */
    room?: number
    /** Shadow half-width on the floor; 0 for none. Flyers set `hover`. */
    shadow: number
    hover?: number
    states: Readonly<Record<string, StateSpec>>
    /** Paint state `st` at `t` seconds into it. Anchor is (s.ax, s.ay). Writes CF. */
    draw(s: Surface, st: string, t: number): void
    /** Scene-space effects after stamping; (x, y) is the scene anchor, `dir` 1 or −1. */
    fx?(dst: Surface, st: string, t: number, x: number, y: number, dir: number): void
    /** A special attack; `states` then carries a `special` state for the body's part of it. */
    special?: BossSpecial
    /**
     * Every special, for a boss with more than one (a raid boss); the nth plays `specialState(n)`.
     * Set it instead of `special`.
     */
    specials?: readonly BossSpecial[]
    /**
     * Seconds into its death at which the live stage breaks it apart. Left out, the stage finds the
     * frame where the body starts dissolving; a death that shrinks or collapses on purpose sets it,
     * or it would be shattered before its death had played out.
     */
    shatterAt?: number
    /**
     * Already standing in the world rather than arriving: the live stage scrolls it into view with
     * the scenery during the march, and it plays only the settled end of its entry (the roar) once
     * the party stands on its ground. Its full entry is still drawn, for the gallery.
     */
    scrollsIn?: boolean
    /** Px the live stage stands it below its mark: a tall body brought down clear of the top of the camera. */
    lower?: number
    accent: number
}

/** A boss's specials, one or many. */
export function specialsOf(def: CreatureDef): readonly BossSpecial[] {
    return def.specials ?? (def.special ? [def.special] : [])
}

/** The state the nth special's body plays: `special`, then `special2`, `special3`… */
export function specialState(n: number): string {
    return n ? `special${n + 1}` : 'special'
}

/**
 * Per-frame flags a drawer sets (reset before each draw). `shadow` scales the floor shadow's
 * size and darkness, 0..1: a body coming down from the sky casts a small, faint one at first.
 */
export const CF = { flash: false, fade: 0, rim: CLEAR as number, lut: null as Uint8Array | null, shadow: 1 }

// ── Phase helpers ──────────────────────────────────────────────────────────────────

/** Quantized time. */
export function q(t: number): number { return frameTime(t) }

/** 0..1 progress of `t` through [a, b], clamped, on the frame grid. */
export function span(t: number, a: number, b: number): number {
    const u = (q(t) - a) / (b - a)
    return u < 0 ? 0 : u > 1 ? 1 : u
}

/** Smoothstep. */
export function sm(u: number): number { return u * u * (3 - 2 * u) }

/**
 * Attack phases over a clip of `dur`: `wind` rises 0→1 over the first 45%, `strike` is true
 * for the next 15%, `rec` falls 1→0 after. `lunge` is a forward offset peaking at the strike.
 */
export const A = { wind: 0, strike: false, rec: 0, lunge: 0 }
export function attackPhase(t: number, dur: number, reach: number): void {
    const u = q(t) / dur
    A.wind = 0; A.strike = false; A.rec = 0; A.lunge = 0
    if (u < 0.45) { A.wind = sm(Math.min(1, u / 0.4)); A.lunge = -Math.round(A.wind * 2) } else if (u < 0.6) {
        A.strike = true; A.rec = 1; A.lunge = reach
    } else { A.rec = 1 - sm((u - 0.6) / 0.4); A.lunge = Math.round(reach * A.rec * A.rec) }
}

/** Blend a value between rest, full wind-up and full strike, per the current phase. */
export function pz(rest: number, w: number, s: number): number {
    return A.wind > 0 ? rest + (w - rest) * A.wind : rest + (s - rest) * A.rec
}

/** How long a hit or a death flashes white, whatever the frame rate: a fixed beat, not one frame. */
const FLASH_SECONDS = 0.1

/** Hit recoil: flash on the first frame, knock back `kb` px, easing out over the state. */
export function hitPhase(t: number, dur: number): number {
    const u = q(t) / dur
    CF.flash = q(t) < FLASH_SECONDS
    return Math.round((1 - u) * 3)
}

/** Death: collapse progress 0..1 over the first 55%, then a dissolve to nothing. */
export function deathPhase(t: number, dur: number): number {
    const u = q(t) / dur
    if (q(t) < FLASH_SECONDS) CF.flash = true
    if (u > 0.55) CF.fade = Math.min(16, Math.round((u - 0.55) / 0.45 * 17))
    return sm(Math.min(1, u / 0.55))
}

/** Frame index at `fps`, looping over `n`. */
export function fr(t: number, fps: number, n: number): number {
    return Math.floor(q(t) * fps + 1e-6) % n
}

/** Whole-pixel sine on the frame grid. */
export function wv(t: number, period: number, amp: number, phase = 0): number {
    return Math.round(Math.sin((q(t) / period + phase) * Math.PI * 2) * amp)
}

// ── Actor ──────────────────────────────────────────────────────────────────────────

const BUFS = new Map<number, Surface>()

function bufFor(size: number, foot: number): Surface {
    const key = size * 1000 + foot
    let b = BUFS.get(key)
    if (!b) { b = new Surface(size, size, size >> 1, size - foot); BUFS.set(key, b) }
    return b
}

const STYLE = new StampStyle()

/** The side of the square buffer a creature is drawn into: its size, and any room round it. */
export function bufferSize(def: CreatureDef): number {
    return def.size + 2 * (def.room ?? 0)
}

/**
 * Draw creature `def` in state `st` at `t` onto `dst`, anchor (x, y). `facing` −1 mirrors
 * (a boss faces left toward the party). `mark` adds a halo outline.
 */
export function drawCreature(dst: Surface, x: number, y: number, def: CreatureDef, st: string, t: number, facing: 1 | -1 = 1, mark: number = CLEAR): void {
    const s = bufFor(bufferSize(def), def.foot ?? 6)
    s.clear()
    CF.flash = false
    CF.fade = 0
    CF.rim = CLEAR
    CF.lut = null
    CF.shadow = 1
    def.draw(s, st, t)
    const rx = Math.round(def.shadow * CF.shadow)
    const level = Math.round((def.hover ? 5 : 9) * CF.shadow)
    if (rx > 0 && level > 0 && CF.fade < 12) ditherEllipse(dst, x, y, rx, Math.max(1, rx >> 3), C.ink, level)
    const style = STYLE.reset()
    style.flip = facing === -1
    style.flash = CF.flash ? C.white : CLEAR
    style.dissolve = CF.fade
    style.rim = CF.rim
    style.rimDx = 1
    style.lut = CF.lut
    style.halo = mark
    stamp(dst, s, x, y, style)
    if (def.fx && !CF.flash) def.fx(dst, st, t, Math.round(x), Math.round(y), facing)
}

/** Frame count of a state at the authoring rate. */
export function stateFrames(def: CreatureDef, st: string): number {
    return Math.max(1, Math.round(def.states[st]!.dur * ANIM_FPS))
}
