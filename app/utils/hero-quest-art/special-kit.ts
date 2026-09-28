// Boss specials: where the fight stands, and the gallery's preview of one.
//
// A special is presentation only (bosses have no abilities in the game yet). Its body is the
// boss's `special` state, baked like any other; its effect (`BossSpecial.fx`) draws live in scene
// space over the party. The live stage and the gallery preview both place the boss and the party
// with `STAGE`, so an effect aimed in one lands in the other.

import { C, RAMP, SCENERY, luma, type RampName } from './palette'
import { Surface, rect, line, disc, ditherEllipse, hash2, bayer } from './surface'
import { VL, pr, qt, R } from './vfx-kit'
import type { Ramp6 } from './vfx-cinematic'
import { FLOOR_Y, SW, SH } from './scenery-kit'
import { drawCreature, specialsOf, specialState, type CreatureDef, type SpecialStage } from './creature'
import { TRAINING_DUMMY } from './raids'

/** Where the VFX stage sits in the scene (the live stage's origin), and the boss's offset from its mark. */
export const STAGE = { ox: 64, oy: FLOOR_Y + 4 - VL.floor, bossDx: 6 } as const

/** The window the gallery preview shows: the live stage's chosen camera (Zoom 3). */
const VIEW = { x: 29, y: 27, w: 272, h: 153 } as const

/**
 * A raid boss is previewed as the live stage fights it: on the whole-scene camera, standing on the
 * near rank well back (demo.ts gives it the same mark and offset).
 */
const RAID_VIEW = { x: 0, y: 0, w: SW, h: SH } as const
const RAID_DX = 22
/** How far in front of their marks a raid boss's adds stand (demo.ts moves them the same). */
const ADD_BACK = 44

/** The fight as the gallery previews it: the boss on its mark, the party on theirs. */
export function previewStage(raid = false): SpecialStage {
    const m = raid ? VL.foes[0] : VL.foes[1]!
    const party = VL.allies.map(a => ({ x: STAGE.ox + a.x, y: STAGE.oy + a.g })).sort((a, b) => b.x - a.x)
    return { bx: STAGE.ox + m.x + (raid ? RAID_DX : STAGE.bossDx), by: STAGE.oy + m.g, dir: -1, party }
}

/** The party member the `i`th hit of a special lands on: walking the line if `spread`, else the nearest. */
export function hitTarget(st: SpecialStage, i: number, spread: boolean): { readonly x: number, readonly y: number } {
    return st.party[spread ? i % st.party.length : 0]!
}

/** 0..1 through [a, b] of a special's clock, clamped. */
export const sp = pr

/** Seconds on a special's clock, on the frame grid unless the live stage is drawing. */
export const sq = qt

const PREVIEW = new Surface(SW, SH, 0, 0)

/**
 * A boss's `n`th special in the gallery, frame at `t`, with `adds` standing before it: a dark stage, the training dummy standing in on each
 * party mark facing the boss, the boss playing its special and the effect over them all, cropped
 * to the live stage's camera.
 */
export function drawSpecialPreview(dst: Surface, def: CreatureDef, t: number, n = 0, raid = false, adds: readonly CreatureDef[] = []): void {
    const s = PREVIEW
    const st = previewStage(raid)
    // its adds on the near marks in front of it, as the live stage sets them out
    const marks = adds.map((_, k) => ({ x: STAGE.ox + VL.foes[k]!.x - ADD_BACK, y: STAGE.oy + VL.foes[k]!.g }))
    st.adds = marks
    const VIEW = raid ? RAID_VIEW : PREVIEW_VIEW
    // scenery colours, as the live stage has behind the fight, so effects that recolour bodies leave it be
    rect(s, 0, 0, SW, SH, C.slate0)
    for (let y = 0; y < FLOOR_Y - 30; y += 4) rect(s, 0, y, SW, 2, C.slate1)
    rect(s, 0, FLOOR_Y - 30, SW, SH - FLOOR_Y + 30, C.rock0)
    rect(s, 0, FLOOR_Y - 30, SW, 1, C.slate2)
    for (const p of [...st.party].sort((a, b) => a.y - b.y)) drawCreature(s, p.x, p.y, TRAINING_DUMMY, 'static', 0, 1)
    for (let k = marks.length - 1; k >= 0; k--) drawCreature(s, marks[k]!.x, marks[k]!.y, adds[k]!, 'idle', t, -1)
    drawCreature(s, st.bx, st.by, def, specialState(n), t, -1)
    specialsOf(def)[n]!.fx(s, t, st)
    for (let y = 0; y < VIEW.h; y++) dst.data.set(s.data.subarray((VIEW.y + y) * SW + VIEW.x, (VIEW.y + y) * SW + VIEW.x + VIEW.w), y * dst.w)
}

export const PREVIEW_VIEW = VIEW
export const PREVIEW_RAID_VIEW = RAID_VIEW

// ── Effect kit ─────────────────────────────────────────────────────────────────────
// Scene-space pieces the specials share. All take absolute times on the special's clock.

export const FIRE6: Ramp6 = [C.white, C.gold3, C.gold2, C.orange, C.lava1, C.red1]
export const DUST6: Ramp6 = [C.white, C.bone1, C.bone0, C.stone3, C.stone2, C.stone1]
export const FROST6: Ramp6 = [C.white, C.frost, C.cyan, C.blue2, C.blue1, C.blue0]
export const WATER6: Ramp6 = [C.white, C.frost, C.teal3, C.teal2, C.teal1, C.teal0]
export const VOID6: Ramp6 = [C.white, C.pink, C.purple2, C.purple1, C.purple0, C.void]
export const STORM6: Ramp6 = [C.white, C.white, C.frost, C.cyan, C.blue2, C.blue1]
export const BONE6: Ramp6 = [C.white, C.bone1, C.bone1, C.bone0, C.stone2, C.stone1]
export const ROT6: Ramp6 = [C.white, C.green4, C.olive2, C.olive1, C.olive0, C.green0]

/** Fire burning along the ground at `y` over a strip `w` wide, [t0, t1), tongues up to `tall`. */
export function flames(s: Surface, x: number, y: number, w: number, t: number, t0: number, t1: number, seed: number, tall = 10): void {
    const q = qt(t)
    if (q < t0 || q >= t1) return
    const grow = Math.min(1, (q - t0) / 0.15)
    const fade = Math.min(1, (t1 - q) / 0.4)
    const f = Math.floor(q * 12)
    const n = Math.max(1, R(w / 2))
    ditherEllipse(s, x, y, w / 2 + 2, 1.5, C.lava0, 8)
    for (let i = 0; i < n; i++) {
        const xx = R(x - w / 2 + i * 2 + hash2(seed, i))
        const h = R(tall * grow * fade * (0.35 + 0.65 * hash2(seed + f, i)))
        for (let k = 0; k < h; k++) {
            const u = k / Math.max(1, h)
            s.set(xx, y - 1 - k, u < 0.25 ? C.gold3 : u < 0.55 ? C.gold2 : u < 0.8 ? C.orange : C.lava1)
        }
        if (h > 1) s.set(xx, y - 1 - h, (f + i) & 3 ? C.red1 : C.gold3)
    }
}

/** Clods, shards or drops flung up from (x, y) at t0 in `ramp`, falling back to `ground`. */
export function debris(s: Surface, x: number, y: number, ground: number, t: number, t0: number, n: number, spd: number, ramp: RampName, seed: number, life = 0.8): void {
    const age0 = qt(t) - t0
    if (age0 < 0 || age0 > life) return
    const rp = RAMP[ramp]
    for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (hash2(seed, i) - 0.5) * 2.2
        const v = spd * (0.4 + hash2(seed + 1, i) * 0.6)
        const px = x + Math.cos(a) * v * age0
        const py = Math.min(ground, y + Math.sin(a) * v * age0 + 150 * age0 * age0)
        const c = rp[Math.min(rp.length - 1, Math.floor(age0 / life * rp.length))]!
        rect(s, R(px), R(py), 2, 2, c)
    }
}

/** A tapering spike from the ground at (x, y), `h` tall, leaning `lean` px at the tip: a thorn, an icicle, a claw. */
export function spike(s: Surface, x: number, y: number, h: number, w: number, lean: number, dark: number, lit: number, tip: number): void {
    if (h < 1) return
    for (let k = 0; k < h; k++) {
        const u = k / h
        const hw = Math.max(0, R(w * (1 - u)))
        const cx = R(x + lean * u * u)
        line(s, cx - hw, y - k, cx + hw, y - k, dark)
        if (hw > 0) s.set(cx - hw, y - k, lit)
    }
    s.set(R(x + lean), y - h, tip)
}

/** A crack running along the ground from (x0, y0) to (x1, y1), glowing `c` with a hot `core`. */
export function crack(s: Surface, x0: number, y0: number, x1: number, y1: number, u: number, seed: number, c: number, core: number): void {
    const steps = Math.max(2, R(Math.hypot(x1 - x0, y1 - y0) / 4))
    let px = x0
    let py = y0
    for (let i = 1; i <= R(steps * Math.min(1, u)); i++) {
        const nx = x0 + (x1 - x0) * i / steps
        const ny = y0 + (y1 - y0) * i / steps + (hash2(seed, i) - 0.5) * 2
        line(s, R(px), R(py) + 1, R(nx), R(ny) + 1, c)
        line(s, R(px), R(py), R(nx), R(ny), core)
        px = nx
        py = ny
    }
}

/** A disc of darkness dropped over (x, y), `r` across, dithered at its edge: a pool, a shadow, a pit. */
export function pit(s: Surface, x: number, y: number, r: number, inner: number, outer: number): void {
    ditherEllipse(s, x, y, r + 3, (r + 3) * 0.3, outer, 8)
    ditherEllipse(s, x, y, r, r * 0.3, inner, 14)
}

const GREYS = [C.ink, C.stone0, C.stone1, C.stone2, C.stone3, C.steel2, C.steel3, C.white]
let GREY_LUT: Uint8Array | null = null

/**
 * Drain the colour out of the bodies in a box: every character-tier pixel in it goes to the grey
 * nearest its brightness, `level` 0..16 of them through the dither. Scenery is left alone, so only
 * what stands there loses its colour.
 */
export function drain(s: Surface, x: number, y: number, w: number, h: number, level: number): void {
    if (level <= 0) return
    if (!GREY_LUT) {
        const greys = GREYS.map(g => luma(g))
        GREY_LUT = new Uint8Array(256)
        for (let i = 1; i < 256; i++) {
            const l = luma(i)
            let best = 0
            for (let k = 1; k < GREYS.length; k++) if (Math.abs(greys[k]! - l) < Math.abs(greys[best]! - l)) best = k
            GREY_LUT[i] = GREYS[best]!
        }
    }
    for (let yy = R(y); yy < y + h; yy++) {
        for (let xx = R(x); xx < x + w; xx++) {
            const c = s.get(xx, yy)
            if (!c || SCENERY.has(c) || !bayer(xx, yy, level)) continue
            s.set(xx, yy, GREY_LUT[c]!)
        }
    }
}

/** A body-height hit on a party member: its chest. */
export function chest(p: { readonly x: number, readonly y: number }): number {
    return p.y - 14
}

export { disc, line, rect }
