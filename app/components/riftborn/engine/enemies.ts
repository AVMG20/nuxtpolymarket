/*
 * The RIFTBORN horde: every regular enemy, drawn procedurally and given its
 * own little brain. Bosses live in bosses.ts and are merged in at the bottom.
 */
import type { Graphics } from 'pixi.js'
import { OUTLINE, TAU, mix, pen, shade } from './content-art'
import type { Pen } from './content-art'
import { aim, chance, flag, hpMulOf, kite, later, lead, move, num, pick, rand, ring, shoot, summon, tick } from './content-ai'
import { BOSS_DEFS } from './bosses'
import { EXTRA_DEFS } from './enemies-extra'
import type { Enemy, EnemyDef, GameApi } from './types'

function panOf(e: Enemy, g: GameApi): number {
    return Math.max(-1, Math.min(1, (e.x - g.player.x) / Math.max(200, g.view.width / 2)))
}

function onScreen(e: Enemy, g: GameApi, margin = 40): boolean {
    return Math.abs(e.x - g.player.x) < g.view.width / 2 + margin && Math.abs(e.y - g.player.y) < g.view.height / 2 + margin
}

/** Chase plus a sideways push on top (wobbles, zigzags) */
function chaseWobble(e: Enemy, g: GameApi, dt: number, speedMul: number, side: number): void {
    g.chase(e, dt, speedMul)
    if (e.stunT > 0) return
    const a = aim(e, g)
    const px = -a.ny * side
    const py = a.nx * side
    // nudge on top of whatever chase did, in either movement convention
    e.x += px * dt
    e.y += py * dt
}

// ─── Drawings ────────────────────────────────────────────────────────────
//
// Every sprite faces right, is lit from the top-left, carries a dark outline,
// a rim light in its accent colour and glowing eyes. Walkers and flyers get
// 6-8 frames with secondary motion (lagging wings, swaying cloth, bobbing
// heads) so a crowd of them never looks like a stamped pattern.

function drawBat(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const flap = Math.sin(ph)
    const lag = Math.sin(ph - 1.1)
    const bob = -flap * 1.6
    const tipY = -5 - flap * 13
    const midY = -2 - flap * 7.5
    const wing = 0x431a68
    const mem = 0x7a35b5
    const bone = 0x1e0b33
    P.halo(0, 2, 18, 0x9b3dff, 0.16)
    for (const s of [-1, 1]) {
        const tx = s * (22 - Math.abs(flap) * 2.5)
        P.shape([s * 4, -2 + bob, s * 11, midY - 6, tx, tipY, tx - s, tipY + 7, s * 17, midY + 5 + lag * 2, s * 13.5, midY + 3, s * 10, midY + 8 + lag * 2, s * 5, 5 + bob], wing, OUTLINE, 2)
        P.poly([s * 6, bob, s * 11, midY - 3, s * 18, tipY + 4, s * 15.5, midY + 3.5, s * 11, midY + 3, s * 7, 3 + bob], mem, 0.5)
        P.path([s * 5, -1 + bob, s * 11, midY - 5.5, tx, tipY + 1], bone, 1.4)
        P.path([s * 11, midY - 5.5, s * 16.5, midY + 4.5], bone, 1.2)
        P.path([s * 11, midY - 5.5, s * 11.5, midY + 3.5], bone, 1.1)
        P.path([s * 6, -1 + bob, s * 11, midY - 6.5, tx, tipY - 0.5], 0xb57ae8, 0.9, 0.6)
        P.poly([s * 11, midY - 6, s * 13.5, midY - 9.5, s * 12.5, midY - 5], 0xe9e4d4)
    }
    P.line(-2, 8 + bob, -3 + lag * 1.6, 12.5 + bob, OUTLINE, 3)
    P.line(2, 8 + bob, 3 + lag * 1.6, 12.5 + bob, OUTLINE, 3)
    for (const s of [-1, 1]) {
        P.shape([s * 1.5, -5 + bob, s * 5.5, -14.5 + bob - lag * 1.2, s * 6.5, -4 + bob], 0x3a1d5c, OUTLINE, 1.5)
        P.poly([s * 2.6, -5.5 + bob, s * 5.2, -12 + bob - lag * 1.2, s * 5.4, -5.5 + bob], 0xd0679a, 0.75)
    }
    P.ball(0, 2 + bob, 8, 0x4a2370, 0xc77dff, OUTLINE, 2)
    P.ellipse(0.6, 5.4 + bob, 4, 4.2, 0x7a45a8, 0.85)
    P.path([-1.5, 4 + bob, -0.5, 6 + bob, 1, 4.5 + bob, 2, 6.5 + bob], 0x5a2d85, 0.9)
    P.poly([-1.3, 4.6 + bob, -0.4, 8.4 + bob, 0.5, 4.6 + bob], 0xffffff)
    P.poly([1.6, 4.6 + bob, 2.4, 7.6 + bob, 3.2, 4.6 + bob], 0xffffff)
    P.eye(-2.3, 0.4 + bob, 1.8, 0xff3355)
    P.eye(2.9, 0.4 + bob, 1.8, 0xff3355)
}

function drawGhoul(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 1.6
    const lag = Math.sin(ph - 0.8)
    const skin = 0x7ea062
    const dark = 0x3d5232
    const rag = 0x4a3a52
    // back leg, back arm
    P.limb([-4, 9, -6 + step * 4.5, 15, -7 + step * 5, 21], shade(dark, 0.85), 4.2)
    P.limb([3, -2 + bob, 12 + lag * 2, 5 + bob, 17 + lag * 3, 6], shade(skin, 0.7), 4)
    // torso
    P.shape([-11, 11, -13, -1, -8, -11 + bob, 4, -12 + bob, 10, -6 + bob, 10, 6, 4, 12], 0x5d7a4a, OUTLINE, 2.5)
    P.poly([-11, 10, -12, 0, -9, -8 + bob, -6, 4], shade(0x5d7a4a, 0.72), 0.9)
    P.ellipse(-3, -3 + bob, 4.5, 7, shade(0x5d7a4a, 1.22), 0.55)
    for (let i = 0; i < 3; i++) P.path([-7, -3 + bob + i * 4, -1, -5 + bob + i * 4, 2, -4 + bob + i * 4], dark, 1.4)
    // torn rag skirt
    P.shape([-12, 7, -10, 15 + lag * 1.5, -7, 11, -4, 16 - lag, -1, 11, 3, 15 + lag, 5, 9], rag, OUTLINE, 1.8)
    P.path([-11, 8.5, 4, 9.5], shade(rag, 1.4), 1)
    // front leg
    P.limb([4, 9, 6 - step * 4.5, 15, 6 - step * 5, 21], dark, 4.4)
    P.ellipse(-3, 8, 2, 1.5, 0x8a2a2a, 0.9)
    // head
    P.ball(11, -10 + bob, 7.8, skin, 0xd4ff7a, OUTLINE, 2.5)
    P.shape([7, -16 + bob, 9, -19 + bob, 13, -18 + bob, 16, -15 + bob, 12, -16 + bob], 0x2a2a1e, OUTLINE, 1.2)
    P.shape([8, -6 + bob, 18.5, -5 + bob + lag, 15, 0.5 + bob + lag, 9, -1 + bob], shade(skin, 0.65), OUTLINE, 1.6)
    P.line(11, -5 + bob, 11, -2 + bob, 0xe9e4d4, 1.3)
    P.line(14, -5 + bob, 14, -1.5 + bob, 0xe9e4d4, 1.3)
    P.line(16.5, 0.5 + bob + lag, 16.8, 3.5 + bob + lag * 2, 0xa8ff6a, 1.1, 0.8)
    P.ellipse(13.6, -11 + bob, 2.6, 2.4, 0x1a2410)
    P.ellipse(9.6, -11.4 + bob, 2.1, 2, 0x1a2410)
    P.eye(14, -11 + bob, 1.8, 0xe8ff5a)
    P.eye(9.8, -11.5 + bob, 1.4, 0xe8ff5a)
    // front arm reaching, claws
    P.limb([2, -3 + bob, 11 - lag * 2, 2 + bob, 18 - lag * 3, 4], skin, 4.4)
    for (let i = -1; i <= 1; i++) P.line(18 - lag * 3, 4, 22.5 - lag * 3, 4.5 + i * 2.6, 0xe9e4d4, 1.4)
}

function drawSlimeBody(P: Pen, frame: number, frames: number, s: number, color: number, core: boolean): void {
    const ph = (frame / frames) * TAU
    const sq = Math.sin(ph)
    const rx = 20 * s * (1 + sq * 0.14)
    const ry = 16 * s * (1 - sq * 0.14)
    const base = 11 * s
    const pts: number[] = []
    for (let i = 0; i <= 18; i++) {
        const a = Math.PI + (i / 18) * Math.PI
        const wob = 1 + Math.sin(a * 3 + ph * 2) * 0.03
        pts.push(Math.cos(a) * rx * wob, base + Math.sin(a) * ry * 1.6 * wob)
    }
    pts.push(rx * 0.95, base + 1.5 * s, rx * 0.5, base + 4 * s, 0, base + 3 * s, -rx * 0.5, base + 4 * s, -rx * 0.95, base + 1.5 * s)
    P.halo(0, base - ry * 0.7, rx * 1.25, color, 0.16)
    P.shadow(0, base + 3 * s, rx * 0.95, 4 * s, 0.3)
    P.g.poly(pts).fill({ color: P.c(shade(color, 0.62)), alpha: 0.95 })
    P.ellipse(-rx * 0.08, base - ry * 0.68, rx * 0.86, ry * 1.18, color, 0.92)
    P.ellipse(-rx * 0.15, base - ry * 0.85, rx * 0.6, ry * 0.8, mix(color, 0xffffff, 0.18), 0.6)
    if (core) {
        // a swallowed skull drifting inside
        const sx = -rx * 0.3 + Math.sin(ph) * 2 * s
        const sy = base - ry * 0.4 + Math.cos(ph) * 1.5 * s
        P.circle(sx, sy, 4.2 * s, 0xe9e4d4, 0.45)
        P.circle(sx - 1.4 * s, sy, 1.1 * s, shade(color, 0.3), 0.6)
        P.circle(sx + 1.4 * s, sy, 1.1 * s, shade(color, 0.3), 0.6)
    }
    for (let i = 0; i < 4; i++) {
        const t = ((frame / frames) + i * 0.27) % 1
        P.circle(rx * (0.5 - i * 0.28), base - ry * (0.2 + t * 1.1), (1 + i * 0.35) * s, mix(color, 0xffffff, 0.55), 0.6 * (1 - t))
    }
    P.g.poly(pts).stroke({ color: P.c(shade(color, 0.28)), width: 2.5 * Math.max(0.7, s), join: 'round' })
    P.g.moveTo(rx * 0.55, base - ry * 1.25).quadraticCurveTo(rx * 0.95, base - ry * 0.7, rx * 0.85, base).stroke({ color: P.c(mix(color, 0xffffff, 0.6)), width: 1.8 * s, alpha: 0.7, cap: 'round' })
    P.ellipse(-rx * 0.42, base - ry * 1.2, rx * 0.26, ry * 0.2, 0xffffff, 0.65)
    P.circle(-rx * 0.15, base - ry * 1.42, 1.5 * s, 0xffffff, 0.8)
    const ey = base - ry * 0.95
    const blink = frame === frames - 2
    for (const ex of [rx * 0.2, rx * 0.62]) {
        if (blink) {
            P.line(ex - 2.5 * s, ey, ex + 2.5 * s, ey, 0x08201c, 1.4 * s)
            continue
        }
        P.ellipse(ex, ey, 2.7 * s, 3.9 * s, 0x08201c)
        P.circle(ex + 0.6 * s, ey + 0.4 * s, 1.5 * s, shade(color, 0.6))
        P.circle(ex - 0.8 * s, ey - 1.3 * s, 1.1 * s, 0xffffff)
    }
    P.g.moveTo(rx * 0.25, ey + 5 * s).quadraticCurveTo(rx * 0.42, ey + 7.5 * s + sq * s, rx * 0.6, ey + 5 * s).stroke({ color: P.c(0x08201c), width: 1.5 * s, cap: 'round' })
}

function drawSlime(g: Graphics, frame: number, white: boolean): void {
    drawSlimeBody(pen(g, white), frame, 8, 1, 0x2fd6b0, true)
}

function drawSlimeling(g: Graphics, frame: number, white: boolean): void {
    drawSlimeBody(pen(g, white), frame, 6, 0.55, 0x5fffd0, false)
}

function drawCharger(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const bob = Math.abs(Math.cos(ph)) * 1.5
    const hide = 0x8a3b2a
    const legC = shade(hide, 0.55)
    for (const [x, o] of [[-14, 0], [8, Math.PI]] as const) {
        const s = Math.sin(ph + o)
        P.limb([x, 5, x + s * 3, 13, x + s * 5, 20], shade(legC, 0.8), 4)
    }
    P.shape([-25, -2 + bob, -21, -10 + bob, -17, -8 + bob, -15, -17 + bob, -10, -10 + bob, -6, -19 + bob, -2, -11 + bob, 3, -19 + bob, 6, -10 + bob, 11, -15 + bob, 13, -6 + bob], 0x3e160f, OUTLINE, 2)
    P.egg(-3, 1 + bob, 21, 12.5, hide, 0xff9a4a, OUTLINE, 3)
    P.path([-18, -3 + bob, -12, -1 + bob, -6, -3 + bob], shade(hide, 0.7), 1.3)
    P.path([-16, 4 + bob, -9, 6 + bob, -2, 4 + bob], shade(hide, 0.7), 1.3)
    P.ellipse(-4, 8 + bob, 14, 3.5, shade(hide, 1.35), 0.55)
    for (const [x, o] of [[-8, Math.PI], [14, 0]] as const) {
        const s = Math.sin(ph + o)
        P.limb([x, 6 + bob, x + s * 3, 13, x + s * 5, 20], legC, 4.5)
        P.ellipse(x + s * 5, 20.5, 3, 1.8, 0x1a0c08)
    }
    P.shape([12, -8 + bob, 24, -6 + bob, 30, 0 + bob, 29, 6 + bob, 20, 9 + bob, 13, 6 + bob], shade(hide, 0.92), OUTLINE, 2.5)
    P.ellipse(19, -3 + bob, 5, 2.5, shade(hide, 1.3), 0.55)
    P.ellipse(28, 2 + bob, 2.4, 3.4, 0x2a1410)
    P.circle(28.5, 1 + bob, 0.9, 0xff9a4a, 0.8)
    P.shape([24, 4 + bob, 32, -3 + bob, 29, 5.5 + bob], 0xf1e3c0, OUTLINE, 1.5)
    P.shape([13, -7 + bob, 17, -17 + bob, 24, -23 + bob, 31, -19 + bob, 25.5, -17.5 + bob, 20, -12 + bob, 18, -6 + bob], 0xf1e3c0, OUTLINE, 2)
    P.path([16.5, -11 + bob, 23, -19.5 + bob], shade(0xf1e3c0, 0.65), 1.2)
    P.path([18, -9 + bob, 25.5, -20.5 + bob], 0xffffff, 0.8, 0.7)
    P.slit(21, -3 + bob, 2.6, 1.6, 0xffa02b)
    P.path([17, -6 + bob, 24, -5.5 + bob], OUTLINE, 2)
    if (frame % 3 === 0) P.circle(34, 4 + bob, 2.2, 0xd8d0c8, 0.35)
}

function drawArcher(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const step = Math.sin(ph)
    const pull = (0.5 - 0.5 * Math.cos(ph)) * 5.5
    const bob = Math.abs(Math.cos(ph)) * 1
    const bone = 0xe9e4d4
    const boneD = 0x9c9584
    const cloak = 0x2c3150
    // tattered cloak behind
    P.shape([-3, -10 + bob, -12, -6 + bob, -14, 14 + step, -10, 11, -8, 17 - step, -5, 12, -2, 14], cloak, OUTLINE, 1.8)
    P.poly([-4, -8 + bob, -10, -5 + bob, -11, 10, -7, 9], shade(cloak, 1.35), 0.7)
    // quiver
    P.rect(-9, -12 + bob, 5, 14, 0x5a3a22, 1.5)
    for (let i = 0; i < 3; i++) P.line(-8 + i * 1.5, -12 + bob, -9 + i * 2, -17 + bob, 0xd8d0b0, 1)
    P.limb([-3, 10, -5 + step * 3, 16, -6 + step * 4, 22], boneD, 2.8)
    P.limb([3, 10, 4 - step * 3, 16, 5 - step * 4, 22], bone, 2.8)
    P.oval(0, 9, 6, 3, boneD, OUTLINE, 1.8)
    P.line(0, -6 + bob, 0, 9, OUTLINE, 5)
    P.line(0, -6 + bob, 0, 9, bone, 3)
    for (let i = 0; i < 3; i++) {
        const y = -4 + i * 4 + bob
        P.g.moveTo(-6 + i, y).quadraticCurveTo(0, y - 3, 6 - i, y).stroke({ color: P.c(OUTLINE), width: 4, cap: 'round' })
        P.g.moveTo(-6 + i, y).quadraticCurveTo(0, y - 3, 6 - i, y).stroke({ color: P.c(bone), width: 2, cap: 'round' })
    }
    P.halo(0, 0, 5, 0x5ff2ff, 0.25)
    P.limb([1, -5 + bob, 6 - pull * 0.5, -3, 10 - pull, -2], bone, 2.2)
    P.limb([1, -5 + bob, 8, -3, 14, -2], bone, 2.2)
    P.g.moveTo(14, -19).quadraticCurveTo(27 + pull * 0.3, -2, 14, 15).stroke({ color: P.c(OUTLINE), width: 5, cap: 'round' })
    P.g.moveTo(14, -19).quadraticCurveTo(27 + pull * 0.3, -2, 14, 15).stroke({ color: P.c(0x7a4a26), width: 3, cap: 'round' })
    P.g.moveTo(15, -16).quadraticCurveTo(25 + pull * 0.3, -2, 15.5, 11).stroke({ color: P.c(0xb07a46), width: 1, alpha: 0.8, cap: 'round' })
    P.path([14, -19, 10 - pull, -2, 14, 15], 0xd8d0b0, 1)
    P.line(10 - pull, -2, 25, -2, 0x7a4a26, 1.6)
    P.poly([25, -4.5, 29.5, -2, 25, 0.5], 0xb8c4d8)
    P.poly([10 - pull, -2, 7 - pull, -4.5, 8 - pull, -2, 7 - pull, 0.5], 0xd23a5a)
    P.ball(0, -13 + bob, 7.5, bone, 0x5ff2ff, OUTLINE, 2.2)
    P.rect(-3, -8 + bob, 7, 4, bone, 1.5)
    P.line(-1, -7 + bob, -1, -4.5 + bob, boneD, 0.8)
    P.line(1.5, -7 + bob, 1.5, -4.5 + bob, boneD, 0.8)
    P.shape([-8, -14 + bob, -5, -22 + bob, 3, -22 + bob, 7, -17 + bob, 0, -19 + bob], cloak, OUTLINE, 1.6)
    P.ellipse(2.6, -13.5 + bob, 2.3, 2.6, 0x0c0c14)
    P.ellipse(-2.4, -13.5 + bob, 2, 2.4, 0x0c0c14)
    P.eye(2.6, -13.5 + bob, 1.2, 0x5ff2ff)
    P.eye(-2.4, -13.5 + bob, 1, 0x5ff2ff)
    P.poly([0, -10.5 + bob, -1, -8.5 + bob, 1, -8.5 + bob], 0x14141c)
}

function drawBomber(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 1.4
    const spark = 3.5 + Math.abs(Math.sin(ph * 2)) * 3
    const pulse = 0.5 + 0.5 * Math.sin(ph * 2)
    P.oval(-6 + step * 3.5, 15, 4.2, 2.8, 0x1a1a24, OUTLINE, 1.8)
    P.oval(6 - step * 3.5, 15, 4.2, 2.8, 0x1a1a24, OUTLINE, 1.8)
    P.halo(0, 2, 22, 0xff7a1a, 0.12 + pulse * 0.1)
    P.ball(0, 2 - bob, 13.5, 0x34344a, 0xff8a2b, OUTLINE, 2.8)
    P.ring(0, 2 - bob, 13.5, 0x52526a, 1.5, 0.6)
    const crack = mix(0xff6a1a, 0xffe066, pulse)
    P.path([-9, 6 - bob, -4, 3 - bob, -6, 0 - bob, -2, -3 - bob], crack, 1.8)
    P.path([4, 12 - bob, 7, 8 - bob, 11, 9 - bob], crack, 1.8)
    P.path([-2, 13 - bob, 0, 10 - bob], crack, 1.4)
    // rivets
    for (const a of [-2.4, -1.6, 2.8]) P.circle(Math.cos(a) * 11, 2 - bob + Math.sin(a) * 11, 1.1, 0x8888a0)
    P.rect(1, -13 - bob, 6, 4, 0x6a6a80, 1)
    P.rect(1, -13 - bob, 6, 1.5, 0x9a9ab0, 0.5)
    P.g.moveTo(4, -13 - bob).quadraticCurveTo(5, -19 - bob, 10 + step, -19.5 - bob).stroke({ color: P.c(0x8a6a3a), width: 2, cap: 'round' })
    P.halo(10 + step, -19.5 - bob, spark * 2.4, 0xffa02b, 0.55)
    P.star(10 + step, -19.5 - bob, 6, spark, spark * 0.4, 0xffe066, frame * 0.5)
    P.circle(10 + step, -19.5 - bob, 1.6, 0xffffff)
    P.line(1, -3 - bob, 6, -1 - bob, OUTLINE, 2.2)
    P.line(11.5, -3 - bob, 7.5, -1 - bob, OUTLINE, 2.2)
    P.eye(4, 1 - bob, 1.8, 0xffb02b)
    P.eye(9.5, 1 - bob, 1.8, 0xffb02b)
    P.g.moveTo(2, 7 - bob).quadraticCurveTo(6.5, 4.5 - bob, 11, 7 - bob).stroke({ color: P.c(0xff8a2b), width: 1.6, cap: 'round' })
}

function drawGhost(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const w = Math.sin(ph)
    const w2 = Math.cos(ph)
    const bob = Math.sin(ph) * 1.5
    const body = 0xbfefff
    const edge = 0x3a6a88
    P.halo(0, bob, 27, 0x7affff, 0.2)
    // trailing wisps
    P.poly([-6, 12 + bob, -16 - w * 3, 22, -8, 16 + bob], body, 0.3)
    P.poly([2, 14 + bob, -2 + w2 * 3, 25, 5, 16 + bob], body, 0.25)
    P.shape([-13, 0 + w + bob, -21, 6 + w * 2.5 + bob, -18.5, 9.5 + bob, -10, 5 + bob], body, edge, 1.8)
    P.g.poly([-11, -5 + bob, -8, -15 + bob, 0, -19 + bob, 8, -15 + bob, 12, -5 + bob, 11, 5 + bob, 7 + w * 2, 12 + bob, 3 + w, 20, -1, 14 + w2 + bob, -5, 21 - w, -9, 13 + w2 + bob, -12, 4 + bob])
        .fill({ color: P.c(body), alpha: 0.9 })
        .stroke({ color: P.c(edge), width: 2.2, join: 'round' })
    P.ellipse(-3, 2 + bob, 5.5, 10, 0xffffff, 0.35)
    P.ellipse(6, 4 + bob, 4, 8, 0x8fc8e0, 0.4)
    P.arc(1, -4 + bob, 13, 0.2, 1.3, 0x7affff, 1.6, 0.6)
    P.shape([12, 0 - w + bob, 22, 3.5 - w * 2.5 + bob, 20, 8.5 + bob, 11, 6 + bob], body, edge, 1.8)
    P.ellipse(2.5, -9 + bob, 7.2, 6.6, 0x10202e)
    P.slit(-0.5, -9.5 + bob, 1.8, 2.2, 0x7affff, 0.8 + w * 0.2)
    P.slit(5.2, -9.5 + bob, 1.8, 2.2, 0x7affff, 0.8 + w * 0.2)
    P.ellipse(2.5, -4.2 + bob, 2.1, 1.3 + Math.abs(w) * 1.2, 0x05101a)
}

function drawShieldbearer(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 1.2
    const lag = Math.sin(ph - 1)
    const steel = 0x7d8fa8
    const plate = 0x58657a
    P.limb([-6, 10, -7 + step * 2, 17, -8 + step * 3.5, 24], shade(plate, 0.7), 5)
    // cape
    P.shape([-10, -12 + bob, -18, 6 + lag * 2, -15, 14, -11, 10 + lag, -8, 16, -6, 4], 0x7a1a1a, OUTLINE, 2)
    P.poly([-11, -10 + bob, -15, 4 + lag * 2, -12, 8], 0xb83030, 0.7)
    P.shape([-14, -6 + bob, -16, 10, -6, 14, 6, 12, 8, -8 + bob, 0, -12 + bob, -10, -12 + bob], plate, OUTLINE, 2.8)
    P.poly([-13, -4 + bob, -14, 8, -9, 11, -8, -9 + bob], shade(plate, 0.75), 0.9)
    P.path([-12, -2 + bob, 4, -4 + bob], shade(plate, 1.4), 1.4)
    P.path([-12, 4, 4, 2], shade(plate, 0.65), 1.4)
    P.circle(-3, 0 + bob, 1.2, 0xd8b45a)
    P.limb([3, 10, 4 - step * 2, 17, 5 - step * 3.5, 24], shade(plate, 0.85), 5)
    P.shape([-16, -10 + bob, -12, -14 + bob, -6, -12 + bob, -10, -6 + bob], steel, OUTLINE, 2)
    P.g.moveTo(-6, -24 + bob).quadraticCurveTo(-16, -31 + bob, -19 + lag * 2, -18 + bob).stroke({ color: P.c(0x7a1a1a), width: 6, cap: 'round' })
    P.g.moveTo(-6, -24 + bob).quadraticCurveTo(-16, -31 + bob, -19 + lag * 2, -18 + bob).stroke({ color: P.c(0xd84040), width: 3.5, cap: 'round' })
    P.ball(-3, -17 + bob, 8.5, steel, 0xb06bff, OUTLINE, 2.5)
    P.rect(-2, -18 + bob, 9, 3, 0x14141c, 1)
    P.halo(4, -16.5 + bob, 5, 0xff3030, 0.5)
    P.line(0, -16.5 + bob, 7, -16.5 + bob, 0xff5a5a, 1.6)
    // tower shield
    P.rect(7, -22 + bob, 15, 44, OUTLINE, 5)
    P.rect(8.5, -20.5 + bob, 12, 41, shade(steel, 0.75), 4)
    P.rect(8.5, -20.5 + bob, 9.5, 38, steel, 4)
    P.rect(9.5, -19.5 + bob, 3, 34, mix(steel, 0xffffff, 0.35), 1.5, 0.6)
    P.g.roundRect(8.5, -20.5 + bob, 12, 41, 4).stroke({ color: P.c(0xd8b45a), width: 2 })
    P.halo(14.5, bob, 8, 0xb06bff, 0.35)
    P.ellipse(14.5, bob, 3.8, 6, 0x2a1440)
    P.slit(14.5, bob, 1.6, 3.6, 0xb06bff, 0.6 + 0.4 * Math.abs(step))
    P.circle(14.5, -15 + bob, 1.3, 0xd8b45a)
    P.circle(14.5, 15 + bob, 1.3, 0xd8b45a)
}

function drawCultist(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const pulse = Math.sin(ph)
    const sway = Math.sin(ph) * 1.5
    const robe = 0x8c1c3a
    P.shadow(0, 22, 14, 3)
    P.shape([-13 - sway, 22, -10, -3, -5, -12, 6, -12, 10, -3, 13 - sway, 22, 7 - sway * 0.5, 19.5, 3, 22, -3, 19.5, -8 - sway * 0.5, 22], robe, OUTLINE, 2.5)
    P.poly([-12 - sway, 21, -9, -2, -5, -10, -4, 20], shade(robe, 0.7), 0.85)
    P.path([-12 - sway, 19, -7, 20, -3, 18, 3, 20, 7, 18, 12 - sway, 19], 0xf5c451, 1.8)
    P.line(1, -8, 1, 20, shade(robe, 0.55), 2)
    P.ellipse(4, 4, 3, 11, shade(robe, 1.35), 0.45)
    // runic sash
    P.path([-8, 2, 9, -1], 0xf5c451, 1.6)
    for (let i = 0; i < 3; i++) P.circle(-4 + i * 5, 1.4 - i * 0.6, 1, 0xff3fa4)
    P.shape([-8, -6, -5, -20, 0, -26, 6, -20, 9, -6], shade(robe, 0.85), OUTLINE, 2.4)
    P.poly([-6, -7, -3, -19, 0, -24, -1, -8], shade(robe, 0.65), 0.8)
    P.ellipse(2, -12, 5, 6, 0x14060c)
    P.slit(0.5, -13, 1.4, 1.1, 0xff3fa4, 0.7 + 0.3 * pulse)
    P.slit(4.5, -13, 1.4, 1.1, 0xff3fa4, 0.7 + 0.3 * pulse)
    P.line(15, 22, 15, -16, OUTLINE, 4.5)
    P.line(15, 22, 15, -16, 0x5a3a22, 2.6)
    P.line(14.4, 20, 14.4, -14, 0x8a6040, 0.8)
    P.shape([12, -16, 15, -21, 18, -16, 15, -14], 0xf5c451, OUTLINE, 1.4)
    P.limb([6, 0, 10, 0, 14, -2], robe, 3)
    const oy = -26 + pulse * 1.5
    P.halo(15, oy, 12 + pulse * 2.5, 0xff3fa4, 0.45)
    P.ball(15, oy, 4.6, 0xff3fa4, 0xffd0ec, 0x5a0a30, 1.6)
    for (let i = 0; i < 4; i++) {
        const a = ph / 2 + (i * TAU) / 4
        const rx = 15 + Math.cos(a) * 10
        const ry = oy + Math.sin(a) * 4
        const front = Math.sin(a) > 0
        P.poly([rx, ry - 2.5, rx + 1.6, ry, rx, ry + 2.5, rx - 1.6, ry], front ? 0xffd0ec : 0xb0306a, front ? 0.95 : 0.6)
    }
}

function drawWorm(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const flesh = 0xb5654a
    P.ellipse(0, 24, 22, 7, 0x1a0e08)
    P.ellipse(0, 22.5, 24, 6, 0x5a3a22, 0.6)
    for (let i = 0; i < 7; i++) P.circle(-21 + i * 7, 22 + Math.sin(i * 2 + ph) * 2, 2.5, i % 2 ? 0x6a4a2a : 0x7a5a36)
    for (let i = 0; i < 6; i++) {
        const y = 18 - i * 7
        const x = Math.sin(ph + i * 0.8) * 3.8
        const r = 13 - i * 0.5
        P.egg(x, y, r, 6.2, i % 2 ? flesh : shade(flesh, 0.85), 0xffb08a, OUTLINE, 2.2)
        P.path([x - r * 0.6, y + 1, x - r * 0.2, y + 3, x + r * 0.3, y + 3, x + r * 0.7, y + 1], shade(flesh, 0.6), 1)
    }
    const hx = Math.sin(ph + 5) * 3.8
    const open = 4.5 + Math.sin(ph) * 2.8
    P.egg(hx, -22, 14, 9, shade(flesh, 1.08), 0xffb08a, OUTLINE, 2.6)
    P.halo(hx, -22, open + 7, 0xff6a3a, 0.4)
    P.ellipse(hx, -22, open + 4, open * 0.6 + 2.5, 0x2a0a0a)
    P.ellipse(hx, -21, open * 0.55, open * 0.32, 0xff6a3a, 0.9)
    P.circle(hx, -21, open * 0.2, 0xffd0a0)
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU
        const tx = hx + Math.cos(a) * (open + 4)
        const ty = -22 + Math.sin(a) * (open * 0.6 + 2.5)
        const ix = hx + Math.cos(a) * (open + 0.5)
        const iy = -22 + Math.sin(a) * (open * 0.6)
        P.poly([tx + Math.sin(a) * 1.5, ty - Math.cos(a) * 1.1, tx - Math.sin(a) * 1.5, ty + Math.cos(a) * 1.1, ix, iy], 0xf1ead8)
    }
}

function drawDrone(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const rot = (frame / 6) * (TAU / 8)
    P.ring(0, 0, 22, 0xff4040, 3, 0.2)
    P.halo(0, 0, 25, 0xaab4c8, 0.12)
    const pts: number[] = []
    for (let i = 0; i < 8; i++) {
        const a = rot + (i / 8) * TAU
        pts.push(Math.cos(a) * 14, Math.sin(a) * 14)
        pts.push(Math.cos(a + 0.18) * 23, Math.sin(a + 0.18) * 23)
        pts.push(Math.cos(a + 0.5) * 17, Math.sin(a + 0.5) * 17)
    }
    P.shape(pts, 0x8a94a8, OUTLINE, 2.2)
    for (let i = 0; i < 8; i++) {
        const a = rot + (i / 8) * TAU
        P.poly([Math.cos(a) * 14.5, Math.sin(a) * 14.5, Math.cos(a + 0.18) * 22, Math.sin(a + 0.18) * 22, Math.cos(a + 0.3) * 16, Math.sin(a + 0.3) * 16], 0xd0d8e8, 0.8)
        P.line(Math.cos(a + 0.12) * 15, Math.sin(a + 0.12) * 15, Math.cos(a + 0.18) * 21, Math.sin(a + 0.18) * 21, 0xffffff, 1.1, 0.8)
    }
    P.ball(0, 0, 11.5, 0x5a6478, 0xff6a6a, OUTLINE, 2)
    P.ring(0, 0, 8, 0x2a3040, 1.5)
    for (let i = 0; i < 4; i++) {
        const a = -rot * 2 + (i / 4) * TAU
        P.circle(Math.cos(a) * 8, Math.sin(a) * 8, 1.4, i === 0 ? 0xff6a6a : 0xd0d6e4)
    }
    P.disc(0, 0, 5.5, 0x22262f, OUTLINE, 1.5)
    P.eye(0, 0, 2.9, 0xff4040)
}

function drawImp(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const flap = Math.sin(ph)
    const bob = -flap * 1.4
    const skin = 0xe2481f
    P.halo(0, bob, 22, 0xff7a1a, 0.22)
    // wings
    P.shape([-3, -6 + bob, -15, -17 - flap * 7 + bob, -20, -6 - flap * 3 + bob, -13, -4 + bob, -17, 2 - flap + bob, -6, 1 + bob], 0x7a160c, OUTLINE, 2)
    P.poly([-5, -5 + bob, -14, -14 - flap * 6 + bob, -16, -6 - flap * 2 + bob, -8, -1 + bob], 0xc23a1a, 0.6)
    // tail with flame
    P.curve(-6, 6 + bob, -18, 10 + flap * 2, -16, 0 + flap * 2, shade(skin, 0.8), 2.2)
    P.halo(-16, -2 + flap * 2, 6, 0xffa02b, 0.6)
    P.star(-16, -2 + flap * 2, 4, 3.6 + (frame % 2), 1.6, 0xffe066, ph)
    P.limb([-3, 9 + bob, -5 + flap * 2, 17], shade(skin, 0.7), 3)
    P.limb([3, 9 + bob, 5 - flap * 2, 17], shade(skin, 0.7), 3)
    P.egg(0, 3 + bob, 8.5, 9, skin, 0xffd060, OUTLINE, 2.4)
    P.ellipse(1.5, 5.5 + bob, 4.2, 4.5, 0xff9a4a, 0.85)
    P.limb([5, 1 + bob, 9, -1 + bob, 13, -2 - flap * 2 + bob], skin, 2.6)
    const fire = 5 + Math.abs(Math.sin(ph * 2)) * 2
    P.halo(14, -4 - flap * 2 + bob, fire + 2, 0xffa02b, 0.7)
    P.star(14, -4 - flap * 2 + bob, 5, fire * 0.6, fire * 0.3, 0xff7a1a, ph)
    P.circle(14, -4 - flap * 2 + bob, 2.4, 0xffe066)
    P.ball(3, -9 + bob, 7.5, skin, 0xffd060, OUTLINE, 2.4)
    P.shape([-2, -13 + bob, -6, -23 + bob, 1, -15 + bob], 0x2a0a0a, OUTLINE, 1.2)
    P.shape([6, -14 + bob, 10, -23 + bob, 9.5, -13 + bob], 0x2a0a0a, OUTLINE, 1.2)
    P.slit(4.5, -10 + bob, 1.7, 1.3, 0xffe066)
    P.slit(8.5, -10 + bob, 1.7, 1.3, 0xffe066)
    P.g.moveTo(3, -5.5 + bob).quadraticCurveTo(7, -2.5 + bob, 10, -6 + bob).stroke({ color: P.c(0x2a0a0a), width: 1.5, cap: 'round' })
    P.poly([5, -4.5 + bob, 5.8, -2.8 + bob, 6.6, -4.2 + bob], 0xffffff)
}

function drawWisp(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const bob = Math.sin(ph) * 1.8
    for (let i = 0; i < 4; i++) {
        const t = ((frame / 8) + i * 0.25) % 1
        P.circle(-8 - t * 14, 6 + Math.sin(ph + i) * 2 + t * 3, (4 - t * 2.5), 0xbff3ff, 0.25 * (1 - t))
    }
    P.halo(0, bob, 25, 0x58d8ff, 0.35)
    for (let i = 0; i < 3; i++) {
        const a = ph / 2 + (i * TAU) / 3
        if (Math.sin(a) > 0) continue
        const x = Math.cos(a) * 17
        const y = Math.sin(a) * 8 + bob
        P.shape([x, y - 4, x + 2.2, y, x, y + 4, x - 2.2, y], 0x8fd8f0, 0x2a7fa8, 1.2)
    }
    P.shape([0, -16 + bob, 9.5, bob, 0, 16 + bob, -9.5, bob], 0xa8e8ff, 0x2a7fa8, 2.2)
    P.poly([0, -16 + bob, 9.5, bob, 0, bob], 0xe8fbff, 0.95)
    P.poly([0, -16 + bob, -9.5, bob, 0, bob], 0xc8f2ff, 0.9)
    P.poly([0, 16 + bob, -9.5, bob, 0, bob], 0x6fc0e0, 0.85)
    P.poly([0, 16 + bob, 9.5, bob, 0, bob], 0x8fd8f0, 0.85)
    P.line(-6, bob + 5, 0, 16 + bob, 0xffffff, 1, 0.4)
    P.circle(1.5, -1 + bob, 3.6, 0xffffff)
    P.circle(1.5, -1 + bob, 1.8, 0x58d8ff)
    P.star(-3, -8 + bob, 4, 2.4 + Math.abs(Math.sin(ph)) * 1.2, 0.6, 0xffffff, 0)
    for (let i = 0; i < 3; i++) {
        const a = ph / 2 + (i * TAU) / 3
        if (Math.sin(a) <= 0) continue
        const x = Math.cos(a) * 17
        const y = Math.sin(a) * 8 + bob
        P.shape([x, y - 4.5, x + 2.4, y, x, y + 4.5, x - 2.4, y], 0xe8fbff, 0x2a7fa8, 1.2)
    }
}

function drawBrute(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 2
    const pulse = 0.5 + 0.5 * Math.sin(ph * 2)
    const skin = 0x4b2f66
    const plate = 0x2a2235
    const crack = mix(0xff3fa4, 0xffa0e0, pulse * 0.5)
    P.shadow(0, 40, 34, 7)
    P.limb([-12, 16, -14 + step * 2.5, 28, -15 + step * 4, 38], shade(skin, 0.65), 12)
    P.limb([10, 16, 12 - step * 2.5, 28, 13 - step * 4, 38], shade(skin, 0.8), 12)
    P.oval(-15 + step * 4, 38.5, 7, 3.5, shade(skin, 0.5), OUTLINE, 2)
    P.oval(13 - step * 4, 38.5, 7, 3.5, shade(skin, 0.6), OUTLINE, 2)
    P.limb([-14, -12 + bob, -24 - step * 2, 0, -30 - step * 3, 12], shade(skin, 0.6), 11)
    P.ball(-30 - step * 3, 14, 9, shade(skin, 0.7), crack, OUTLINE, 3)
    P.shape([-26, 20, -32, -10 + bob, -22, -26 + bob, -2, -32 + bob, 18, -26 + bob, 28, -10 + bob, 24, 16, 8, 26, -12, 26], skin, OUTLINE, 3.5)
    P.poly([-26, 18, -31, -9 + bob, -22, -22 + bob, -16, 20], shade(skin, 0.7), 0.85)
    P.ellipse(-4, -12 + bob, 14, 11, shade(skin, 1.3), 0.45)
    P.ellipse(2, 13, 15, 7, shade(skin, 0.8), 0.6)
    P.halo(0, -2 + bob, 16, 0xff3fa4, 0.18 + pulse * 0.15)
    P.path([-14, -18 + bob, -6, -8 + bob, -10, 2, -2, 10], crack, 2.8)
    P.path([10, -20 + bob, 6, -10 + bob, 12, -2], crack, 2.3)
    P.path([-20, 6, -12, 12], crack, 2)
    P.path([-14, -18 + bob, -6, -8 + bob, -10, 2, -2, 10], 0xffffff, 0.9, 0.5 * pulse)
    P.arc(0, -2 + bob, 26, 0.1, 1.2, 0xff7ad0, 2, 0.5)
    P.shape([-30, -14 + bob, -26, -34 + bob, -16, -28 + bob, -8, -34 + bob, -6, -22 + bob, -18, -16 + bob], plate, OUTLINE, 2.5)
    P.poly([-28, -16 + bob, -25, -30 + bob, -18, -26 + bob, -18, -18 + bob], shade(plate, 1.5), 0.6)
    P.shape([-24, -32 + bob, -26, -44 + bob, -19, -31 + bob], 0xe9e4d4, OUTLINE, 1.8)
    P.shape([-12, -32 + bob, -11, -44 + bob, -7, -32 + bob], 0xe9e4d4, OUTLINE, 1.8)
    P.shape([6, -30 + bob, 14, -42 + bob, 22, -30 + bob, 30, -34 + bob, 28, -24 + bob, 12, -22 + bob], plate, OUTLINE, 2.5)
    P.shape([14, -36 + bob, 16, -48 + bob, 20, -35 + bob], 0xe9e4d4, OUTLINE, 1.8)
    P.shape([24, -32 + bob, 30, -44 + bob, 29, -29 + bob], 0xe9e4d4, OUTLINE, 1.8)
    P.ball(17, -22 + bob, 10, shade(skin, 1.1), crack, OUTLINE, 3)
    P.slit(19, -24 + bob, 2.6, 1.6, 0xff3fa4)
    P.slit(24, -23 + bob, 2.1, 1.4, 0xff3fa4)
    P.shape([18, -16 + bob, 20, -10 + bob, 22, -16 + bob], 0xe9e4d4, OUTLINE, 1.2)
    P.shape([23, -16 + bob, 25, -11 + bob, 26, -16 + bob], 0xe9e4d4, OUTLINE, 1.2)
    P.limb([16, -12 + bob, 26 + step * 2, -2, 32 + step * 3, 8], skin, 12)
    P.ball(33 + step * 3, 11, 11, shade(skin, 1.08), crack, OUTLINE, 3)
    P.path([28 + step * 3, 6, 34 + step * 3, 4, 38 + step * 3, 8], OUTLINE, 1.6)
}

function drawMimic(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const open = [0, 1.5, 5, 9, 5, 1.5][frame] ?? 0
    const wood = 0x8a5a2b
    const gold = 0xf5c451
    P.shadow(0, 19, 22, 4, 0.3)
    if (open > 0) {
        P.poly([-18, -4, 18, -4 - open, 18, -2, -18, -2], 0x1a0606)
        P.halo(0, -4 - open / 2, 14, 0xff2d2d, 0.12 + open * 0.02)
    }
    P.rect(-19, -4, 38, 22, OUTLINE, 4)
    P.rect(-17.5, -2.5, 35, 19, shade(wood, 0.8), 3)
    P.rect(-17.5, -2.5, 35, 12, wood, 3)
    P.line(-17, 4, 17, 4, shade(wood, 0.65), 1.2)
    P.line(-17, 10, 17, 10, shade(wood, 0.65), 1.2)
    P.rect(-14, -3, 4, 21, gold, 1)
    P.rect(10, -3, 4, 21, gold, 1)
    P.rect(-13.5, -3, 1.2, 21, 0xfff0b0, 0.5, 0.7)
    P.rect(-4, -2, 8, 7, gold, 1.5)
    P.circle(0, 1, 1.4, 0x2a1a08)
    P.line(0, 1, 0, 3.5, 0x2a1a08, 1.2)
    if (open > 1) {
        for (let i = 0; i < 7; i++) {
            const x = -16 + i * 5.3
            const top = -4 - (open * (x + 18)) / 36
            P.poly([x, -3.5, x + 2.6, -3.5, x + 1.3, -3.5 - Math.min(4, open)], 0xf1ead8)
            P.poly([x + 1, top, x + 3.6, top, x + 2.3, top + Math.min(4, open * 0.8)], 0xf1ead8)
        }
    }
    if (open > 4) {
        P.eye(-6, -4 - open * 0.45, 1.8, 0xff2d2d)
        P.eye(6, -4 - open * 0.55, 1.8, 0xff2d2d)
        P.g.moveTo(4, -4).quadraticCurveTo(14, 0, 18, 8).stroke({ color: P.c(0xd84a6a), width: 3.5, cap: 'round' })
    }
    const lift = open
    P.shape([-19, -4, -19, -12, -14, -17 - lift * 0.4, 14, -17 - lift * 0.9, 19, -12 - lift, 19, -4 - lift], shade(wood, 1.1), OUTLINE, 2.5)
    P.line(-17, -9, 17, -9 - lift * 0.9, shade(wood, 0.75), 1.2)
    P.poly([-14, -16, -10, -16, -10, -4, -14, -4], gold)
    P.poly([10, -16 - lift * 0.8, 14, -16 - lift * 0.9, 14, -4 - lift * 0.95, 10, -4 - lift * 0.85], gold)
    P.ellipse(-6, -13.5, 7, 1.6, shade(wood, 1.55), 0.6)
    P.star(16, -14 - lift, 4, 3, 1, 0xffffff, 0, (frame % 3 === 0) ? 0.9 : 0.2)
}

function drawMite(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const tail = [13, 10, 12, 9][frame] ?? 11
    const flick = frame % 2 === 0 ? 1 : -1
    P.poly([-6, -3.5, -6 - tail, flick * 1.5, -6, 3.5], 0xff3fa4, 0.45)
    P.poly([-6, -2, -6 - tail * 0.6, flick, -6, 2], 0xffd0ec, 0.6)
    P.halo(0, 0, 12, 0xff3fa4, 0.3)
    P.shape([12, 0, -7, -7.5, -3, 0, -7, 7.5], 0xd8287f, OUTLINE, 2)
    P.poly([12, 0, -6, -6.5, -3, 0], 0xff5ab4)
    P.poly([12, 0, -3, -3, -1, 0], 0xffb0dc)
    P.eye(3, 0, 2, 0xffe0f4)
}

function drawGazer(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const blink = frame === 5
    const bob = Math.sin(ph) * 1.5
    const look = Math.sin(ph * 0.5)
    for (let i = 0; i < 6; i++) {
        const x0 = -11 + i * 4.4
        const sw = Math.sin(ph + i * 1.2) * 4.5
        P.curve(x0, 12 + bob, x0 + sw, 21, x0 - sw * 0.6, 30, i % 2 ? 0x6a3a7a : 0x7e4a90, 2.4)
    }
    P.halo(0, bob, 29, 0xff2d55, 0.15)
    P.ball(0, bob, 18, 0xf0e6ff, 0xff7a9a, OUTLINE, 3)
    P.path([-16, 4 + bob, -10, 3 + bob, -7, 6 + bob], 0xd23a5a, 1.2)
    P.path([-14, -8 + bob, -9, -6 + bob, -6, -8 + bob], 0xd23a5a, 1.2)
    P.path([-6, 14 + bob, -4, 9 + bob, 0, 9 + bob], 0xd23a5a, 1.2)
    P.path([8, 13 + bob, 6, 10 + bob, 9, 8 + bob], 0xd23a5a, 1)
    if (blink) {
        P.oval(0, bob, 18, 18, 0x6a3a7a, OUTLINE, 3)
        P.path([-16, 1 + bob, 0, 4 + bob, 16, 1 + bob], OUTLINE, 2)
        return
    }
    const ix = 5 + look * 2
    const iy = bob + Math.cos(ph * 0.5) * 1.5
    P.halo(ix, iy, 12, 0xff2d55, 0.4)
    P.disc(ix, iy, 8.5, 0xff2d55, OUTLINE, 1.8)
    P.ring(ix, iy, 6, 0xffa0b4, 1.2, 0.7)
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU
        P.line(ix + Math.cos(a) * 3, iy + Math.sin(a) * 3, ix + Math.cos(a) * 7, iy + Math.sin(a) * 7, 0xb01a3a, 0.8, 0.7)
    }
    P.ellipse(ix + 1, iy, 2.2, 6, 0x14040a)
    P.circle(ix - 2, iy - 3, 1.9, 0xffffff)
    P.g.moveTo(-17, -6 + bob).quadraticCurveTo(0, -24 + bob, 17, -6 + bob).quadraticCurveTo(0, -15 + bob, -17, -6 + bob).fill({ color: P.c(0x6a3a7a) }).stroke({ color: P.c(OUTLINE), width: 2 })
    P.g.moveTo(-12, -10 + bob).quadraticCurveTo(0, -20 + bob, 12, -10 + bob).stroke({ color: P.c(0x9a6aaa), width: 1.2, alpha: 0.8 })
}

function drawSpider(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const leg = 0x1e1630
    const pulse = 0.5 + 0.5 * Math.sin(ph)
    for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
            const bx = -4 + i * 4
            const sw = Math.sin(ph + i * Math.PI * 0.5 + (s > 0 ? Math.PI : 0)) * 3.2
            const lift = Math.max(0, Math.cos(ph + i * Math.PI * 0.5 + (s > 0 ? Math.PI : 0))) * 2.5
            const kx = bx + (i - 1.5) * 5 + sw
            const tx = bx + (i - 1.5) * 9 + sw * 1.6
            P.path([bx, s * 4, kx, s * (16 + lift), tx, s * 23], OUTLINE, 4.2)
            P.path([bx, s * 4, kx, s * (16 + lift), tx, s * 23], s < 0 ? shade(leg, 1.6) : leg, 2.2)
            P.circle(kx, s * (16 + lift), 1.2, 0x463566)
        }
    }
    P.egg(-9, 0, 12, 10, 0x2a1f3d, 0xb06bff, OUTLINE, 2.5)
    P.halo(-9, 0, 9, 0x7dff6a, 0.15 + pulse * 0.2)
    P.poly([-15, -4.5, -9, 0, -15, 4.5], mix(0xb06bff, 0x7dff6a, pulse * 0.4))
    P.poly([-3.5, -4.5, -9, 0, -3.5, 4.5], mix(0xb06bff, 0x7dff6a, pulse * 0.4))
    P.circle(-9, 0, 1.6, 0xffffff, 0.6)
    P.ball(6, 0, 7.5, 0x3a2a52, 0x9a7aff, OUTLINE, 2.2)
    P.line(12, -3, 16.5, -1 + Math.sin(ph * 2) * 0.8, 0x6a5a8a, 2)
    P.line(12, 3, 16.5, 1 - Math.sin(ph * 2) * 0.8, 0x6a5a8a, 2)
    for (const [x, y, r] of [[9, -3, 1.5], [9, 3, 1.5], [11, -1.2, 1.2], [11, 1.2, 1.2], [6.5, -4.5, 1], [6.5, 4.5, 1]] as const) P.eye(x, y, r, 0x7dff6a)
}

function drawSkull(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const lens = [16, 20, 15, 19, 14, 18]
    const L = lens[frame] ?? 16
    const fl = Math.sin(ph) * 3
    P.halo(-2, 0, 21, 0xff6a2b, 0.32)
    P.poly([-2, -10, -2 - L, -7 + fl, -9, -2, -2 - L * 1.15, 1 - fl * 0.5, -8, 3, -2 - L, 7 + fl, -2, 10], 0xd8361a, 0.85)
    P.poly([-2, -7, -2 - L * 0.75, -3 + fl * 0.6, -7, 0, -2 - L * 0.8, 4 - fl * 0.6, -2, 7], 0xff8a2b, 0.9)
    P.poly([0, -4, -L * 0.5, fl * 0.3, 0, 4], 0xffe066, 0.9)
    P.ball(4, -1, 10, 0xf1ead8, 0xffa040, OUTLINE, 2.4)
    P.rect(2, 5, 10, 6, 0xe0d8c2, 2)
    P.g.roundRect(2, 5, 10, 6, 2).stroke({ color: P.c(OUTLINE), width: 1.8 })
    P.line(5, 6, 5, 10, OUTLINE, 1)
    P.line(8, 6, 8, 10, OUTLINE, 1)
    P.path([0, -9, 2, -6, 1, -4], shade(0xf1ead8, 0.6), 1)
    P.ellipse(8, -2, 3.1, 3.4, 0x14040a)
    P.ellipse(2, -2, 2.7, 3.1, 0x14040a)
    P.eye(8, -2, 1.6, 0xffb02b)
    P.eye(2, -2, 1.4, 0xffb02b)
    P.poly([11, 2, 13, 4, 10.5, 4], 0x14040a)
}

function drawKnight(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 1.4
    const plate = 0x2a2d3a
    const rim = 0xb06bff
    const cw = Math.sin(ph + 1) * 3.5
    P.shape([-8, -12 + bob, -22, 4 + cw, -20, 12, -25, 20 + cw, -14, 18, -10, 26 + cw, -4, 18, 0, -8 + bob], 0x3a1530, OUTLINE, 2.2)
    P.poly([-8, -10 + bob, -18, 6 + cw, -14, 14, -6, 0], 0x5a2048, 0.7)
    P.limb([-5, 10, -7 + step * 2, 18, -8 + step * 4, 27], shade(plate, 1.1), 6)
    P.limb([4, 10, 5 - step * 2, 18, 6 - step * 4, 27], shade(plate, 1.3), 6)
    P.shape([-11, -10 + bob, -12, 10, -4, 14, 8, 12, 11, -8 + bob, 2, -14 + bob], plate, OUTLINE, 3)
    P.poly([-10, -8 + bob, -11, 8, -6, 10, -5, -10 + bob], shade(plate, 0.7), 0.9)
    P.path([-11, -8 + bob, -2, -12 + bob, 9, -8 + bob], rim, 1.6, 0.8)
    P.path([-6, 0, 6, -1], shade(plate, 1.6), 1.4)
    P.arc(0, 0, 11, 0.1, 1.2, rim, 1.4, 0.6)
    P.shape([-14, -14 + bob, -8, -18 + bob, 0, -14 + bob, -6, -6 + bob], shade(plate, 1.3), OUTLINE, 2)
    P.curve(-6, -24 + bob, -12, -30 + bob, -10, -38 + bob, 0xd8d0e8, 2.6)
    P.curve(4, -24 + bob, 10, -30 + bob, 8, -38 + bob, 0xd8d0e8, 2.6)
    P.ball(0, -20 + bob, 9, shade(plate, 1.25), rim, OUTLINE, 2.5)
    P.rect(0, -21.5 + bob, 9, 3, 0x05050a, 1)
    P.halo(5, -20 + bob, 6, rim, 0.6)
    P.line(1, -20 + bob, 9, -20 + bob, 0xe0c0ff, 1.6)
    P.limb([6, -2 + bob, 10, -3, 14, -4], shade(plate, 1.3), 4.5)
    P.halo(24, -18, 13, rim, 0.25 + 0.1 * Math.abs(step))
    P.g.poly([13, -5, 16, -9, 34, -33, 29, -30]).fill({ color: P.c(0xc8cfe0) }).stroke({ color: P.c(OUTLINE), width: 2 })
    P.line(16, -8, 31, -30, rim, 1.3, 0.9)
    P.line(14.5, -7, 30, -31, 0xffffff, 0.7, 0.8)
    P.line(9, -9, 18, -1, OUTLINE, 5)
    P.line(9, -9, 18, -1, 0xd8b45a, 3)
    P.circle(12, -3, 2, 0xd8b45a)
}

function drawGolem(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const step = Math.sin(ph)
    const bob = Math.abs(Math.cos(ph)) * 1.6
    const glow = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(ph))
    const rock = 0x3c4a66
    const crystal = 0x7ff0ff
    P.shadow(0, 33, 28, 6)
    P.shape([-14, 14, -18 + step * 3, 32, -6 + step * 3, 32, -6, 16], shade(rock, 0.7), OUTLINE, 2.5)
    for (const [x, y, h, a] of [[-14, -18, 18, -0.5], [-4, -24, 22, -0.1], [8, -20, 16, 0.4], [-20, -4, 14, -1.1]] as const) {
        const tx = x + Math.sin(a) * h
        const ty = y - Math.cos(a) * h + bob * 0.5 - bob
        P.halo(tx, ty, 7, crystal, glow * 0.6)
        P.shape([x - 4, y - bob, tx, ty, x + 4, y + 1 - bob], 0x4ac8e0, 0x1a5a70, 2)
        P.poly([x - 1, y - bob, tx, ty, x + 2.5, y - bob], 0xe0ffff, 0.85)
    }
    P.shape([-24, 8, -26, -10 - bob, -16, -22 - bob, 2, -26 - bob, 18, -18 - bob, 24, -2 - bob, 18, 16, 0, 20, -16, 18], rock, OUTLINE, 3.2)
    P.poly([-16, -18 - bob, 0, -22 - bob, -4, -8 - bob, -18, -6 - bob], shade(rock, 1.4), 0.8)
    P.poly([4, -6 - bob, 18, -14 - bob, 20, 2, 8, 6], shade(rock, 0.75), 0.8)
    P.poly([-24, 6, -25, -6, -16, 0, -14, 16], shade(rock, 0.65), 0.8)
    P.path([-12, 4, -4, 0, 2, 8], 0x1a2236, 1.8)
    P.path([6, -12 - bob, 10, -4, 8, 2], 0x1a2236, 1.4)
    P.halo(-4, 6, 9, crystal, glow * 0.9)
    P.poly([-7.5, 6, -4, 1.5, -0.5, 6, -4, 10.5], crystal)
    P.poly([-6, 6, -4, 3, -2.5, 6], 0xffffff, 0.8)
    P.shape([6, 14, 6 - step * 3, 32, 18 - step * 3, 32, 14, 16], shade(rock, 0.85), OUTLINE, 2.5)
    P.shape([22, -10 - bob, 32 + step * 2, 0, 30 + step * 2, 14, 20, 10], shade(rock, 0.95), OUTLINE, 2.8)
    P.shape([-24, -4 - bob, -34 - step * 2, 6, -30 - step * 2, 18, -20, 12], shade(rock, 0.8), OUTLINE, 2.8)
    P.egg(14, -24 - bob, 9, 7, shade(rock, 1.1), crystal, OUTLINE, 2.5)
    P.slit(18, -24 - bob, 2.8, 1.8, crystal)
}

// ─── Behaviours ──────────────────────────────────────────────────────────

const seed = (e: Enemy) => {
    e.ai.seed = rand(0, TAU)
}

function batUpdate(e: Enemy, g: GameApi, dt: number): void {
    const s = num(e, 'seed')
    chaseWobble(e, g, dt, 1, Math.sin(e.age * 7 + s) * e.speed * 0.6)
}

function slimeUpdate(e: Enemy, g: GameApi, dt: number): void {
    const hop = Math.max(0, Math.sin(e.age * 5 + num(e, 'seed')))
    g.chase(e, dt, 0.25 + hop * 1.5)
}

function slimeDeath(e: Enemy, g: GameApi): void {
    g.particles(e.x, e.y, { count: 16, color: 0x2fd6b0, speed: 180, life: 0.5, size: 5 })
    const n = e.elite ? 5 : 3
    const off = rand(0, TAU)
    for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU
        summon(g, 'slimeling', e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, hpMulOf(e))
    }
}

function chargerUpdate(e: Enemy, g: GameApi, dt: number): void {
    const st = e.ai.st ?? 'approach'
    if (st === 'stampede') {
        move(e, g, num(e, 'dx') * e.speed * 3, num(e, 'dy') * e.speed * 3, dt)
        if (tick(e, 't', dt) <= 0) e.ai.st = 'recover'
        return
    }
    if (st === 'approach') {
        g.chase(e, dt)
        const a = aim(e, g)
        if (tick(e, 'cd', dt) <= 0 && a.dist < 360 && e.stunT <= 0) {
            const target = lead(g, 0.25)
            const dx = target.x - e.x
            const dy = target.y - e.y
            const d = Math.hypot(dx, dy) || 1
            e.ai.dx = dx / d
            e.ai.dy = dy / d
            e.ai.st = 'wind'
            e.ai.t = 0.7
            g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + (dx / d) * 560, y2: e.y + (dy / d) * 560, width: e.radius * 2, delay: 0.7, damage: 0, color: 0xff5a2b })
        }
        return
    }
    if (st === 'wind') {
        e.scale = 1 + Math.sin(e.age * 50) * 0.06
        e.facing = num(e, 'dx') < 0 ? -1 : 1
        if (tick(e, 't', dt) <= 0) {
            e.scale = 1
            e.ai.st = 'lunge'
            e.ai.t = 0.5
        }
        return
    }
    if (st === 'lunge') {
        move(e, g, num(e, 'dx') * 560, num(e, 'dy') * 560, dt)
        if (tick(e, 't', dt) <= 0) {
            e.ai.st = 'recover'
            e.ai.t = 0.6
        }
        return
    }
    g.chase(e, dt, 0.35)
    if (tick(e, 't', dt) <= 0) {
        e.ai.st = 'approach'
        e.ai.cd = rand(1.8, 2.8)
    }
}

function archerUpdate(e: Enemy, g: GameApi, dt: number): void {
    kite(e, g, dt, 230, 360, 0.55)
    if (tick(e, 'cd', dt) > 0 || e.stunT > 0) return
    const a = aim(e, g)
    if (a.dist > 560) {
        e.ai.cd = 0.5
        return
    }
    e.ai.cd = rand(2.2, 2.9)
    const t = lead(g, a.dist / 380 * 0.6)
    const ang = Math.atan2(t.y - e.y, t.x - e.x)
    shoot(g, e.x + Math.cos(ang) * 18, e.y + Math.sin(ang) * 18, ang, { speed: 380, damage: e.damage, color: 0xe9e4d4, radius: 6, kind: 'arrow', life: 2.6 })
    if (e.elite) {
        shoot(g, e.x, e.y, ang - 0.25, { speed: 380, damage: e.damage, color: 0xe9e4d4, radius: 6, kind: 'arrow', life: 2.6 })
        shoot(g, e.x, e.y, ang + 0.25, { speed: 380, damage: e.damage, color: 0xe9e4d4, radius: 6, kind: 'arrow', life: 2.6 })
    }
    if (onScreen(e, g)) g.sfx.play('arrow', { volume: 0.25, pitch: 0.8, pan: panOf(e, g) })
}

function bomberBlast(e: Enemy, g: GameApi, radius: number, delay: number): void {
    const x = e.x
    const y = e.y
    const dmg = e.damage * 2.2
    g.telegraphCircle({ x, y, radius, delay, damage: dmg, color: 0xff7a1a })
    if (onScreen(e, g, 100)) g.sfx.play('telegraph', { volume: 0.35, pitch: 1.3, pan: panOf(e, g) })
    later(delay, gg => {
        gg.particles(x, y, { count: 26, color: 0xff7a1a, speed: 320, life: 0.55, size: 6 })
        gg.particles(x, y, { count: 12, color: 0xffe066, speed: 160, life: 0.4, size: 4 })
        gg.particles(x, y, { count: 8, color: 0x2b2b38, speed: 120, life: 0.8, size: 7 })
        const near = Math.hypot(gg.player.x - x, gg.player.y - y) < gg.view.width
        if (near) {
            gg.shake(0.18)
            gg.sfx.play('explosion', { volume: 0.55, pan: Math.max(-1, Math.min(1, (x - gg.player.x) / (gg.view.width / 2))) })
        }
    })
}

function bomberUpdate(e: Enemy, g: GameApi, dt: number): void {
    if (flag(e, 'fuse')) {
        const t = tick(e, 't', dt)
        e.scale = 1 + (0.9 - t) * 0.35 + Math.sin(e.age * 40) * 0.05
        if (t <= 0) {
            e.ai.blown = true
            e.dead = true
        }
        return
    }
    g.chase(e, dt, 1.1)
    if (e.stunT <= 0 && aim(e, g).dist < e.radius + g.player.radius + 55) {
        e.ai.fuse = true
        e.ai.t = 0.9
        bomberBlast(e, g, 95, 0.9)
    }
}

function bomberDeath(e: Enemy, g: GameApi): void {
    if (flag(e, 'fuse')) return
    bomberBlast(e, g, 75, 0.55)
}

function ghostUpdate(e: Enemy, g: GameApi, dt: number): void {
    const cycle = (e.age + num(e, 'seed')) % 4
    const phased = cycle > 2.7
    e.untargetable = phased
    e.alpha = phased ? 0.28 : 0.92
    chaseWobble(e, g, dt, phased ? 1.6 : 0.9, Math.sin(e.age * 2.5 + num(e, 'seed')) * 40)
}

function cultistUpdate(e: Enemy, g: GameApi, dt: number): void {
    if (flag(e, 'channel')) {
        const t = tick(e, 't', dt)
        if (chance(dt * 30)) g.particles(e.x + 15 * e.facing, e.y - 24, { count: 2, color: 0xff3fa4, speed: 80, life: 0.5, size: 3 })
        e.scale = 1 + (1 - t) * 0.12
        if (t <= 0) {
            e.ai.channel = false
            e.scale = 1
            if (g.enemyCount < 330) {
                const pool = g.time < 360 ? ['bat', 'bat', 'ghoul'] : g.time < 600 ? ['ghoul', 'spider', 'skull'] : ['skull', 'spider', 'imp']
                const n = e.elite ? 5 : 3
                for (let i = 0; i < n; i++) {
                    const a = (i / n) * TAU + rand(0, 1)
                    const x = e.x + Math.cos(a) * 34
                    const y = e.y + Math.sin(a) * 34
                    summon(g, pick(pool), x, y, hpMulOf(e))
                    g.particles(x, y, { count: 8, color: 0xb06bff, speed: 120, life: 0.4, size: 4 })
                }
                if (onScreen(e, g)) g.sfx.play('summon', { volume: 0.4, pan: panOf(e, g) })
            }
        }
        return
    }
    kite(e, g, dt, 280, 420, 0.35)
    if (tick(e, 'cd', dt) <= 0 && e.stunT <= 0 && onScreen(e, g, 120)) {
        e.ai.cd = rand(6, 8)
        e.ai.channel = true
        e.ai.t = 1
    }
}

function wormInit(e: Enemy): void {
    seed(e)
    e.ai.st = 'under'
    e.ai.t = rand(2.5, 3.5)
    e.untargetable = true
    e.alpha = 0.25
}

function wormUpdate(e: Enemy, g: GameApi, dt: number): void {
    const st = e.ai.st
    const t = tick(e, 't', dt)
    if (st === 'under') {
        e.untargetable = true
        e.alpha = 0.22
        e.scale = 0.7
        g.chase(e, dt, 2.1)
        if (chance(dt * 12)) g.particles(e.x, e.y + 10, { count: 2, color: 0x6a4a2a, speed: 70, life: 0.4, size: 4 })
        if (t <= 0 || aim(e, g).dist < 60) {
            e.ai.st = 'rise'
            e.ai.t = 0.65
            g.telegraphCircle({ x: e.x, y: e.y, radius: 70, delay: 0.65, damage: e.damage * 1.5, color: 0xd88a4a })
        }
        return
    }
    if (st === 'rise') {
        e.scale = 0.7 + (0.65 - Math.max(0, t)) * 0.5
        if (t <= 0) {
            e.ai.st = 'up'
            e.ai.t = rand(3, 4)
            e.untargetable = false
            e.alpha = 1
            e.scale = 1
            g.particles(e.x, e.y, { count: 18, color: 0x8a5a2b, speed: 220, life: 0.6, size: 5 })
            if (onScreen(e, g)) g.shake(0.08)
        }
        return
    }
    e.untargetable = false
    e.alpha = 1
    g.chase(e, dt, 0.55)
    if (t <= 0) {
        e.ai.st = 'under'
        e.ai.t = rand(2.2, 3.2)
        g.particles(e.x, e.y, { count: 12, color: 0x6a4a2a, speed: 140, life: 0.5, size: 4 })
    }
}

function droneUpdate(e: Enemy, g: GameApi, dt: number): void {
    const a = aim(e, g)
    if (flag(e, 'dive')) {
        move(e, g, num(e, 'dx') * e.speed * 2.4, num(e, 'dy') * e.speed * 2.4, dt)
        if (tick(e, 't', dt) <= 0) {
            e.ai.dive = false
            e.ai.cd = rand(3, 4.5)
        }
        return
    }
    if (a.dist > 420) {
        g.chase(e, dt)
        return
    }
    const dir = num(e, 'dir', 0) || (chance(0.5) ? 1 : -1)
    e.ai.dir = dir
    const radial = Math.max(-1, Math.min(1, (a.dist - 170) / 80))
    move(e, g, (a.nx * radial + -a.ny * dir) * e.speed, (a.ny * radial + a.nx * dir) * e.speed, dt)
    if (tick(e, 'cd', dt) <= 0 && e.stunT <= 0) {
        e.ai.dive = true
        e.ai.t = 0.55
        e.ai.dx = a.nx
        e.ai.dy = a.ny
        g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + a.nx * 420, y2: e.y + a.ny * 420, width: 24, delay: 0.25, damage: 0, color: 0xff4040 })
    }
}

function impUpdate(e: Enemy, g: GameApi, dt: number): void {
    chaseWobble(e, g, dt, 1, Math.sin(e.age * 9 + num(e, 'seed')) * 70)
    if (e.stunT > 0 || !onScreen(e, g, 60)) return
    if (tick(e, 'flame', dt) <= 0) {
        e.ai.flame = rand(1.1, 1.6)
        g.telegraphCircle({ x: e.x, y: e.y, radius: 28, delay: 0.5, damage: e.damage * 0.5, color: 0xff6a1a })
    }
    if (tick(e, 'cd', dt) <= 0) {
        e.ai.cd = rand(3.5, 5)
        const a = aim(e, g)
        if (a.dist > 140 && a.dist < 420) {
            shoot(g, e.x, e.y, a.angle, { speed: 260, damage: e.damage, color: 0xff7a1a, radius: 8, kind: 'fire', life: 2.5 })
            g.sfx.play('fire', { volume: 0.2, pitch: 1.4, pan: panOf(e, g) })
        }
    }
}

function wispUpdate(e: Enemy, g: GameApi, dt: number): void {
    kite(e, g, dt, 180, 300, 0.7)
    if (tick(e, 'cd', dt) > 0 || e.stunT > 0) return
    e.ai.cd = rand(4, 5)
    if (aim(e, g).dist > 460) return
    const n = e.elite ? 12 : 8
    ring(g, e.x, e.y, n, rand(0, TAU), { speed: 125, damage: e.damage, color: 0x8fe8ff, radius: 7, life: 4.5, kind: 'orb' })
    g.sfx.play('frost', { volume: 0.22, pan: panOf(e, g) })
}

function bruteUpdate(e: Enemy, g: GameApi, dt: number): void {
    if (flag(e, 'slam')) {
        const t = tick(e, 't', dt)
        e.scale = 1 + Math.max(0, 0.9 - t) * 0.12
        if (t <= 0) {
            e.ai.slam = false
            e.scale = 1
            e.ai.cd = rand(3.5, 5)
        }
        return
    }
    g.chase(e, dt)
    if (tick(e, 'cd', dt) <= 0 && e.stunT <= 0 && aim(e, g).dist < 190) {
        e.ai.slam = true
        e.ai.t = 0.9
        const x = e.x
        const y = e.y
        g.telegraphCircle({ x, y, radius: 135, delay: 0.9, damage: e.damage * 1.5, color: 0xff3fa4 })
        g.sfx.play('telegraph', { volume: 0.35, pitch: 0.7, pan: panOf(e, g) })
        later(0.9, gg => {
            gg.shake(0.3)
            gg.particles(x, y, { count: 30, color: 0x8a5a9a, speed: 300, life: 0.5, size: 6 })
            gg.particles(x, y, { count: 16, color: 0xff3fa4, speed: 200, life: 0.5, size: 4 })
            gg.sfx.play('shootHeavy', { volume: 0.5, pitch: 0.6 })
        })
    }
}

function mimicUpdate(e: Enemy, g: GameApi, dt: number): void {
    if (!flag(e, 'awake')) {
        const a = aim(e, g)
        if (a.dist < 210 || e.hp < e.maxHp) {
            e.ai.awake = true
            e.scale = 1.25
            g.particles(e.x, e.y, { count: 20, color: 0xf5c451, speed: 220, life: 0.5, size: 4 })
            g.sfx.play('spawnElite', { volume: 0.5, pitch: 1.3, pan: panOf(e, g) })
        }
        return
    }
    if (e.scale > 1) e.scale = Math.max(1, e.scale - dt)
    chaseWobble(e, g, dt, 1.9, Math.sin(e.age * 6) * 50)
}

function mimicDeath(e: Enemy, g: GameApi): void {
    g.particles(e.x, e.y, { count: 30, color: 0xf5c451, speed: 260, life: 0.7, size: 5 })
    g.particles(e.x, e.y, { count: 12, color: 0x8a5a2b, speed: 160, life: 0.6, size: 6 })
    g.sfx.play('coin', { volume: 0.6, pan: panOf(e, g) })
}

function miteUpdate(e: Enemy, g: GameApi, dt: number): void {
    let h = num(e, 'h', NaN)
    if (Number.isNaN(h)) h = aim(e, g).angle
    const target = aim(e, g).angle
    let d = target - h
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    const turn = (flag(e, 'stream') ? 0.35 : 2.6) * dt
    h += Math.max(-turn, Math.min(turn, d))
    e.ai.h = h
    move(e, g, Math.cos(h) * e.speed, Math.sin(h) * e.speed, dt)
    if (flag(e, 'stream') && e.age > 9) e.ai.stream = false
}

function gazerUpdate(e: Enemy, g: GameApi, dt: number): void {
    if (flag(e, 'charge')) {
        if (tick(e, 't', dt) <= 0) {
            e.ai.charge = false
            e.ai.cd = rand(3.2, 4.4)
        }
        return
    }
    kite(e, g, dt, 260, 400, 0.4)
    if (tick(e, 'cd', dt) > 0 || e.stunT > 0) return
    const a = aim(e, g)
    if (a.dist > 600) {
        e.ai.cd = 0.5
        return
    }
    e.ai.charge = true
    e.ai.t = 1.1
    const len = 1000
    g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + a.nx * len, y2: e.y + a.ny * len, width: 26, delay: 1, damage: e.damage * 1.6, color: 0xff2d55 })
    g.sfx.play('telegraph', { volume: 0.3, pitch: 1.6, pan: panOf(e, g) })
    later(1, gg => gg.sfx.play('laser', { volume: 0.3 }))
}

function spiderUpdate(e: Enemy, g: GameApi, dt: number): void {
    const t = tick(e, 't', dt)
    if (flag(e, 'pause')) {
        if (t <= 0) {
            e.ai.pause = false
            e.ai.t = rand(0.3, 0.45)
            const a = aim(e, g)
            const off = (chance(0.5) ? 1 : -1) * rand(0.4, 0.8)
            e.ai.dx = Math.cos(a.angle + off)
            e.ai.dy = Math.sin(a.angle + off)
        }
        return
    }
    if (t <= 0) {
        e.ai.pause = true
        e.ai.t = rand(0.1, 0.22)
        return
    }
    if (aim(e, g).dist > 500) {
        g.chase(e, dt, 1)
        return
    }
    move(e, g, num(e, 'dx') * e.speed, num(e, 'dy') * e.speed, dt)
}

function skullUpdate(e: Enemy, g: GameApi, dt: number): void {
    let h = num(e, 'h', NaN)
    if (Number.isNaN(h)) h = aim(e, g).angle
    let d = aim(e, g).angle - h
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    const turn = 2.4 * dt
    h += Math.max(-turn, Math.min(turn, d))
    e.ai.h = h
    move(e, g, Math.cos(h) * e.speed, Math.sin(h) * e.speed, dt)
}

function knightUpdate(e: Enemy, g: GameApi, dt: number): void {
    const st = e.ai.st ?? 'walk'
    if (st === 'wind') {
        e.scale = 1.08
        if (tick(e, 't', dt) <= 0) {
            e.ai.st = 'dash'
            e.ai.t = 0.3
            e.scale = 1
        }
        return
    }
    if (st === 'dash') {
        move(e, g, num(e, 'dx') * e.speed * 4.2, num(e, 'dy') * e.speed * 4.2, dt)
        if (chance(dt * 40)) g.particles(e.x, e.y, { count: 1, color: 0xb06bff, speed: 30, life: 0.3, size: 5 })
        if (tick(e, 't', dt) <= 0) {
            e.ai.st = 'walk'
            e.ai.cd = rand(2.6, 3.6)
        }
        return
    }
    g.chase(e, dt)
    const a = aim(e, g)
    if (tick(e, 'cd', dt) <= 0 && a.dist < 320 && a.dist > 80 && e.stunT <= 0) {
        e.ai.st = 'wind'
        e.ai.t = 0.35
        e.ai.dx = a.nx
        e.ai.dy = a.ny
        g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + a.nx * 340, y2: e.y + a.ny * 340, width: 34, delay: 0.35, damage: 0, color: 0xb06bff })
    }
}

function golemDeath(e: Enemy, g: GameApi): void {
    ring(g, e.x, e.y, e.elite ? 16 : 10, rand(0, TAU), { speed: 190, damage: e.damage * 0.5, color: 0x7ff0ff, radius: 7, kind: 'spike', life: 3 })
    g.particles(e.x, e.y, { count: 24, color: 0x7ff0ff, speed: 260, life: 0.6, size: 5 })
    g.particles(e.x, e.y, { count: 14, color: 0x3c4a66, speed: 180, life: 0.7, size: 7 })
    g.sfx.play('frost', { volume: 0.4, pitch: 0.8, pan: panOf(e, g) })
}

// ─── Roster ──────────────────────────────────────────────────────────────

export const REGULAR_DEFS: Record<string, EnemyDef> = {
    bat: {
        id: 'bat', name: 'Rift Bat', hp: 5, speed: 128, damage: 5, radius: 11, xp: 1, mass: 0.6,
        size: 52, frames: 8, frameRate: 16, glow: 0x9b3dff,
        draw: drawBat, init: seed, update: batUpdate
    },
    ghoul: {
        id: 'ghoul', name: 'Ghoul', hp: 11, speed: 62, damage: 8, radius: 15, xp: 1,
        size: 56, frames: 8, frameRate: 10,
        draw: drawGhoul
    },
    slime: {
        id: 'slime', name: 'Rift Slime', hp: 26, speed: 72, damage: 8, radius: 18, xp: 2,
        size: 60, frames: 8, frameRate: 9, glow: 0x2fd6b0,
        draw: drawSlime, init: seed, update: slimeUpdate, onDeath: slimeDeath
    },
    slimeling: {
        id: 'slimeling', name: 'Slimeling', hp: 5, speed: 100, damage: 4, radius: 9, xp: 1, mass: 0.6,
        size: 36, frames: 6, frameRate: 11,
        draw: drawSlimeling, init: seed, update: slimeUpdate
    },
    charger: {
        id: 'charger', name: 'Horned Charger', hp: 40, speed: 86, damage: 14, radius: 20, xp: 3, mass: 2,
        size: 68, frames: 6, frameRate: 12,
        draw: drawCharger,
        init: e => {
            e.ai.st = 'approach'
            e.ai.cd = rand(0.5, 2)
        },
        update: chargerUpdate
    },
    archer: {
        id: 'archer', name: 'Skeleton Archer', hp: 22, speed: 78, damage: 7, radius: 14, xp: 2,
        size: 60, frames: 8, frameRate: 8,
        draw: drawArcher,
        init: e => {
            e.ai.cd = rand(1, 2.5)
        },
        update: archerUpdate
    },
    bomber: {
        id: 'bomber', name: 'Powder Imp', hp: 18, speed: 98, damage: 10, radius: 15, xp: 2,
        size: 56, frames: 8, frameRate: 14, glow: 0xff7a1a,
        draw: drawBomber, update: bomberUpdate, onDeath: bomberDeath
    },
    ghost: {
        id: 'ghost', name: 'Phase Wraith', hp: 30, speed: 82, damage: 10, radius: 15, xp: 3,
        size: 60, frames: 8, frameRate: 9, glow: 0x7affff,
        draw: drawGhost, init: seed, update: ghostUpdate
    },
    shieldbearer: {
        id: 'shieldbearer', name: 'Bulwark', hp: 110, speed: 50, damage: 14, radius: 22, xp: 5, mass: 5,
        size: 68, frames: 6, frameRate: 7,
        draw: drawShieldbearer
    },
    cultist: {
        id: 'cultist', name: 'Rift Cultist', hp: 45, speed: 62, damage: 8, radius: 16, xp: 5,
        size: 64, frames: 8, frameRate: 9, glow: 0xff3fa4,
        draw: drawCultist,
        init: e => {
            e.ai.cd = rand(2, 4)
        },
        update: cultistUpdate
    },
    worm: {
        id: 'worm', name: 'Burrower', hp: 70, speed: 72, damage: 12, radius: 20, xp: 5, mass: 4,
        size: 76, frames: 6, frameRate: 10,
        draw: drawWorm, init: wormInit, update: wormUpdate
    },
    drone: {
        id: 'drone', name: 'Blade Drone', hp: 35, speed: 150, damage: 10, radius: 17, xp: 3,
        size: 56, frames: 6, frameRate: 24, glow: 0xff4040,
        draw: drawDrone,
        init: e => {
            e.ai.cd = rand(2, 4)
        },
        update: droneUpdate
    },
    imp: {
        id: 'imp', name: 'Fire Imp', hp: 30, speed: 115, damage: 9, radius: 14, xp: 3,
        size: 56, frames: 6, frameRate: 12, glow: 0xff7a1a,
        draw: drawImp,
        init: e => {
            seed(e)
            e.ai.flame = rand(0.5, 1.5)
            e.ai.cd = rand(2, 4)
        },
        update: impUpdate
    },
    wisp: {
        id: 'wisp', name: 'Frost Wisp', hp: 40, speed: 72, damage: 8, radius: 14, xp: 3,
        size: 56, frames: 8, frameRate: 10, glow: 0x58d8ff,
        draw: drawWisp,
        init: e => {
            e.ai.cd = rand(1.5, 3.5)
        },
        update: wispUpdate
    },
    brute: {
        id: 'brute', name: 'Rift Brute', hp: 380, speed: 52, damage: 22, radius: 32, xp: 14, mass: 8,
        size: 108, frames: 6, frameRate: 6, glow: 0xff3fa4,
        draw: drawBrute,
        init: e => {
            e.ai.cd = rand(1, 2)
        },
        update: bruteUpdate
    },
    mimic: {
        id: 'mimic', name: 'Mimic', hp: 160, speed: 62, damage: 18, radius: 22, xp: 25, mass: 3,
        size: 64, frames: 6, frameRate: 7,
        draw: drawMimic, update: mimicUpdate, onDeath: mimicDeath
    },
    mite: {
        id: 'mite', name: 'Rift Mite', hp: 7, speed: 215, damage: 6, radius: 9, xp: 1, mass: 0.5,
        size: 32, frames: 4, frameRate: 16, rotate: true, glow: 0xff3fa4,
        draw: drawMite, update: miteUpdate
    },
    gazer: {
        id: 'gazer', name: 'Gazer', hp: 70, speed: 62, damage: 10, radius: 20, xp: 5,
        size: 68, frames: 8, frameRate: 8, glow: 0xff2d55,
        draw: drawGazer,
        init: e => {
            e.ai.cd = rand(1.5, 3)
        },
        update: gazerUpdate
    },
    spider: {
        id: 'spider', name: 'Rift Spider', hp: 22, speed: 145, damage: 9, radius: 15, xp: 2,
        size: 60, frames: 6, frameRate: 16,
        draw: drawSpider, update: spiderUpdate
    },
    skull: {
        id: 'skull', name: 'Cinder Skull', hp: 24, speed: 180, damage: 12, radius: 13, xp: 2, mass: 0.7,
        size: 48, frames: 6, frameRate: 16, glow: 0xff6a2b,
        draw: drawSkull, update: skullUpdate
    },
    knight: {
        id: 'knight', name: 'Dread Knight', hp: 220, speed: 82, damage: 20, radius: 22, xp: 10, mass: 3,
        size: 76, frames: 6, frameRate: 9, glow: 0xb06bff,
        draw: drawKnight,
        init: e => {
            e.ai.st = 'walk'
            e.ai.cd = rand(1, 3)
        },
        update: knightUpdate
    },
    golem: {
        id: 'golem', name: 'Crystal Golem', hp: 420, speed: 46, damage: 24, radius: 28, xp: 16, mass: 7,
        size: 84, frames: 6, frameRate: 7, glow: 0x7ff0ff,
        draw: drawGolem, onDeath: golemDeath
    }
}

export const ENEMY_DEFS: Record<string, EnemyDef> = {
    ...REGULAR_DEFS,
    ...EXTRA_DEFS,
    ...BOSS_DEFS
}
