// Procedural hero sprites for the four classes. Each class is a small skeleton of
// pose parameters (weapon angle, hand, lean, crouch, jump) keyed per attack frame.
// Frames are held like real sprite frames rather than tweened.

import { C } from './palette'
import { line, rect, px, disc, ring, type SpriteBuffer } from './pixel'
import type { ClassId } from './economy'

type Ctx = CanvasRenderingContext2D

export interface HeroPose {
    /** Idle clock (seconds). */
    t: number
    running: boolean
    /** Run cycle clock (seconds). */
    run: number
    /** Attack progress 0..1, or -1 when not attacking. */
    attack: number
    special: boolean
    /** Hit recoil 1 → 0. */
    hurt: number
    /** Special charge 0..1 (1 = ready). */
    charge: number
}

/** Attack frame for a progress value: 0 idle, 1–2 wind-up, 3 strike, 4 follow-through, 5 settle. */
export function attackFrame(a: number): number {
    if (a < 0) return 0
    if (a < 0.22) return 1
    if (a < 0.45) return 2
    if (a < 0.6) return 3
    if (a < 0.8) return 4
    return 5
}

/** Progress at which a hit lands (melee) or a projectile leaves (ranged). */
export const IMPACT_AT = 0.45

// Keyframes: [weaponAngle, handX, handY, lean, crouch, jump, backHandX, backHandY]
// (Ranger uses slot 6 as bow pull 0..1; Mage uses slot 6 as gem glow 0..3.)
type Key = readonly [number, number, number, number, number, number, number, number]

const WARRIOR: readonly Key[] = [
    [-1.05, 4, -10, 0, 0, 0, -4, -10],
    [-2.1, 0, -17, -1, 1, 0, -5, -11],
    [-2.75, -2, -19, -2, 2, 0, -6, -12],
    [0.35, 8, -13, 2, 1, 0, -3, -12],
    [0.75, 7, -10, 2, 2, 0, -3, -11],
    [-0.3, 5, -11, 1, 1, 0, -4, -10]
]
const WARRIOR_SPECIAL: readonly Key[] = [
    WARRIOR[0]!,
    [-1.6, 1, -19, -1, 3, 0, -3, -17],
    [-1.8, 1, -22, 0, 0, -12, -2, -21],
    [1.0, 8, -8, 3, 3, 0, -4, -9],
    [1.1, 8, -7, 3, 3, 0, -4, -9],
    [0.2, 6, -10, 1, 1, 0, -4, -10]
]
const RANGER: readonly Key[] = [
    [0.9, 5, -10, 0, 0, 0, 0, 0],
    [0, 6, -14, -1, 0, 0, 0.45, 0],
    [0, 6, -14, -1, 1, 0, 1, 0],
    [0, 6, -14, 0, 0, 0, 0, 1],
    [0.08, 6, -13, 0, 0, 0, 0, 1],
    [0.5, 5, -11, 0, 0, 0, 0, 0]
]
const RANGER_SPECIAL: readonly Key[] = [
    RANGER[0]!,
    [-0.7, 5, -15, -1, 1, 0, 0.5, 0],
    [-0.95, 5, -16, -2, 2, 0, 1, 0],
    [-0.95, 5, -16, -1, 0, 0, 0, 1],
    [-0.8, 5, -15, -1, 0, 0, 0, 1],
    [0.3, 5, -12, 0, 0, 0, 0, 0]
]
const MAGE: readonly Key[] = [
    [-1.45, 5, -11, 0, 0, 0, 0, 0],
    [-1.35, 6, -16, -1, 0, 0, 1, 0],
    [-1.2, 6, -20, -1, 0, 0, 2, 0],
    [-0.45, 10, -15, 2, 0, 0, 3, 0],
    [-0.7, 9, -14, 1, 0, 0, 1, 0],
    [-1.2, 6, -12, 0, 0, 0, 0, 0]
]
const MAGE_SPECIAL: readonly Key[] = [
    MAGE[0]!,
    [-1.57, 5, -19, -1, 0, -1, 2, 0],
    [-1.57, 5, -23, -1, 0, -3, 3, 0],
    [-1.57, 5, -23, -1, 0, -4, 3, 0],
    [-1.4, 6, -18, 0, 0, -2, 1, 0],
    [-1.45, 5, -12, 0, 0, 0, 0, 0]
]
const PALADIN: readonly Key[] = [
    [-1.25, 4, -10, 0, 0, 0, 1, -8],
    [-2.3, 0, -18, -1, 1, 0, -2, -16],
    [-2.9, -2, -20, -2, 2, 0, -3, -18],
    [0.2, 8, -12, 2, 1, 0, 4, -12],
    [0.6, 7, -9, 2, 2, 0, 4, -9],
    [-0.6, 5, -11, 1, 1, 0, 2, -10]
]
const PALADIN_SPECIAL: readonly Key[] = [
    PALADIN[0]!,
    [-1.57, 3, -20, 0, 1, 0, 1, -18],
    [-1.57, 3, -24, 0, 0, -2, 1, -22],
    [0.9, 8, -9, 3, 3, 0, 5, -9],
    [0.9, 8, -9, 3, 3, 0, 5, -9],
    [-0.4, 5, -11, 1, 1, 0, 3, -10]
]

function keys(id: ClassId, special: boolean): readonly Key[] {
    switch (id) {
        case 'warrior': return special ? WARRIOR_SPECIAL : WARRIOR
        case 'ranger': return special ? RANGER_SPECIAL : RANGER
        case 'mage': return special ? MAGE_SPECIAL : MAGE
        case 'paladin': return special ? PALADIN_SPECIAL : PALADIN
    }
}

/** Accent colour per class: rim light, charge glow, smear tint. */
export const ACCENT: Record<ClassId, string> = {
    warrior: C.gold2,
    ranger: C.green4,
    mage: C.cyan,
    paladin: C.gold3
}

// Body offset state written by drawHero so the engine can find the weapon tip.
export const heroTip = { x: 0, y: 0 }

let ox = 0
let oy = 0
let bx = 0
let by = 0

function limb(g: Ctx, x0: number, y0: number, x1: number, y1: number, c: string): void {
    line(g, x0, y0, x1, y1, c, 2)
}

// ------------------------------------------------------------------ legs

function legs(g: Ctx, p: HeroPose, frame: number, crouch: number, jump: number, boot: string, bootHi: string, pants: string, pantsDk: string): void {
    const hipY = oy - 8 + crouch + jump
    let fAx = 2
    let fBx = -3
    let lA = 0
    let lB = 0
    if (p.running && frame === 0) {
        const rf = Math.floor(p.run * 12) % 6
        // 6-frame run: contact, down, pass, contact, down, pass (legs mirrored)
        const X = RUN_X[rf]!
        fAx = X[0]; lA = X[1]; fBx = X[2]; lB = X[3]
    } else if (frame === 3 || frame === 4) {
        fAx = 5; fBx = -5
    } else if (frame === 1 || frame === 2) {
        fAx = 3; fBx = -4
    }
    if (jump < 0) { fAx = 2; lA = 3; fBx = -3; lB = 2 }
    // back leg
    const bY = oy + jump - lB
    limb(g, ox - 1, hipY, ox + fBx, bY - 2, pantsDk)
    rect(g, ox + fBx - 1, bY - 2, 3, 2, boot)
    // front leg
    const aY = oy + jump - lA
    limb(g, ox + 1, hipY, ox + fAx, aY - 2, pants)
    rect(g, ox + fAx - 1, aY - 2, 4, 2, boot)
    px(g, ox + fAx, aY - 2, bootHi)
}

const RUN_X: readonly (readonly [number, number, number, number])[] = [
    [5, 0, -4, 1],
    [3, 0, -2, 2],
    [0, 1, 1, 0],
    [-4, 1, 5, 0],
    [-2, 2, 3, 0],
    [1, 0, 0, 1]
]

// ------------------------------------------------------------------ weapons

function sword(g: Ctx, hx: number, hy: number, a: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    // blade, then a highlight edge offset one pixel toward the top side
    const tx = Math.round(hx + dx * 14)
    const ty = Math.round(hy + dy * 14)
    const sx = Math.round(hx + dx * 2)
    const sy = Math.round(hy + dy * 2)
    line(g, sx, sy, tx, ty, C.steel2, 2)
    const nx = Math.round(dy)
    const ny = Math.round(-dx)
    line(g, sx - nx, sy + ny, tx - nx, ty + ny, C.steel3)
    px(g, tx, ty, C.white)
    // guard
    const gx = Math.round(hx + dx * 2)
    const gy = Math.round(hy + dy * 2)
    line(g, gx - Math.round(-dy * 3), gy - Math.round(dx * 3), gx + Math.round(-dy * 3), gy + Math.round(dx * 3), C.gold2, 1)
    px(g, gx, gy, C.gold3)
    // grip + pommel
    line(g, hx, hy, Math.round(hx - dx * 2), Math.round(hy - dy * 2), C.brown1)
    px(g, Math.round(hx - dx * 3), Math.round(hy - dy * 3), C.gold1)
    heroTip.x = tx; heroTip.y = ty
}

function shield(g: Ctx, x: number, y: number): void {
    // round shield, seen from the side-front
    rect(g, x - 3, y - 5, 6, 11, C.steel1)
    rect(g, x - 2, y - 6, 4, 13, C.steel1)
    rect(g, x - 2, y - 4, 4, 9, C.brown2)
    rect(g, x - 1, y - 5, 2, 11, C.brown2)
    rect(g, x - 2, y - 4, 1, 9, C.brown3)
    rect(g, x, y - 2, 1, 5, C.red2)
    rect(g, x - 1, y, 3, 1, C.red2)
    px(g, x, y, C.gold2)
}

function bow(g: Ctx, hx: number, hy: number, a: number, pull: number, released: boolean): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const nx = -dy
    const ny = dx
    const bend = 3 + Math.round(pull * 2)
    let t0x = 0, t0y = 0, t1x = 0, t1y = 0
    for (let i = -8; i <= 8; i++) {
        const k = i / 8
        const b = Math.round(bend * Math.cos(k * Math.PI * 0.5)) - 1
        const x = Math.round(hx + nx * i + dx * b)
        const y = Math.round(hy + ny * i + dy * b)
        const edge = i <= -7 || i >= 7
        px(g, x, y, edge ? C.brown1 : (i < 0 ? C.brown3 : C.brown2))
        if (!edge) px(g, x + (i < 0 ? 0 : 0), y + 1, C.brown1)
        if (i === -8) { t0x = x; t0y = y }
        if (i === 8) { t1x = x; t1y = y }
    }
    const pl = released ? 0 : 1 + pull * 8
    const pxx = Math.round(hx - dx * pl)
    const pyy = Math.round(hy - dy * pl)
    line(g, t0x, t0y, pxx, pyy, C.bone1)
    line(g, pxx, pyy, t1x, t1y, C.bone1)
    if (pull > 0 && !released) {
        // nocked arrow
        const ax = Math.round(pxx + dx * 13)
        const ay = Math.round(pyy + dy * 13)
        line(g, pxx, pyy, ax, ay, C.brown3)
        px(g, ax, ay, C.white)
        px(g, Math.round(ax - dx), Math.round(ay - dy), C.steel3)
        px(g, pxx, pyy - 1, C.red2)
        px(g, pxx + 1, pyy - 1, C.red2)
    }
    heroTip.x = Math.round(hx + dx * 4); heroTip.y = Math.round(hy + dy * 4)
}

function staff(g: Ctx, hx: number, hy: number, a: number, glow: number, t: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const tx = Math.round(hx + dx * 13)
    const ty = Math.round(hy + dy * 13)
    line(g, Math.round(hx - dx * 9), Math.round(hy - dy * 9), tx, ty, C.brown2, 2)
    line(g, Math.round(hx - dx * 9), Math.round(hy - dy * 9), tx, ty, C.brown3)
    // gold claw holding the gem
    px(g, tx - 2, ty - 1, C.gold1); px(g, tx + 2, ty - 1, C.gold1)
    px(g, tx - 2, ty - 2, C.gold2); px(g, tx + 2, ty - 2, C.gold2)
    const gx = Math.round(tx + dx * 2)
    const gy = Math.round(ty + dy * 2)
    const flick = (Math.floor(t * 10) & 1) === 1
    rect(g, gx - 1, gy - 2, 3, 5, C.blue2)
    rect(g, gx - 2, gy - 1, 5, 3, C.blue2)
    rect(g, gx - 1, gy - 1, 2, 2, glow > 0 || flick ? C.cyan : C.blue2)
    px(g, gx - 1, gy - 1, C.white)
    heroTip.x = gx; heroTip.y = gy
}

function hammer(g: Ctx, hx: number, hy: number, a: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const nx = -dy
    const ny = dx
    line(g, Math.round(hx - dx * 4), Math.round(hy - dy * 4), Math.round(hx + dx * 11), Math.round(hy + dy * 11), C.brown2, 2)
    for (let k = 0; k < 5; k++) {
        const cx = hx + dx * (10 + k)
        const cy = hy + dy * (10 + k)
        const c = k === 0 || k === 4 ? C.gold1 : (k === 1 ? C.gold3 : C.gold2)
        line(g, Math.round(cx - nx * 4), Math.round(cy - ny * 4), Math.round(cx + nx * 4), Math.round(cy + ny * 4), c)
    }
    const fx = Math.round(hx + dx * 12 - nx * 4)
    const fy = Math.round(hy + dy * 12 - ny * 4)
    px(g, fx, fy, C.white)
    px(g, Math.round(hx - dx * 5), Math.round(hy - dy * 5), C.gold2)
    heroTip.x = Math.round(hx + dx * 12); heroTip.y = Math.round(hy + dy * 12)
}

// ------------------------------------------------------------------ capes & heads

function cape(g: Ctx, sx: number, sy: number, len: number, flutter: number, c: string, cd: string): void {
    // hangs from the shoulders, trails behind (to the left)
    for (let i = 0; i < len; i++) {
        const back = Math.round(i * (0.35 + flutter * 0.12))
        const w = 3 + (i >> 2)
        rect(g, sx - back - w + 2, sy + i, w, 1, i > len - 3 ? cd : c)
        px(g, sx - back - w + 2, sy + i, cd)
    }
}

function headWarrior(g: Ctx, x: number, y: number, t: number): void {
    // face
    rect(g, x - 2, y - 6, 5, 6, C.skin1)
    rect(g, x + 1, y - 5, 2, 4, C.skin2)
    px(g, x + 2, y - 4, C.ink)
    px(g, x + 1, y - 1, C.skin0)
    // helm
    rect(g, x - 3, y - 9, 6, 4, C.steel2)
    rect(g, x - 2, y - 10, 4, 1, C.steel2)
    rect(g, x - 3, y - 6, 2, 5, C.steel1)
    rect(g, x - 1, y - 9, 3, 1, C.steel3)
    rect(g, x + 3, y - 6, 1, 3, C.steel2)
    rect(g, x - 3, y - 6, 7, 1, C.steel1)
    // plume sways
    const s = (Math.floor(t * 6) & 1)
    rect(g, x - 2, y - 12, 3, 2, C.red2)
    rect(g, x - 5, y - 11 + s, 3, 2, C.red1)
    px(g, x - 6, y - 10 + s, C.red1)
    px(g, x - 1, y - 12, C.red3)
}

function headRanger(g: Ctx, x: number, y: number): void {
    rect(g, x - 2, y - 6, 5, 6, C.skin1)
    rect(g, x + 1, y - 5, 2, 4, C.skin2)
    px(g, x + 2, y - 4, C.ink)
    px(g, x + 1, y - 4, C.white)
    // hood
    rect(g, x - 3, y - 8, 6, 3, C.green2)
    rect(g, x - 4, y - 6, 3, 6, C.green2)
    rect(g, x - 2, y - 9, 4, 1, C.green2)
    rect(g, x - 5, y - 4, 2, 4, C.green1)
    px(g, x + 3, y - 7, C.green1)
    rect(g, x - 1, y - 8, 3, 1, C.green3)
    // hood tip hanging back
    px(g, x - 5, y - 7, C.green2)
    px(g, x - 6, y - 6, C.green1)
    rect(g, x - 1, y - 6, 3, 1, C.green1)
}

function headMage(g: Ctx, x: number, y: number, t: number, frame: number): void {
    rect(g, x - 2, y - 6, 5, 5, C.skin1)
    rect(g, x + 1, y - 5, 2, 3, C.skin2)
    px(g, x + 2, y - 4, C.ink)
    rect(g, x + 1, y - 5, 2, 1, C.bone1)
    // beard sways
    const s = frame === 0 ? (Math.floor(t * 3) & 1) : (frame >= 3 ? -1 : 0)
    rect(g, x - 1, y - 2, 5, 3, C.bone1)
    rect(g, x - 1 + s, y + 1, 4, 3, C.bone1)
    rect(g, x + s, y + 4, 3, 2, C.bone1)
    px(g, x + 1 + s, y + 6, C.bone0)
    px(g, x + 2, y - 1, C.white)
    px(g, x + 3, y - 2, C.white)
    // hat: brim, band, bent cone
    rect(g, x - 5, y - 7, 10, 2, C.purple1)
    rect(g, x - 4, y - 7, 8, 1, C.purple2)
    rect(g, x - 3, y - 9, 6, 2, C.gold1)
    rect(g, x - 2, y - 9, 1, 2, C.gold2)
    rect(g, x - 3, y - 12, 5, 3, C.purple1)
    rect(g, x - 2, y - 12, 2, 3, C.purple2)
    rect(g, x - 3, y - 15, 4, 3, C.purple1)
    rect(g, x - 2, y - 15, 1, 3, C.purple2)
    const tip = (Math.floor(t * 4) % 4 === 0) ? 1 : 0
    rect(g, x - 4, y - 17, 3, 2, C.purple1)
    rect(g, x - 6, y - 18 + tip, 3, 2, C.purple1)
    px(g, x - 7, y - 17 + tip, C.purple0)
    px(g, x - 8, y - 16 + tip, C.purple0)
    px(g, x, y - 11, C.gold3)
}

function headPaladin(g: Ctx, x: number, y: number, t: number, glow: boolean): void {
    // great helm with visor and small wings
    rect(g, x - 3, y - 9, 7, 9, C.steel3)
    rect(g, x - 3, y - 9, 2, 9, C.steel2)
    rect(g, x - 2, y - 10, 5, 1, C.steel3)
    rect(g, x, y - 5, 4, 1, C.ink)
    px(g, x + 3, y - 5, glow ? C.white : C.cyan)
    px(g, x + 2, y - 5, glow ? C.cyan : C.blue2)
    rect(g, x + 1, y - 9, 1, 8, C.gold2)
    rect(g, x - 3, y - 1, 7, 1, C.steel1)
    const f = Math.floor(t * 4) & 1
    rect(g, x - 5, y - 9 - f, 2, 3, C.white)
    px(g, x - 6, y - 10 - f, C.white)
    px(g, x - 6, y - 8 - f, C.steel3)
    px(g, x - 4, y - 7, C.steel2)
}

// ------------------------------------------------------------------ torsos

function torsoWarrior(g: Ctx, x: number, y: number): void {
    rect(g, x - 4, y, 8, 9, C.steel1)
    rect(g, x - 3, y + 1, 6, 8, C.red1)
    rect(g, x - 1, y + 1, 3, 8, C.red2)
    px(g, x, y + 3, C.gold2)
    rect(g, x - 4, y + 6, 8, 1, C.brown1)
    px(g, x, y + 6, C.gold2)
    rect(g, x - 4, y, 2, 2, C.steel2)
    rect(g, x + 2, y, 2, 2, C.steel2)
    px(g, x + 3, y, C.steel3)
}

function torsoRanger(g: Ctx, x: number, y: number): void {
    rect(g, x - 4, y, 8, 9, C.brown2)
    rect(g, x - 1, y, 4, 9, C.brown3)
    line(g, x - 4, y, x + 3, y + 7, C.brown1)
    rect(g, x - 4, y + 6, 8, 1, C.brown0)
    px(g, x + 1, y + 6, C.gold1)
    rect(g, x - 4, y + 7, 8, 2, C.green1)
}

function torsoMage(g: Ctx, x: number, y: number, sway: number, running: boolean, run: number): void {
    // robe to the floor with a swaying hem
    rect(g, x - 4, y, 8, 5, C.purple1)
    rect(g, x - 1, y, 3, 5, C.purple2)
    for (let i = 0; i < 12; i++) {
        const w = 8 + (i >> 1)
        const shift = Math.round((i / 12) * sway)
        rect(g, x - 4 - (i >> 2) + shift, y + 5 + i, w, 1, i === 11 ? C.purple0 : C.purple1)
        px(g, x - 1 + shift + (i >> 3), y + 5 + i, C.purple2)
    }
    rect(g, x - 4, y + 5, 8, 1, C.gold1)
    px(g, x, y + 5, C.gold2)
    // gold trim down the front
    for (let i = 0; i < 11; i++) px(g, x + 2 + (i >> 2) + Math.round((i / 12) * sway), y + 6 + i, C.gold1)
    if (running) {
        const f = Math.floor(run * 12) % 4
        px(g, x + (f < 2 ? 4 : -2), y + 17, C.brown0)
        px(g, x + (f < 2 ? 5 : -1), y + 17, C.brown1)
    }
}

function torsoPaladin(g: Ctx, x: number, y: number): void {
    rect(g, x - 4, y, 8, 9, C.steel2)
    rect(g, x - 2, y, 5, 9, C.steel3)
    rect(g, x - 1, y + 1, 3, 7, C.white)
    rect(g, x, y + 1, 1, 6, C.gold2)
    rect(g, x - 1, y + 3, 3, 1, C.gold2)
    rect(g, x - 4, y + 7, 8, 1, C.gold1)
    rect(g, x - 5, y, 3, 3, C.gold2)
    rect(g, x + 2, y, 3, 3, C.gold2)
    px(g, x + 3, y, C.gold3)
}

// ------------------------------------------------------------------ main

/**
 * Draw the hero with feet at (x, y). Also stamps the weapon smear on strike frames.
 * `flash` paints a solid hit flash; `rim` lights the edges from the weapon side.
 */
export function drawHero(dst: Ctx, sb: SpriteBuffer, id: ClassId, x: number, y: number, p: HeroPose, flash: string | null): void {
    const g = sb.begin()
    const frame = attackFrame(p.attack)
    const K = keys(id, p.special)[frame]!
    const idle = frame === 0 && !p.running
    const bob = idle ? (Math.floor(p.t * 2.5) & 1) : 0
    const runBob = p.running && frame === 0 ? (Math.floor(p.run * 12) % 3 === 1 ? -1 : 0) : 0
    const hurtX = -Math.round(p.hurt * 2)
    const lean = K[3] + hurtX
    const crouch = K[4] + bob + runBob
    const jump = K[5]
    ox = sb.ax
    oy = sb.ay
    bx = ox + lean
    by = oy + crouch + jump
    const shoulderY = by - 16
    const hx = ox + K[1] + lean
    const hy = oy + K[2] + crouch + jump
    const flutter = p.running ? (Math.floor(p.run * 12) & 1) + 1 : (Math.floor(p.t * 3) & 1)

    switch (id) {
        case 'warrior': {
            const shx = ox + K[6] + lean
            const shy = oy + K[7] + crouch + jump
            shield(g, shx - 1, shy)
            legs(g, p, frame, K[4] + bob, jump, C.brown0, C.brown2, C.brown2, C.brown1)
            torsoWarrior(g, bx, by - 17)
            headWarrior(g, bx, by - 17, p.t)
            limb(g, bx - 3, shoulderY, shx, shy, C.steel1)
            limb(g, bx + 2, shoulderY, hx, hy, C.steel1)
            rect(g, hx - 1, hy - 1, 2, 2, C.brown2)
            sword(g, hx, hy, K[0])
            break
        }
        case 'ranger': {
            cape(g, bx - 2, by - 17, 13, flutter, C.green1, C.green0)
            // quiver on the back
            rect(g, bx - 6, by - 19, 3, 8, C.brown1)
            px(g, bx - 6, by - 20, C.red2); px(g, bx - 4, by - 21, C.red2); px(g, bx - 5, by - 20, C.bone1)
            legs(g, p, frame, K[4] + bob, jump, C.brown1, C.brown3, C.green2, C.green1)
            torsoRanger(g, bx, by - 17)
            headRanger(g, bx, by - 17)
            const pull = K[6]
            const released = K[7] > 0
            const dx = Math.cos(K[0])
            const dy = Math.sin(K[0])
            const pl = released ? 3 : 1 + pull * 8
            const rhx = released ? bx - 5 : Math.round(hx - dx * pl)
            const rhy = released ? by - 18 : Math.round(hy - dy * pl)
            limb(g, bx - 2, shoulderY, rhx, rhy, C.brown2)
            px(g, rhx, rhy, C.skin1)
            bow(g, hx, hy, K[0], pull, released)
            limb(g, bx + 2, shoulderY, hx, hy, C.brown3)
            rect(g, hx - 1, hy - 1, 2, 2, C.skin1)
            break
        }
        case 'mage': {
            const sway = p.running ? -2 : (frame >= 3 ? -2 : (idle ? (Math.floor(p.t * 2) & 1) - 1 : 1))
            torsoMage(g, bx, by - 17, sway, p.running, p.run)
            limb(g, bx - 3, shoulderY, bx - 3, by - 10, C.purple1)
            headMage(g, bx, by - 17, p.t, frame)
            limb(g, bx + 2, shoulderY, hx, hy, C.purple2)
            staff(g, hx, hy, K[0], K[6], p.t)
            rect(g, hx - 1, hy - 1, 2, 2, C.skin1)
            break
        }
        case 'paladin': {
            cape(g, bx - 2, by - 17, 15, flutter, C.blue1, C.blue0)
            legs(g, p, frame, K[4] + bob, jump, C.steel1, C.steel3, C.steel2, C.steel1)
            torsoPaladin(g, bx, by - 17)
            headPaladin(g, bx, by - 17, p.t, frame >= 2 && frame <= 3)
            const bhx = ox + K[6] + lean
            const bhy = oy + K[7] + crouch + jump
            limb(g, bx - 3, shoulderY, bhx, bhy, C.steel2)
            limb(g, bx + 2, shoulderY, hx, hy, C.steel3)
            hammer(g, hx, hy, K[0])
            rect(g, hx - 1, hy - 1, 2, 2, C.gold1)
            rect(g, bhx - 1, bhy - 1, 2, 2, C.gold1)
            break
        }
    }

    // afterimages on special strikes
    if (p.special && (frame === 3 || frame === 4) && !flash) {
        sb.ghost(dst, x - 6, y, C.night3)
        sb.ghost(dst, x - 3, y, ACCENT[id])
    }
    const lit = frame >= 1 && frame <= 3
    const ready = p.charge >= 1 && (Math.floor(p.t * 6) & 1) === 1
    const rim = lit ? ACCENT[id] : (ready ? ACCENT[id] : null)
    sb.blit(dst, x, y, C.ink, flash, rim, 1, lit && K[2] < -16 ? -1 : 0)

    // convert the weapon tip into screen space
    heroTip.x = heroTip.x - sb.ax + (x | 0)
    heroTip.y = heroTip.y - sb.ay + (y | 0)

    if (!flash && frame === 3) smear(dst, id, p.special, x + lean, y + crouch + jump)
    if (!flash && id === 'mage' && K[6] > 0) gemGlow(dst, heroTip.x, heroTip.y, K[6], p.t)
}

/** Motion smear for melee strikes: a bright arc swept around the shoulder. */
function smear(dst: Ctx, id: ClassId, special: boolean, x: number, y: number): void {
    if (id === 'ranger' || id === 'mage') return
    const K = keys(id, special)
    const a0 = K[2]![0]
    const a1 = K[3]![0]
    const cx = (x | 0) + 1
    const cy = (y | 0) - 16
    const r0 = id === 'paladin' ? 12 : 11
    const r1 = id === 'paladin' ? 19 : 18
    const accent = ACCENT[id]
    const steps = 28
    for (let i = 0; i <= steps; i++) {
        const k = i / steps
        const a = a0 + (a1 - a0) * k
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        // arc gets thicker toward the leading edge
        const th = Math.round(1 + k * (r1 - r0 - 1))
        for (let r = r1 - th; r <= r1; r++) {
            const c = r === r1 ? C.white : (r >= r1 - 2 ? C.steel3 : accent)
            if (k < 0.35 && r < r1 - 1 && (i & 1) === 0) continue
            px(dst, Math.round(cx + ca * r), Math.round(cy + sa * r), c)
        }
    }
}

function gemGlow(dst: Ctx, x: number, y: number, level: number, t: number): void {
    const f = Math.floor(t * 12) & 1
    const r = 2 + level + f
    px(dst, x, y - r - 1, C.white)
    px(dst, x, y + r + 1, C.cyan)
    px(dst, x - r - 1, y, C.cyan)
    px(dst, x + r + 1, y, C.white)
    if (level >= 2) ring(dst, x, y, r, f ? C.cyan : C.blue2)
    if (level >= 3) disc(dst, x, y, 1, C.white)
}

/** Ground shadow under the hero (drawn before the sprite). */
export function heroShadow(dst: Ctx, x: number, jump: number): void {
    const w = jump < -4 ? 4 : 6
    rect(dst, (x | 0) - w, 118, w * 2 + 1, 1, C.ink)
    rect(dst, (x | 0) - w + 2, 119, w * 2 - 3, 1, C.ink)
}

/** Jump offset of the current frame (for the shadow). */
export function heroJump(id: ClassId, p: HeroPose): number {
    return keys(id, p.special)[attackFrame(p.attack)]![5]
}
