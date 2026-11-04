/*
 * The second wave of RIFTBORN's horde: support casters, splitting swarms,
 * formation fighters, ambushers, loot runners and the Rift Champion
 * mini-boss. Merged into ENEMY_DEFS by enemies.ts.
 */
import type { Graphics } from 'pixi.js'
import { OUTLINE, TAU, mix, pen, shade } from './content-art'
import { aim, buff, chance, flag, hpCurve, later, lead, move, num, onScreen, panOf, pick, rand, ring, shoot, summon, teleport, tick } from './content-ai'
import type { Enemy, EnemyDef, GameApi } from './types'

// ─── Drawings ────────────────────────────────────────────────────────────

function drawHerald(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 1.2
    const robe = 0x1f2a33
    const soul = 0x7dff9a
    const bone = 0xe9e4d4
    P.shadow(0, 30, 16, 3.5)
    // banner pole and waving flag (behind the body)
    P.line(-12, 30, -12, -36 + bob, OUTLINE, 4.5)
    P.line(-12, 30, -12, -36 + bob, 0x4a3420, 2.6)
    const flag: number[] = []
    const flagB: number[] = []
    for (let i = 0; i <= 6; i++) {
        const x = -12 - i * 4.4
        const w = Math.sin(ph * 1.5 - i * 0.9) * (i * 0.7)
        flag.push(x, -33 + bob + w)
        flagB.unshift(x, -11 + bob + w + (i === 6 ? 3 : i % 2 === 0 ? 0 : 2))
    }
    P.shape([...flag, ...flagB], 0x1e5a3a, OUTLINE, 2)
    const inner: number[] = []
    for (let i = 1; i <= 5; i++) {
        const w = Math.sin(ph * 1.5 - i * 0.9) * (i * 0.7)
        inner.push(-12 - i * 4.4, -30 + bob + w)
    }
    P.path(inner, 0x6dffb0, 1.2, 0.7)
    const mx = -24
    const my = -22 + bob + Math.sin(ph * 1.5 - 2.7) * 1.9
    P.circle(mx, my, 4.5, bone)
    P.circle(mx - 1.6, my - 0.5, 1.3, 0x0c1a12)
    P.circle(mx + 1.6, my - 0.5, 1.3, 0x0c1a12)
    P.rect(mx - 2, my + 2.5, 4, 2.4, bone, 0.8)
    // soul lantern atop the pole
    const lp = 0.5 + 0.5 * Math.sin(ph * 2)
    P.halo(-12, -39 + bob, 12 + lp * 3, soul, 0.5)
    P.shape([-15, -42 + bob, -9, -42 + bob, -8, -36 + bob, -16, -36 + bob], 0x2a3a30, OUTLINE, 1.5)
    P.circle(-12, -39 + bob, 2.6 + lp, mix(soul, 0xffffff, 0.5))
    // legs and robe
    P.limb([-3, 16, -4 + step * 3, 24, -5 + step * 4, 29], 0x14181c, 3)
    P.limb([4, 16, 5 - step * 3, 24, 6 - step * 4, 29], 0x1a2026, 3)
    P.shape([-10, 22, -8, -6 + bob, -4, -14 + bob, 6, -14 + bob, 10, -6 + bob, 12, 22, 7, 19 + step, 2, 22, -3, 19 - step, -7, 22], robe, OUTLINE, 2.4)
    P.poly([-9, 21, -7, -5 + bob, -3, -12 + bob, -3, 20], shade(robe, 0.65), 0.9)
    P.ellipse(5, 4, 3, 12, mix(robe, soul, 0.18), 0.6)
    P.path([-9, 18, -4, 19, 0, 17, 5, 19, 11, 18], soul, 1.3, 0.75)
    // bone chain of skulls
    for (let i = 0; i < 3; i++) P.circle(-6 + i * 6, 2 - i * 1.2 + bob, 1.8, bone)
    // hood and bone mask
    P.shape([-8, -8 + bob, -5, -24 + bob, 2, -29 + bob, 9, -22 + bob, 11, -8 + bob], shade(robe, 1.25), OUTLINE, 2.4)
    P.ellipse(3, -15 + bob, 5.2, 6.2, 0x05080a)
    P.shape([0, -19 + bob, 7, -19 + bob, 8, -13 + bob, 3.5, -9 + bob, -1, -13 + bob], bone, OUTLINE, 1.4)
    P.slit(2.2, -15.5 + bob, 1.4, 1, soul)
    P.slit(5.8, -15.5 + bob, 1.4, 1, soul)
    // arm clutching the pole
    P.limb([4, -4 + bob, -4, 0 + bob, -11, -2 + bob], robe, 3.4)
    P.circle(-12, -2 + bob, 2.4, bone)
}

function drawCrystal(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const step = Math.sin(ph)
    const hue = mix(0xff5ad8, 0x5ae8ff, 0.5 + 0.5 * Math.sin(ph))
    P.halo(0, 0, 18, hue, 0.22)
    for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
            const bx = -6 + i * 6
            const sw = Math.sin(ph + i * 2 + (s > 0 ? Math.PI : 0)) * 2.5
            P.path([bx, s * 3, bx + sw, s * 10, bx + sw * 1.5 + (i - 1) * 3, s * 13], OUTLINE, 3)
            P.path([bx, s * 3, bx + sw, s * 10, bx + sw * 1.5 + (i - 1) * 3, s * 13], 0x4a2a6a, 1.5)
        }
    }
    const prisms: [number, number, number, number, number][] = [[-7, 2, 7, 12, 0xb040ff], [7, -1, 6, 10, 0x40c8ff], [0, 0, 8, 16, 0xff4ad0]]
    for (const [x, y, w, h, c] of prisms) {
        const bob = step * 0.8
        P.shape([x - w, y + 4 + bob, x - w * 0.6, y - h * 0.3 + bob, x, y - h + bob, x + w * 0.6, y - h * 0.3 + bob, x + w, y + 4 + bob, x, y + 7 + bob], c, OUTLINE, 2)
        P.poly([x - w * 0.6, y - h * 0.3 + bob, x, y - h + bob, x, y + 6 + bob, x - w + 0.5, y + 3.5 + bob], mix(c, 0xffffff, 0.4), 0.85)
        P.poly([x + w * 0.6, y - h * 0.3 + bob, x, y - h + bob, x, y + 6 + bob, x + w - 0.5, y + 3.5 + bob], shade(c, 0.6), 0.75)
        P.line(x - w * 0.3, y - h * 0.5 + bob, x - w * 0.05, y - h * 0.9 + bob, 0xffffff, 1, 0.9)
    }
    P.eye(3, 2 + step * 0.8, 1.6, 0xffffff)
    P.eye(-2, 3 + step * 0.8, 1.3, 0xffffff)
}

function drawCrystalShard(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 4) * TAU
    const c = frame % 2 === 0 ? 0xff4ad0 : 0x40c8ff
    const w = 4 + Math.cos(ph) * 1.5
    P.halo(0, 0, 11, c, 0.3)
    P.poly([-10, 0, -15, -1.5, -15, 1.5], c, 0.4)
    P.shape([10, 0, 0, -w, -8, 0, 0, w], c, OUTLINE, 1.8)
    P.poly([10, 0, 0, -w, -8, 0], mix(c, 0xffffff, 0.45), 0.9)
    P.line(-4, -0.5, 7, -0.5, 0xffffff, 0.8, 0.9)
}

function drawLurker(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const sand = 0xc8a060
    const hide = 0x9a7240
    const open = 0.5 + 0.5 * Math.sin(ph)
    const sway = Math.sin(ph) * 2
    // sand burst at the base
    P.ellipse(-14, 33, 28, 7, 0x3a2810, 0.9)
    for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI
        const r = 26 + Math.sin(ph + i) * 3
        P.circle(-14 + Math.cos(a) * r, 31 + Math.sin(a) * 6, 2.5 + (i % 3), i % 2 ? sand : shade(sand, 0.8))
    }
    // one thick arching body
    const x0 = -16
    const y0 = 32
    const cx = -24 + sway
    const cy = -24
    const x1 = 8 + sway * 0.5
    const y1 = -14
    P.g.moveTo(x0, y0).quadraticCurveTo(cx, cy, x1, y1).stroke({ color: P.c(OUTLINE), width: 26, cap: 'round' })
    P.g.moveTo(x0, y0).quadraticCurveTo(cx, cy, x1, y1).stroke({ color: P.c(shade(hide, 0.7)), width: 21, cap: 'round' })
    P.g.moveTo(x0 - 3, y0).quadraticCurveTo(cx - 3, cy - 2, x1 - 2, y1 - 4).stroke({ color: P.c(hide), width: 12, cap: 'round' })
    P.g.moveTo(x0 - 5, y0 - 4).quadraticCurveTo(cx - 5, cy - 4, x1 - 4, y1 - 7).stroke({ color: P.c(mix(hide, 0xffffff, 0.3)), width: 3, alpha: 0.7, cap: 'round' })
    P.g.moveTo(x0 + 7, y0).quadraticCurveTo(cx + 9, cy + 6, x1 + 2, y1 + 8).stroke({ color: P.c(0xffd27a), width: 2, alpha: 0.6, cap: 'round' })
    // armour bands and dorsal spikes along the curve
    for (let i = 1; i < 7; i++) {
        const t = i / 7
        const u = 1 - t
        const x = u * u * x0 + 2 * u * t * cx + t * t * x1
        const y = u * u * y0 + 2 * u * t * cy + t * t * y1
        const tx = 2 * u * (cx - x0) + 2 * t * (x1 - cx)
        const ty = 2 * u * (cy - y0) + 2 * t * (y1 - cy)
        const d = Math.hypot(tx, ty) || 1
        const nx = -ty / d
        const ny = tx / d
        P.line(x + nx * 9.5, y + ny * 9.5, x - nx * 9.5, y - ny * 9.5, shade(hide, 0.5), 1.6)
        const sx = x - nx * 10
        const sy = y - ny * 10
        P.shape([sx + (tx / d) * 3, sy + (ty / d) * 3, sx - nx * 7, sy - ny * 7, sx - (tx / d) * 3, sy - (ty / d) * 3], 0xf1e3c0, OUTLINE, 1.4)
    }
    // head with hooked mandibles
    const hx = x1 + 2
    const hy = y1
    const jaw = 0.25 + open * 0.55
    P.halo(hx + 12, hy, 14, 0xff8a3a, 0.2 + open * 0.25)
    for (const s of [-1, 1]) {
        const a = s * jaw
        const bx = hx + 8
        const by = hy + s * 4
        const ex = bx + Math.cos(a) * 16
        const ey = by + Math.sin(a) * 16
        P.curve(bx, by, bx + Math.cos(a) * 12 - s * 1, by + Math.sin(a) * 12 + s * 6, ex, ey + s * -3, 0xe8d8b0, 3)
    }
    P.ball(hx, hy, 13, mix(hide, sand, 0.3), 0xffd27a, OUTLINE, 2.6)
    P.ellipse(hx + 9, hy, 3.5 + open * 2.5, 3 + open * 4, 0x2a0a06)
    P.circle(hx + 9, hy, 1.4 + open * 1.6, 0xff8a3a)
    for (let i = 0; i < 4; i++) P.poly([hx + 7, hy - 4 + i * 2.6, hx + 10, hy - 3 + i * 2.6, hx + 7, hy - 2 + i * 2.6], 0xf1ead8)
    P.slit(hx - 1, hy - 7, 2.2, 1.3, 0xffa030)
    P.slit(hx + 4.5, hy - 8, 1.7, 1.1, 0xffa030)
}

function drawBeetle(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 4) * TAU
    const glow = 0.5 + 0.5 * Math.sin(ph)
    const lava = mix(0xff5a10, 0xffd040, glow)
    // flame trail
    P.poly([-8, -3, -18 - glow * 4, 0, -8, 3], 0xff6a1a, 0.5)
    P.poly([-8, -1.5, -13 - glow * 3, 0, -8, 1.5], 0xffe066, 0.7)
    P.halo(0, 0, 14, 0xff7a1a, 0.3 + glow * 0.15)
    for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
            const bx = -3 + i * 4
            const sw = Math.sin(ph + i * 2.1 + (s > 0 ? Math.PI : 0)) * 2
            P.path([bx, s * 4, bx + sw + (i - 1) * 2, s * 9, bx + sw * 1.4 + (i - 1) * 3.5, s * 11], OUTLINE, 2.6)
        }
    }
    P.egg(-1, 0, 9, 7, 0x2a1a1a, lava, OUTLINE, 2)
    P.line(-9, 0, 6, 0, OUTLINE, 1.6)
    P.path([-7, -3.5, -3, -5, 2, -3.5], lava, 1.3)
    P.path([-7, 3.5, -3, 5, 2, 3.5], lava, 1.3)
    P.circle(-4, 0, 2 + glow, lava, 0.9)
    P.ball(8, 0, 4, 0x3a2222, lava, OUTLINE, 1.6)
    P.path([10.5, -2, 14, -4, 15, -2], 0x1a0a0a, 1.4)
    P.path([10.5, 2, 14, 4, 15, 2], 0x1a0a0a, 1.4)
    P.eye(10, -1.6, 1.1, 0xffe066)
    P.eye(10, 1.6, 1.1, 0xffe066)
}

function drawHoplite(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 1.3
    const bronze = 0xc8883a
    const cloth = 0x6a1a3a
    const iron = 0x3a3f52
    P.shadow(0, 27, 16, 3.5)
    // spear (behind the shield, tip forward)
    P.line(-20, 2 + bob, 34, -6 + bob, OUTLINE, 4)
    P.line(-20, 2 + bob, 34, -6 + bob, 0x6a4a2a, 2.2)
    P.shape([30, -4.5 + bob, 36, -8 + bob, 31, -7.8 + bob], 0xd8e0f0, OUTLINE, 1.4)
    P.limb([-4, 10, -5 + step * 3, 18, -6 + step * 4, 25], shade(iron, 0.8), 4.2)
    P.limb([3, 10, 4 - step * 3, 18, 5 - step * 4, 25], iron, 4.2)
    P.shape([-9, 12, -10, -8 + bob, 7, -9 + bob, 8, 12], iron, OUTLINE, 2.4)
    P.shape([-10, 8, -7, 16 + step, -3, 12, 1, 16 - step, 5, 12, 9, 15 + step, 8, 8], cloth, OUTLINE, 1.6)
    P.poly([-9, 10, -9, -6 + bob, -5, -6 + bob, -5, 10], shade(iron, 0.7), 0.8)
    // crested helmet
    P.curve(-9, -26 + bob, -2, -36 + bob, 9, -27 + bob, 0xd83a3a, 4)
    P.path([-7, -28 + bob, -2, -33.5 + bob, 6, -28.5 + bob], 0xff8a8a, 1.2, 0.8)
    P.ball(0, -18 + bob, 8.5, bronze, 0xffd27a, OUTLINE, 2.4)
    P.rect(1, -19.5 + bob, 8, 2.8, 0x140a04, 1)
    P.rect(3.5, -19 + bob, 2.4, 9, 0x140a04, 1)
    P.slit(5.5, -18 + bob, 2.2, 1.1, 0xff3fa4)
    // aspis shield
    P.ball(11, 0 + bob, 13, bronze, 0xffe0a0, OUTLINE, 3)
    P.ring(11, bob, 10, shade(bronze, 0.6), 1.6)
    P.halo(11, bob, 7, 0xff3fa4, 0.3)
    P.star(11, bob, 4, 5.5, 1.8, 0x9a1a5a, 0.4 + step * 0.1)
    P.circle(11, bob, 1.8, 0xffd0ec)
}

function drawStalker(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const step = Math.sin(ph)
    const lag = Math.sin(ph - 1.2)
    const bob = Math.abs(Math.cos(ph)) * 1.6
    const body = 0x231433
    const voidC = 0xc77dff
    P.halo(0, 0, 24, 0x7a2dff, 0.22)
    // tattered trails
    for (let i = 0; i < 3; i++) {
        const y = -6 + i * 7
        P.poly([-6, y + bob, -22 - i * 2 + lag * 3, y + 3 + lag * 2, -18 + lag * 2, y + 5, -6, y + 4 + bob], i % 2 ? 0x3a1a5a : 0x2a1040, 0.85)
    }
    P.limb([-3, 10, -8 + step * 4, 16, -6 + step * 6, 24], shade(body, 1.3), 2.6)
    // back blade arm
    P.limb([-2, -6 + bob, -10 + lag * 2, 4 + bob], body, 2.8)
    P.shape([-10 + lag * 2, 4 + bob, -6 + lag * 2, 20 + bob, -12 + lag * 2, 6 + bob], 0x9a8aba, OUTLINE, 1.5)
    P.shape([-7, 12, -9, -4 + bob, -4, -12 + bob, 5, -12 + bob, 8, -2 + bob, 5, 12], body, OUTLINE, 2.2)
    P.poly([-6, 10, -8, -3 + bob, -4, -10 + bob, -3, 10], shade(body, 1.4), 0.6)
    P.arc(0, 0 + bob, 9, 0.1, 1.4, voidC, 1.4, 0.7)
    P.limb([3, 10, 7 - step * 4, 16, 9 - step * 6, 24], shade(body, 1.6), 2.6)
    // head with one great eye
    P.ball(3, -17 + bob, 7.5, 0x2e1a44, voidC, OUTLINE, 2.2)
    P.shape([-3, -21 + bob, -10 + lag * 2, -27 + bob, -2, -18 + bob], 0x2e1a44, OUTLINE, 1.4)
    P.halo(6, -17 + bob, 6, voidC, 0.7)
    P.slit(6, -17 + bob, 3, 2.2, 0xffc0ff, 0.6 + 0.4 * Math.abs(step))
    // front blade arm
    P.limb([4, -6 + bob, 13, -2 + bob + lag], body, 3)
    P.shape([12, -4 + bob + lag, 30, -12 + bob + lag * 2, 14, 1 + bob + lag], 0xd8ccf0, OUTLINE, 1.6)
    P.line(15, -2 + bob + lag, 27, -10 + bob + lag * 2, voidC, 1, 0.9)
}

function drawGoblin(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 2.2
    const skin = 0x6aa83a
    const gold = 0xf5c451
    P.halo(-6, -4, 22, gold, 0.25)
    P.limb([-1, 10 - bob, -3 + step * 5, 15, -4 + step * 7, 21], shade(skin, 0.7), 3)
    // huge loot sack on its back
    P.ball(-9, -6 - bob, 13, 0x8a6030, 0xffd27a, OUTLINE, 2.6)
    P.path([-17, -12 - bob, -12, -15 - bob, -6, -13 - bob], shade(0x8a6030, 0.6), 1.3)
    P.ring(-9, -18 - bob, 3, 0x5a3a1a, 2)
    for (const [x, y] of [[-14, -16], [-8, -19], [-3, -15]] as const) {
        P.disc(x, y - bob, 2.8, gold, 0x8a5a10, 1.2)
        P.circle(x - 0.8, y - 0.8 - bob, 0.9, 0xffffff, 0.8)
    }
    P.star(-2, -20 - bob, 4, 2.5 + (frame % 2), 0.8, 0xffffff, 0)
    P.egg(3, 2 - bob, 7, 8, skin, 0xd0ff8a, OUTLINE, 2.2)
    P.rect(-3, 3 - bob, 12, 3, 0x5a3a1a, 1)
    P.disc(5, 4.5 - bob, 1.6, gold, OUTLINE, 1)
    P.limb([2, 10 - bob, 5 - step * 5, 15, 7 - step * 7, 21], skin, 3)
    P.limb([6, -2 - bob, 11 + step * 2, 3 - bob, 13 + step * 3, 6 - bob], skin, 2.4)
    P.disc(13.5 + step * 3, 7 - bob, 2.6, gold, 0x8a5a10, 1.2)
    P.ball(7, -11 - bob, 7.5, skin, 0xd0ff8a, OUTLINE, 2.2)
    P.shape([2, -13 - bob, -6, -19 - bob, 3, -9 - bob], skin, OUTLINE, 1.6)
    P.shape([11, -14 - bob, 18, -22 - bob, 13, -9 - bob], skin, OUTLINE, 1.6)
    P.poly([11.5, -13.5 - bob, 16.5, -20 - bob, 12.8, -10.5 - bob], 0xd06a6a, 0.6)
    P.eye(8, -12.5 - bob, 1.5, 0xffe066)
    P.eye(11.5, -12 - bob, 1.3, 0xffe066)
    P.g.moveTo(6, -8 - bob).quadraticCurveTo(10, -5 - bob, 13, -8.5 - bob).stroke({ color: P.c(0x1a2a0a), width: 1.4, cap: 'round' })
    P.poly([8, -7.5 - bob, 9, -6 - bob, 10, -7.2 - bob], 0xffffff)
    P.circle(14, -10 - bob, 1.6, shade(skin, 0.7))
}

function drawChampion(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 2.2
    const lag = Math.sin(ph - 1)
    const pulse = 0.5 + 0.5 * Math.sin(ph * 2)
    const steel = 0x3a3448
    const plate = 0x5a5070
    const rift = 0xff3fa4
    const gold = 0xd8a84a
    P.shadow(0, 52, 36, 8)
    // cape
    P.shape([-18, -26 + bob, -38 + lag * 3, 10, -34 + lag * 2, 34, -26, 28, -20 + lag, 44, -10, 30, -4, -10 + bob], 0x5a0f2a, OUTLINE, 2.6)
    P.poly([-18, -22 + bob, -32 + lag * 3, 10, -28, 28, -12, 0], 0x8a1a40, 0.7)
    P.limb([-10, 22, -12 + step * 4, 36, -14 + step * 6, 50], shade(steel, 0.8), 10)
    P.oval(-14 + step * 6, 51, 8, 3.5, shade(steel, 0.6), OUTLINE, 2)
    // back arm
    P.limb([-16, -14 + bob, -26, 0 + bob, -20, 12 + bob], shade(steel, 0.85), 8)
    // torso armour
    P.shape([-22, 24, -26, -14 + bob, -14, -30 + bob, 14, -30 + bob, 24, -14 + bob, 20, 24, 0, 30], steel, OUTLINE, 3.4)
    P.poly([-22, 22, -25, -12 + bob, -14, -27 + bob, -10, 26], shade(steel, 0.65), 0.9)
    P.shape([-14, -22 + bob, 12, -22 + bob, 10, 4 + bob, 0, 10 + bob, -12, 4 + bob], plate, OUTLINE, 2.2)
    P.poly([-12, -20 + bob, -2, -20 + bob, -2, 8 + bob, -11, 3 + bob], mix(plate, 0xffffff, 0.15), 0.7)
    P.halo(-1, -6 + bob, 12, rift, 0.25 + pulse * 0.2)
    P.star(-1, -6 + bob, 4, 7 + pulse * 1.5, 2.2, rift, 0)
    P.circle(-1, -6 + bob, 2.2, 0xffd0ec)
    P.path([-20, 14, -8, 18, 8, 18, 18, 14], gold, 2)
    P.rect(-20, 16, 40, 5, shade(steel, 0.8), 2)
    P.rect(-4, 15, 8, 7, gold, 1.5)
    // tasset skirt
    P.shape([-20, 20, -22, 34 + lag, -12, 30, -6, 38 - lag, 2, 30, 10, 37 + lag, 18, 30, 20, 20], plate, OUTLINE, 2)
    P.limb([8, 22, 10 - step * 4, 36, 12 - step * 6, 50], steel, 10)
    P.oval(12 - step * 6, 51, 8, 3.5, shade(steel, 0.8), OUTLINE, 2)
    // spiked pauldrons
    for (const [x, s] of [[-20, -1], [18, 1]] as const) {
        P.ball(x, -26 + bob, 11, plate, rift, OUTLINE, 2.8)
        P.shape([x - 3, -34 + bob, x + s * 4, -48 + bob, x + 4, -33 + bob], 0xe9e4d4, OUTLINE, 1.8)
        P.shape([x + s * 6, -30 + bob, x + s * 15, -38 + bob, x + s * 9, -25 + bob], 0xe9e4d4, OUTLINE, 1.8)
    }
    // horned helm
    P.curve(-6, -42 + bob, -18, -50 + bob, -16, -62 + bob, 0xe9e4d4, 3.6)
    P.curve(8, -42 + bob, 20, -50 + bob, 18, -62 + bob, 0xe9e4d4, 3.6)
    P.ball(1, -38 + bob, 11, steel, rift, OUTLINE, 3)
    P.shape([-8, -38 + bob, 11, -38 + bob, 10, -30 + bob, 1, -26 + bob, -7, -30 + bob], shade(steel, 0.8), OUTLINE, 2)
    P.rect(-6, -39.5 + bob, 15, 3.4, 0x05030a, 1.4)
    P.halo(3, -38 + bob, 8, rift, 0.6)
    P.slit(0, -38 + bob, 2.4, 1.3, 0xffd0ec)
    P.slit(6.5, -38 + bob, 2.4, 1.3, 0xffd0ec)
    // greataxe held across the body
    const ax = 30 + lag * 2
    const ay = -30 + bob
    P.line(-4, 18 + bob, ax, ay, OUTLINE, 6)
    P.line(-4, 18 + bob, ax, ay, 0x5a3a22, 3.6)
    P.halo(ax, ay, 18, rift, 0.2 + pulse * 0.15)
    P.shape([ax - 6, ay + 4, ax - 10, ay - 14, ax + 2, ay - 24, ax + 16, ay - 18, ax + 12, ay - 4, ax + 4, ay - 2], 0xb8c0d8, OUTLINE, 2.6)
    P.poly([ax - 8, ay - 12, ax + 2, ay - 22, ax + 13, ay - 17, ax + 2, ay - 10], 0xe8ecf8, 0.85)
    P.path([ax - 7, ay - 13, ax + 2, ay - 22, ax + 14, ay - 17], rift, 1.6, 0.9)
    P.circle(ax, ay, 3.2, gold)
    // gauntlet on the haft
    P.limb([16, -18 + bob, 18, -6 + bob, 10, 4 + bob], steel, 8)
    P.ball(10, 5 + bob, 6, plate, rift, OUTLINE, 2.2)
}

// ─── Behaviours ──────────────────────────────────────────────────────────

function heraldUpdate(e: Enemy, g: GameApi, dt: number): void {
    const a = aim(e, g)
    if (a.dist > 340) g.chase(e, dt)
    else if (a.dist < 230) move(e, g, -a.nx * e.speed * 0.7, -a.ny * e.speed * 0.7, dt)
    else move(e, g, -a.ny * e.speed * 0.4, a.nx * e.speed * 0.4, dt)
    e.facing = a.dx < 0 ? -1 : 1
    if (tick(e, 'pulse', dt) > 0 || e.stunT > 0) return
    e.ai.pulse = e.elite ? 1 : 1.4
    const r = e.elite ? 260 : 210
    let n = 0
    for (const o of g.enemies) {
        if (o === e || o.dead || o.boss) continue
        const dx = o.x - e.x
        const dy = o.y - e.y
        if (dx * dx + dy * dy > r * r) continue
        buff(o, g, 1.35, 1.8)
        if (o.hp < o.maxHp) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.05)
        if (++n > 40) break
    }
    if (onScreen(e, g, 120)) {
        g.particles(e.x, e.y, { count: 22, color: 0x7dff9a, speed: r * 1.6, life: 0.45, size: 4 })
        g.particles(e.x - 12 * e.facing, e.y - 38, { count: 6, color: 0xd8ffe0, speed: 90, life: 0.5, size: 4 })
    }
}

function crystalDeath(e: Enemy, g: GameApi): void {
    g.particles(e.x, e.y, { count: 14, color: 0xff5ad8, speed: 240, life: 0.4, size: 4 })
    g.particles(e.x, e.y, { count: 8, color: 0x5ae8ff, speed: 200, life: 0.4, size: 4 })
    if (g.enemyCount > 540) return
    const n = e.elite ? 4 : 2
    const off = rand(0, TAU)
    const hpMul = Math.max(1, e.maxHp / Math.max(1, e.def.hp)) * (e.elite ? 0.4 : 1)
    for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU
        try {
            const s = g.spawn('crystalShard', e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10, { hpMul })
            if (s) {
                s.ai.h = a
                s.ai.burst = 0.35
            }
        } catch {
            // never let a split break the run
        }
    }
    if (onScreen(e, g)) g.sfx.play('affixSplit', { volume: 0.25, pitch: 1.3, pan: panOf(e, g) })
}

function shardUpdate(e: Enemy, g: GameApi, dt: number): void {
    let h = num(e, 'h', NaN)
    if (Number.isNaN(h)) h = aim(e, g).angle
    const burst = tick(e, 'burst', dt)
    if (burst <= 0) {
        let d = aim(e, g).angle - h
        while (d > Math.PI) d -= TAU
        while (d < -Math.PI) d += TAU
        h += Math.max(-3 * dt, Math.min(3 * dt, d))
    }
    e.ai.h = h
    const sp = burst > 0 ? e.speed * 2 : e.speed
    move(e, g, Math.cos(h) * sp, Math.sin(h) * sp, dt)
}

function lurkerInit(e: Enemy): void {
    e.ai.st = 'under'
    e.ai.t = rand(1.5, 2.5)
    e.untargetable = true
    e.alpha = 0.18
}

function lurkerUpdate(e: Enemy, g: GameApi, dt: number): void {
    const st = e.ai.st
    const t = tick(e, 't', dt)
    if (st === 'under') {
        e.untargetable = true
        e.alpha = 0.16
        e.scale = 0.6
        g.chase(e, dt, 2)
        if (chance(dt * 16)) g.particles(e.x + rand(-10, 10), e.y + 12, { count: 2, color: 0xc8a060, speed: 80, life: 0.45, size: 4 })
        const a = aim(e, g)
        if (t <= 0 && a.dist < 300 && e.stunT <= 0) {
            const target = lead(g, 0.5)
            const dx = target.x - e.x
            const dy = target.y - e.y
            const d = Math.hypot(dx, dy) || 1
            e.ai.dx = dx / d
            e.ai.dy = dy / d
            e.ai.st = 'aim'
            e.ai.t = 0.85
            const len = 560
            g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + (dx / d) * len, y2: e.y + (dy / d) * len, width: 46, delay: 0.85, damage: e.damage * 1.3, color: 0xe0a050 })
            if (onScreen(e, g, 100)) g.sfx.play('telegraph', { volume: 0.3, pitch: 0.55, pan: panOf(e, g) })
        }
        return
    }
    if (st === 'aim') {
        e.facing = num(e, 'dx') < 0 ? -1 : 1
        if (chance(dt * 30)) g.particles(e.x, e.y + 8, { count: 3, color: 0xc8a060, speed: 140, life: 0.4, size: 5 })
        if (t <= 0) {
            e.ai.st = 'breach'
            e.ai.t = 0.85
            e.untargetable = false
            e.alpha = 1
            e.scale = 1
            g.particles(e.x, e.y, { count: 26, color: 0xc8a060, speed: 260, life: 0.6, size: 6 })
            if (onScreen(e, g)) {
                g.shake(0.12)
                g.sfx.play('quake', { volume: 0.35, pitch: 1.3, pan: panOf(e, g) })
            }
        }
        return
    }
    if (st === 'breach') {
        move(e, g, num(e, 'dx') * 660, num(e, 'dy') * 660, dt)
        if (chance(dt * 25)) g.particles(e.x, e.y + 14, { count: 2, color: 0xc8a060, speed: 120, life: 0.4, size: 5 })
        if (t <= 0) {
            e.ai.st = 'surface'
            e.ai.t = rand(1.6, 2.2)
        }
        return
    }
    // surfaced: slow and vulnerable, then dives again
    e.untargetable = false
    e.alpha = 1
    g.chase(e, dt, 0.4)
    if (t <= 0) {
        e.ai.st = 'under'
        e.ai.t = rand(2.2, 3.2)
        g.particles(e.x, e.y, { count: 16, color: 0x8a6a3a, speed: 160, life: 0.5, size: 5 })
    }
}

function beetleUpdate(e: Enemy, g: GameApi, dt: number): void {
    if (flag(e, 'lit')) {
        const t = tick(e, 't', dt)
        e.scale = 1 + (0.4 - t) * 0.9 + Math.sin(e.age * 60) * 0.08
        if (t <= 0) {
            e.ai.blown = true
            e.dead = true
            g.particles(e.x, e.y, { count: 18, color: 0xff7a1a, speed: 260, life: 0.4, size: 5 })
            g.particles(e.x, e.y, { count: 8, color: 0xffe066, speed: 140, life: 0.3, size: 4 })
        }
        return
    }
    let h = num(e, 'h', NaN)
    if (Number.isNaN(h)) h = aim(e, g).angle
    const a = aim(e, g)
    let d = a.angle - h
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    h += Math.max(-3.4 * dt, Math.min(3.4 * dt, d)) + Math.sin(e.age * 11 + num(e, 'seed')) * dt * 2
    e.ai.h = h
    move(e, g, Math.cos(h) * e.speed, Math.sin(h) * e.speed, dt)
    if (a.dist < e.radius + g.player.radius + 26 && e.stunT <= 0) {
        e.ai.lit = true
        e.ai.t = 0.4
        g.telegraphCircle({ x: e.x, y: e.y, radius: 58, delay: 0.4, damage: e.damage * 1.6, color: 0xff6a1a })
        if (onScreen(e, g)) g.sfx.play('affixBlast', { volume: 0.25, pitch: 1.6, pan: panOf(e, g) })
    }
}

function beetleDeath(e: Enemy, g: GameApi): void {
    if (flag(e, 'lit')) return
    g.particles(e.x, e.y, { count: 10, color: 0xff7a1a, speed: 200, life: 0.35, size: 4 })
}

function hopliteUpdate(e: Enemy, g: GameApi, dt: number): void {
    const st = e.ai.st ?? 'march'
    if (st === 'march') {
        const hx = num(e, 'hx')
        const hy = num(e, 'hy')
        if ((hx === 0 && hy === 0) || tick(e, 'm', dt) <= 0) {
            e.ai.st = 'walk'
        } else {
            move(e, g, hx * e.speed * 1.25, hy * e.speed * 1.25, dt)
            return
        }
    }
    if (st === 'thrust') {
        if (tick(e, 't', dt) <= 0) {
            e.ai.st = 'walk'
            e.ai.cd = rand(2.2, 3)
            e.scale = 1
        } else {
            e.scale = 1.06
        }
        return
    }
    g.chase(e, dt)
    const a = aim(e, g)
    if (tick(e, 'cd', dt) <= 0 && a.dist < 150 && e.stunT <= 0) {
        e.ai.st = 'thrust'
        e.ai.t = 0.6
        g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + a.nx * 170, y2: e.y + a.ny * 170, width: 22, delay: 0.5, damage: e.damage * 1.2, color: 0xffb060 })
    }
}

function stalkerUpdate(e: Enemy, g: GameApi, dt: number): void {
    const st = e.ai.st ?? 'hunt'
    const t = tick(e, 't', dt)
    if (st === 'fade') {
        e.alpha = Math.max(0.05, t / 0.35)
        if (t <= 0) {
            // reappear behind the player's line of travel
            const sp = Math.hypot(g.player.vx, g.player.vy)
            const back = sp > 30 ? Math.atan2(-g.player.vy, -g.player.vx) : rand(0, TAU)
            const ang = back + rand(-0.7, 0.7)
            const r = rand(90, 130)
            const x = g.player.x + Math.cos(ang) * r
            const y = g.player.y + Math.sin(ang) * r
            g.particles(e.x, e.y, { count: 14, color: 0x7a2dff, speed: 160, life: 0.4, size: 5 })
            teleport(e, x, y)
            e.ai.st = 'strike'
            e.ai.t = 0.6
            g.telegraphCircle({ x, y, radius: 62, delay: 0.6, damage: e.damage * 1.4, color: 0xc77dff })
            if (onScreen(e, g, 80)) g.sfx.play('blink', { volume: 0.35, pitch: 0.8, pan: panOf(e, g) })
        }
        return
    }
    if (st === 'strike') {
        e.alpha = Math.min(1, 0.15 + (0.6 - t) * 1.6)
        if (t <= 0) {
            e.ai.st = 'hunt'
            e.ai.t = rand(2.6, 3.6)
            e.untargetable = false
            e.alpha = 1
            g.particles(e.x, e.y, { count: 20, color: 0xc77dff, speed: 260, life: 0.4, size: 5 })
        }
        return
    }
    e.untargetable = false
    e.alpha = 1
    g.chase(e, dt, 1)
    if (t <= 0 && e.stunT <= 0 && onScreen(e, g, 60)) {
        e.ai.st = 'fade'
        e.ai.t = 0.35
        e.untargetable = true
    }
}

function goblinUpdate(e: Enemy, g: GameApi, dt: number): void {
    const a = aim(e, g)
    const life = tick(e, 'life', dt)
    if (life <= 0) {
        // got away with the loot
        g.particles(e.x, e.y, { count: 24, color: 0xf5c451, speed: 220, life: 0.6, size: 5 })
        if (onScreen(e, g)) g.sfx.play('blink', { volume: 0.3, pitch: 1.4, pan: panOf(e, g) })
        e.dead = true
        return
    }
    const jitter = Math.sin(e.age * 3 + num(e, 'seed')) * 0.8
    const ang = a.dist < 520 ? a.angle + Math.PI + jitter : a.angle + Math.PI / 2 * (num(e, 'dir') || 1)
    const sp = e.speed * (a.dist < 200 ? 1.15 : 0.85)
    move(e, g, Math.cos(ang) * sp, Math.sin(ang) * sp, dt)
    if (chance(dt * 6)) g.particles(e.x - e.facing * 8, e.y - 6, { count: 1, color: 0xf5c451, speed: 60, life: 0.6, size: 4 })
}

function goblinDeath(e: Enemy, g: GameApi): void {
    if (num(e, 'life', 1) <= 0) return
    g.particles(e.x, e.y, { count: e.elite ? 60 : 28, color: 0xf5c451, speed: 300, life: 0.8, size: 5 })
    g.particles(e.x, e.y, { count: 10, color: 0xffffff, speed: 200, life: 0.4, size: 3 })
    g.sfx.play('coin', { volume: 0.7, pan: panOf(e, g) })
    if (e.elite) g.sfx.play('chestReward', { volume: 0.5 })
}

// ─── Rift Champion: the mid-run mini-boss ────────────────────────────────

function champLeap(e: Enemy, g: GameApi): number {
    const target = lead(g, 0.4)
    e.ai.st = 'leap'
    e.ai.t = 0.85
    e.ai.lx = e.x
    e.ai.ly = e.y
    e.ai.tx = target.x
    e.ai.ty = target.y
    const r = e.elite ? 130 : 110
    g.telegraphCircle({ x: target.x, y: target.y, radius: r, delay: 0.85, damage: e.damage * 1.4, color: 0xff3fa4 })
    g.sfx.play('telegraph', { volume: 0.4, pitch: 0.6 })
    later(0.85, gg => {
        gg.shake(0.35)
        gg.particles(target.x, target.y, { count: 40, color: 0x8a6a9a, speed: 340, life: 0.55, size: 6 })
        gg.particles(target.x, target.y, { count: 20, color: 0xff3fa4, speed: 220, life: 0.5, size: 5 })
        gg.sfx.play('quake', { volume: 0.6 })
        if (num(e, 'tier') >= 2 && !e.dead) ring(gg, target.x, target.y, 14, rand(0, TAU), { speed: 210, damage: e.damage * 0.45, color: 0xff3fa4, radius: 8, kind: 'spike', life: 3 })
    })
    return 2.2
}

function champCleave(e: Enemy, g: GameApi): number {
    const a = aim(e, g)
    const n = num(e, 'tier') >= 1 ? 5 : 3
    for (let i = 0; i < n; i++) {
        const ang = a.angle + (i - (n - 1) / 2) * 0.32
        g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + Math.cos(ang) * 260, y2: e.y + Math.sin(ang) * 260, width: 34, delay: 0.7, damage: e.damage * 1.1, color: 0xff6a5a })
    }
    e.ai.st = 'brace'
    e.ai.t = 0.8
    g.sfx.play('swing', { volume: 0.5, pitch: 0.6 })
    return 1.8
}

function champCry(e: Enemy, g: GameApi): number {
    g.sfx.play('bossRoar', { volume: 0.45, pitch: 1.5 })
    g.shake(0.2)
    g.particles(e.x, e.y, { count: 36, color: 0xff3fa4, speed: 380, life: 0.6, size: 6 })
    for (const o of g.enemies) {
        if (o === e || o.dead || o.boss) continue
        const dx = o.x - e.x
        const dy = o.y - e.y
        if (dx * dx + dy * dy < 340 * 340) buff(o, g, 1.4, 4)
    }
    if (g.enemyCount < 520) {
        const pool = g.time < 240 ? ['ghoul', 'bat'] : g.time < 480 ? ['ghoul', 'hoplite', 'skull'] : ['knight', 'hoplite', 'skull']
        const n = 4 + num(e, 'tier') * 2
        for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU
            summon(g, pick(pool), e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60, hpCurve(g.time))
        }
    }
    return 1.6
}

function champSpin(e: Enemy, g: GameApi): number {
    e.ai.st = 'spin'
    e.ai.t = 1.6
    e.ai.sp = 0
    g.sfx.play('swing', { volume: 0.5, pitch: 0.8 })
    return 2.4
}

function championUpdate(e: Enemy, g: GameApi, dt: number): void {
    const st = e.ai.st ?? ''
    const t = tick(e, 't', dt)
    if (st === 'leap') {
        const k = 1 - Math.max(0, t) / 0.85
        const x = num(e, 'lx') + (num(e, 'tx') - num(e, 'lx')) * k
        const y = num(e, 'ly') + (num(e, 'ty') - num(e, 'ly')) * k
        e.scale = 1 + Math.sin(k * Math.PI) * 0.35
        e.untargetable = k > 0.15 && k < 0.85
        move(e, g, (x - e.x) / Math.max(dt, 1e-3), (y - e.y) / Math.max(dt, 1e-3), dt)
        if (t <= 0) {
            e.ai.st = ''
            e.scale = 1
            e.untargetable = false
        }
        return
    }
    if (st === 'brace') {
        e.vx = 0
        e.vy = 0
        if (t <= 0) e.ai.st = ''
        return
    }
    if (st === 'spin') {
        g.chase(e, dt, 1.3)
        if (tick(e, 'sp', dt) <= 0) {
            e.ai.sp = 0.16
            const off = e.age * 4
            for (let i = 0; i < 3; i++) shoot(g, e.x, e.y, off + (i / 3) * TAU, { speed: 230, damage: e.damage * 0.4, color: 0xff6a8a, radius: 8, kind: 'spike', life: 2.6 })
        }
        if (t <= 0) e.ai.st = ''
        return
    }
    g.chase(e, dt)
    if (e.stunT > 0 || tick(e, 'atk', dt) > 0) return
    const tier = num(e, 'tier')
    const a = aim(e, g)
    const options: ((e: Enemy, g: GameApi) => number)[] = a.dist > 260 ? [champLeap, champLeap, champCry] : [champCleave, champCleave, champLeap]
    if (tier >= 1 && a.dist < 360) options.push(champSpin)
    if (chance(0.2)) options.push(champCry)
    const fn = pick(options)
    e.ai.atk = fn(e, g) * (tier >= 2 ? 0.8 : 1)
}

function championInit(e: Enemy, g: GameApi): void {
    e.ai.tier = g.time > 600 ? 3 : g.time > 400 ? 2 : g.time > 200 ? 1 : 0
    e.ai.atk = 1.5
    g.particles(e.x, e.y, { count: 50, color: 0xff3fa4, speed: 360, life: 0.8, size: 6 })
}

function championDeath(e: Enemy, g: GameApi): void {
    g.particles(e.x, e.y, { count: 70, color: 0xff3fa4, speed: 460, life: 0.9, size: 7 })
    g.particles(e.x, e.y, { count: 40, color: 0xd8a84a, speed: 320, life: 0.8, size: 5 })
    g.flash(0xff3fa4, 0.25)
    g.shake(0.5)
    g.announce('CHAMPION SLAIN', 0xffd24a)
}

// ─── Roster ──────────────────────────────────────────────────────────────

const seed = (e: Enemy) => {
    e.ai.seed = rand(0, TAU)
}

export const EXTRA_DEFS: Record<string, EnemyDef> = {
    herald: {
        id: 'herald', name: 'Grave Herald', hp: 60, speed: 58, damage: 8, radius: 17, xp: 6, mass: 2,
        size: 92, frames: 8, frameRate: 8, glow: 0x7dff9a,
        draw: drawHerald,
        init: e => {
            e.ai.pulse = rand(0.5, 1.2)
        },
        update: heraldUpdate
    },
    crystal: {
        id: 'crystal', name: 'Prism Crawler', hp: 20, speed: 96, damage: 7, radius: 13, xp: 1, mass: 0.8,
        size: 44, frames: 6, frameRate: 14, glow: 0xff5ad8,
        draw: drawCrystal, onDeath: crystalDeath
    },
    crystalShard: {
        id: 'crystalShard', name: 'Prism Shard', hp: 5, speed: 175, damage: 4, radius: 8, xp: 1, mass: 0.4,
        size: 32, frames: 4, frameRate: 16, rotate: true, glow: 0x5ae8ff,
        draw: drawCrystalShard, update: shardUpdate
    },
    lurker: {
        id: 'lurker', name: 'Dune Lurker', hp: 95, speed: 84, damage: 14, radius: 22, xp: 6, mass: 5,
        size: 100, frames: 6, frameRate: 10, glow: 0xffa040,
        draw: drawLurker, init: lurkerInit, update: lurkerUpdate
    },
    beetle: {
        id: 'beetle', name: 'Cinder Beetle', hp: 6, speed: 160, damage: 7, radius: 10, xp: 1, mass: 0.5,
        size: 44, frames: 4, frameRate: 16, rotate: true, glow: 0xff7a1a,
        draw: drawBeetle, init: seed, update: beetleUpdate, onDeath: beetleDeath
    },
    hoplite: {
        id: 'hoplite', name: 'Rift Hoplite', hp: 80, speed: 56, damage: 12, radius: 19, xp: 4, mass: 6,
        size: 76, frames: 6, frameRate: 8,
        draw: drawHoplite,
        init: e => {
            e.ai.cd = rand(1, 2)
        },
        update: hopliteUpdate
    },
    stalker: {
        id: 'stalker', name: 'Void Stalker', hp: 42, speed: 118, damage: 11, radius: 15, xp: 4,
        size: 68, frames: 8, frameRate: 12, glow: 0xc77dff,
        draw: drawStalker,
        init: e => {
            e.ai.st = 'hunt'
            e.ai.t = rand(1.5, 3)
        },
        update: stalkerUpdate
    },
    goblin: {
        id: 'goblin', name: 'Treasure Goblin', hp: 34, speed: 150, damage: 0, radius: 14, xp: 12, mass: 0.8,
        size: 60, frames: 6, frameRate: 14, glow: 0xf5c451,
        draw: drawGoblin,
        init: e => {
            seed(e)
            e.ai.life = rand(15, 19)
            e.ai.dir = chance(0.5) ? 1 : -1
        },
        update: goblinUpdate, onDeath: goblinDeath
    },
    champion: {
        id: 'champion', name: 'Rift Champion', hp: 950, speed: 70, damage: 18, radius: 30, xp: 30, mass: 9,
        size: 140, frames: 6, frameRate: 7, glow: 0xff3fa4,
        draw: drawChampion, init: championInit, update: championUpdate, onDeath: championDeath
    }
}
