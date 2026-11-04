/*
 * The five RIFTBORN bosses, one per RIFTBORN_BOSS_TIMES slot, plus the
 * helper enemies they bring along (eggs, wyrm segments, phylacteries).
 *
 * Every boss runs the same skeleton: an intro pause, HP-threshold phases that
 * roar and shake the screen, and a weighted attack picker whose patterns are
 * always telegraphed (circles, lines) or readable bullet geometry.
 */
import type { Graphics } from 'pixi.js'
import { OUTLINE, TAU, mix, pen, shade } from './content-art'
import { aim, chance, clearEmitters, emit, fan, flag, hpCurve, kite, later, lead, move, num, pick, place, rand, ring, shoot, summon, teleport, tick, tickEmitters } from './content-ai'
import type { ShotStyle } from './content-ai'
import type { Enemy, EnemyDef, GameApi } from './types'

// ─── Shared boss machinery ───────────────────────────────────────────────

interface Attack {
    id: string
    weight: number
    /** Runs the attack, returns seconds until the next one */
    run(e: Enemy, g: GameApi): number
}

function roar(e: Enemy, g: GameApi, text: string, color: number, power = 0.7): void {
    g.announce(text, color)
    g.shake(power)
    g.flash(color, 0.35)
    g.sfx.play('bossRoar')
    g.particles(e.x, e.y, { count: 60, color, speed: 420, life: 0.9, size: 7 })
    g.particles(e.x, e.y, { count: 30, color: 0xffffff, speed: 260, life: 0.6, size: 4 })
}

/** Advance through HP thresholds, calling onPhase once per crossed one */
function phases(e: Enemy, thresholds: readonly number[], onPhase: (phase: number) => void): number {
    let phase = num(e, 'phase')
    while (phase < thresholds.length && e.hp / Math.max(1, e.maxHp) < thresholds[phase]!) {
        phase++
        e.ai.phase = phase
        onPhase(phase)
    }
    return phase
}

function pickAttack(e: Enemy, attacks: Attack[]): Attack {
    const last = e.ai.lastAtk
    const pool = attacks.length > 1 ? attacks.filter(a => a.id !== last) : attacks
    const total = pool.reduce((s, a) => s + a.weight, 0)
    let roll = rand(0, total)
    for (const a of pool) {
        roll -= a.weight
        if (roll <= 0) {
            e.ai.lastAtk = a.id
            return a
        }
    }
    const a = pool[pool.length - 1]!
    e.ai.lastAtk = a.id
    return a
}

/** Picks and runs the next attack whenever the clock runs out */
function attackClock(e: Enemy, g: GameApi, dt: number, attacks: Attack[], tempo: number): void {
    if (e.stunT > 0) return
    if (tick(e, 'atk', dt) > 0) return
    const a = pickAttack(e, attacks)
    e.ai.atk = a.run(e, g) * tempo
}

function alive(e: Enemy): boolean {
    return !e.dead && e.hp > 0
}

function panOf(e: Enemy, g: GameApi): number {
    return Math.max(-1, Math.min(1, (e.x - g.player.x) / Math.max(200, g.view.width / 2)))
}

/** A cascade of explosions over `duration`, then one huge burst */
function deathSpectacle(x: number, y: number, g: GameApi, colors: number[], spread: number, duration: number, big = false): void {
    const bursts = big ? 26 : 14
    g.shake(0.6)
    g.flash(0xffffff, 0.4)
    g.sfx.play('bossRoar', { pitch: 0.8 })
    for (let i = 0; i < bursts; i++) {
        const t = (i / bursts) * duration
        later(t, gg => {
            const a = rand(0, TAU)
            const r = rand(0, spread)
            const bx = x + Math.cos(a) * r
            const by = y + Math.sin(a) * r
            const c = pick(colors)
            gg.particles(bx, by, { count: 24, color: c, speed: 320, life: 0.6, size: 6 })
            gg.particles(bx, by, { count: 10, color: 0xffffff, speed: 180, life: 0.4, size: 4 })
            gg.shake(0.25)
            gg.sfx.play('explosion', { volume: 0.6, pitch: rand(0.7, 1.2) })
        })
    }
    later(duration, gg => {
        for (const c of colors) gg.particles(x, y, { count: big ? 90 : 50, color: c, speed: big ? 700 : 520, life: 1.3, size: 8 })
        gg.particles(x, y, { count: big ? 120 : 60, color: 0xffffff, speed: big ? 900 : 600, life: 1, size: 5 })
        gg.shake(big ? 1.6 : 1)
        gg.flash(0xffffff, big ? 0.9 : 0.6)
        gg.sfx.play('bossDeath')
    })
}

function minionMul(g: GameApi): number {
    return hpCurve(g.time)
}

/** A spot around the player that is (roughly) on screen */
function nearPlayer(g: GameApi, min: number, max: number): { x: number, y: number } {
    const a = rand(0, TAU)
    const r = rand(min, max)
    return { x: g.player.x + Math.cos(a) * r, y: g.player.y + Math.sin(a) * r }
}

const spike = (e: Enemy, speed: number, color = 0xe9e4d4): ShotStyle => ({ speed, damage: e.damage * 0.55, color, radius: 9, kind: 'spike', life: 5 })
const orb = (e: Enemy, speed: number, color: number, extra: Partial<ShotStyle> = {}): ShotStyle => ({ speed, damage: e.damage * 0.5, color, radius: 10, kind: 'orb', life: 6, ...extra })

// ─── 1. Bone Colossus (3:00) ─────────────────────────────────────────────

const BONE = 0xe9e4d4
const SOUL = 0x6dffb0

function drawColossus(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 8) * TAU
    const sway = Math.sin(ph)
    const pulse = 0.5 + 0.5 * Math.sin(ph)
    const boneD = 0xa8a294
    P.ellipse(0, 100, 80, 12, 0x000000, 0.3)
    // soul-flame tail under the pelvis
    for (let i = 0; i < 5; i++) {
        const x = -24 + i * 12
        const h = 30 + Math.sin(ph + i * 1.7) * 8
        P.poly([x - 9, 66, x + Math.sin(ph + i) * 5, 66 + h, x + 9, 66], SOUL, 0.35 + (i % 2) * 0.15)
    }
    P.halo(0, 30, 70, SOUL, 0.12 + pulse * 0.06)
    // back arm (left)
    const ax = -54
    P.line(ax, -36, ax - 22, 10 + sway * 4, OUTLINE, 15)
    P.line(ax, -36, ax - 22, 10 + sway * 4, boneD, 10)
    P.line(ax - 22, 10 + sway * 4, ax - 14, 52 + sway * 6, OUTLINE, 13)
    P.line(ax - 22, 10 + sway * 4, ax - 14, 52 + sway * 6, boneD, 8)
    P.disc(ax - 22, 10 + sway * 4, 7, boneD, OUTLINE, 2.5)
    for (let i = -1; i <= 1; i++) {
        P.line(ax - 14, 52 + sway * 6, ax - 20 + i * 8, 70 + sway * 6, OUTLINE, 7)
        P.line(ax - 14, 52 + sway * 6, ax - 20 + i * 8, 70 + sway * 6, boneD, 4)
    }
    // spine and pelvis
    for (let i = 0; i < 7; i++) P.disc(0, -24 + i * 13, 7 - i * 0.3, BONE, OUTLINE, 2.5)
    P.shape([-30, 56, -20, 48, 0, 52, 20, 48, 30, 56, 22, 70, 8, 64, -8, 64, -22, 70], BONE, OUTLINE, 3)
    P.ellipse(-12, 60, 5, 3.5, 0x14141c)
    P.ellipse(12, 60, 5, 3.5, 0x14141c)
    // soul core
    P.halo(4, -6, 34 + pulse * 6, SOUL, 0.5)
    P.disc(4, -6, 11 + pulse * 2, SOUL, 0x1a6a4a, 2.5)
    P.circle(1, -9, 4, 0xe8fff2)
    // ribs
    for (let i = 0; i < 5; i++) {
        const y = -34 + i * 13
        const w = 44 - i * 4
        for (const s of [-1, 1]) {
            g.moveTo(0, y).quadraticCurveTo(s * w, y - 8, s * (w - 6), y + 14).stroke({ color: P.c(OUTLINE), width: 9, cap: 'round' })
            g.moveTo(0, y).quadraticCurveTo(s * w, y - 8, s * (w - 6), y + 14).stroke({ color: P.c(BONE), width: 5.5, cap: 'round' })
        }
    }
    P.path([-26, -20, -18, -12, -22, -2], SOUL, 2, 0.8)
    P.path([30, 6, 22, 14, 26, 22], SOUL, 2, 0.8)
    // shoulders
    for (const s of [-1, 1]) {
        P.shape([s * 30, -44, s * 44, -62, s * 66, -58, s * 72, -40, s * 58, -26, s * 36, -30], shade(BONE, 0.92), OUTLINE, 3)
        P.shape([s * 50, -58, s * 56, -80, s * 62, -56], BONE, OUTLINE, 2.5)
        P.shape([s * 62, -52, s * 74, -68, s * 70, -46], BONE, OUTLINE, 2.5)
    }
    // front arm (right), raised a little
    const bx = 54
    const lift = sway * 6
    P.line(bx, -36, bx + 26, 4 + lift, OUTLINE, 16)
    P.line(bx, -36, bx + 26, 4 + lift, BONE, 11)
    P.disc(bx + 26, 4 + lift, 8, BONE, OUTLINE, 2.5)
    P.line(bx + 26, 4 + lift, bx + 34, 46 + lift, OUTLINE, 14)
    P.line(bx + 26, 4 + lift, bx + 34, 46 + lift, BONE, 9)
    P.disc(bx + 34, 50 + lift, 11, BONE, OUTLINE, 3)
    for (let i = -1; i <= 1; i++) {
        P.line(bx + 34, 52 + lift, bx + 34 + i * 9, 72 + lift, OUTLINE, 8)
        P.line(bx + 34, 52 + lift, bx + 34 + i * 9, 72 + lift, BONE, 4.5)
    }
    // skull
    const sy = -70 + sway * 1.5
    for (let i = 0; i < 5; i++) {
        const x = -16 + i * 10
        const h = 22 + (i === 2 ? 10 : i % 2 === 0 ? 0 : 5)
        P.shape([x - 5, sy - 22, x + 1, sy - 22 - h, x + 6, sy - 22], BONE, OUTLINE, 2.5)
    }
    P.disc(8, sy, 28, BONE, OUTLINE, 3.5)
    P.ellipse(0, sy - 12, 14, 8, 0xffffff, 0.45)
    P.shape([-8, sy + 14, 26, sy + 14, 30, sy + 30, 14, sy + 36, -4, sy + 30], shade(BONE, 0.9), OUTLINE, 3)
    for (let i = 0; i < 6; i++) P.line(-2 + i * 5.5, sy + 14, -2 + i * 5.5, sy + 22, OUTLINE, 1.6)
    P.ellipse(18, sy - 2, 8, 9, 0x0a0f0c)
    P.ellipse(-2, sy - 2, 7, 8.5, 0x0a0f0c)
    P.eye(18, sy - 2, 4.5, SOUL)
    P.eye(-2, sy - 2, 4, SOUL)
    P.poly([8, sy + 6, 4, sy + 12, 12, sy + 12], 0x0a0f0c)
    P.path([22, sy - 22, 26, sy - 12, 22, sy - 8], 0x7a7466, 1.6)
}

function colossusAttacks(phase: number): Attack[] {
    const p2 = phase >= 1
    const list: Attack[] = [
        {
            id: 'slam', weight: 3,
            run(e, _g) {
                const n = p2 ? 5 : 3
                for (let i = 0; i < n; i++) {
                    later(i * (p2 ? 0.32 : 0.45), gg => {
                        if (!alive(e)) return
                        const t = lead(gg, 0.35)
                        gg.telegraphCircle({ x: t.x, y: t.y, radius: 90, delay: 0.95, damage: e.damage, color: SOUL })
                        gg.sfx.play('telegraph', { volume: 0.4, pitch: 0.7 })
                        later(0.95, g3 => {
                            g3.shake(0.25)
                            g3.particles(t.x, t.y, { count: 22, color: BONE, speed: 260, life: 0.5, size: 6 })
                            g3.sfx.play('shootHeavy', { volume: 0.45, pitch: 0.5 })
                        })
                    })
                }
                return 2.6
            }
        },
        {
            id: 'ring', weight: 3,
            run(e, _g) {
                const waves = p2 ? 3 : 2
                const base = rand(0, TAU)
                for (let w = 0; w < waves; w++) {
                    later(w * 0.55, gg => {
                        if (!alive(e)) return
                        ring(gg, e.x, e.y, 20, base + (w % 2) * (Math.PI / 20), spike(e, 200))
                        gg.sfx.play('enemyShot', { volume: 0.6, pitch: 0.6, pan: panOf(e, gg) })
                    })
                }
                return 2.2
            }
        },
        {
            id: 'eruption', weight: 2,
            run(e, g) {
                const a = aim(e, g)
                const lines = p2 ? [-0.35, 0, 0.35] : [0]
                for (const off of lines) {
                    const ang = a.angle + off
                    for (let i = 1; i <= 9; i++) {
                        const x = e.x + Math.cos(ang) * i * 70
                        const y = e.y + Math.sin(ang) * i * 70
                        g.telegraphCircle({ x, y, radius: 44, delay: 0.6 + i * 0.09, damage: e.damage * 0.9, color: SOUL })
                    }
                }
                g.sfx.play('telegraph', { volume: 0.5, pitch: 0.6 })
                return 2
            }
        },
        {
            id: 'raise', weight: 1.5,
            run(e, g) {
                const n = p2 ? 8 : 6
                const off = rand(0, TAU)
                for (let i = 0; i < n; i++) {
                    const a = off + (i / n) * TAU
                    const x = g.player.x + Math.cos(a) * 270
                    const y = g.player.y + Math.sin(a) * 270
                    g.particles(x, y, { count: 14, color: SOUL, speed: 140, life: 0.6, size: 5 })
                    later(0.4, gg => {
                        if (alive(e)) summon(gg, i % 3 === 0 ? 'archer' : 'ghoul', x, y, minionMul(gg))
                    })
                }
                g.sfx.play('summon', { volume: 0.7, pitch: 0.7 })
                return 2.4
            }
        }
    ]
    if (p2) {
        list.push({
            id: 'charge', weight: 2.5,
            run(e, g) {
                const a = aim(e, g)
                e.ai.st = 'wind'
                e.ai.t = 0.85
                e.ai.dx = a.nx
                e.ai.dy = a.ny
                g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + a.nx * 760, y2: e.y + a.ny * 760, width: e.radius * 2, delay: 0.85, damage: 0, color: SOUL })
                g.sfx.play('telegraph', { volume: 0.6, pitch: 0.5 })
                return 2.4
            }
        }, {
            id: 'spiral', weight: 2,
            run(e, _g) {
                const base = rand(0, TAU)
                emit(e, 2.8, 0.1, (ee, gg, i) => {
                    for (let k = 0; k < 3; k++) shoot(gg, ee.x, ee.y, base + i * 0.27 + (k * TAU) / 3, spike(ee, 175))
                    if (i % 4 === 0) gg.sfx.play('enemyShot', { volume: 0.35, pitch: 0.8 })
                })
                return 3.2
            }
        })
    }
    return list
}

function colossusUpdate(e: Enemy, g: GameApi, dt: number): void {
    tickEmitters(e, g, dt)
    const phase = phases(e, [0.5], () => {
        roar(e, g, 'ENRAGED', SOUL)
        ring(g, e.x, e.y, 28, 0, spike(e, 240))
        e.ai.atk = 1.4
    })
    const st = e.ai.st
    if (st === 'wind') {
        e.scale = 1 + Math.sin(e.age * 40) * 0.03
        if (tick(e, 't', dt) <= 0) {
            e.scale = 1
            e.ai.st = 'charge'
            e.ai.t = 0.75
            g.sfx.play('dash', { pitch: 0.5 })
        }
        return
    }
    if (st === 'charge') {
        move(e, g, num(e, 'dx') * 820, num(e, 'dy') * 820, dt)
        if (tick(e, 'trail', dt) <= 0) {
            e.ai.trail = 0.09
            const a = Math.atan2(num(e, 'dy'), num(e, 'dx'))
            shoot(g, e.x, e.y, a + Math.PI / 2, spike(e, 120))
            shoot(g, e.x, e.y, a - Math.PI / 2, spike(e, 120))
        }
        if (tick(e, 't', dt) <= 0) {
            e.ai.st = ''
            g.shake(0.35)
            ring(g, e.x, e.y, 16, rand(0, TAU), spike(e, 190))
        }
        return
    }
    if (tick(e, 'intro', dt) > 0) return
    g.chase(e, dt, phase >= 1 ? 1.3 : 1)
    attackClock(e, g, dt, colossusAttacks(phase), phase >= 1 ? 0.75 : 1)
}

// ─── 2. Hive Queen (6:00) ────────────────────────────────────────────────

const AMBER = 0xf5a524
const CHITIN = 0x2a1a0a
const ACID = 0xb6ff3b

function drawQueen(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const flap = Math.sin(ph * 2)
    const step = Math.sin(ph)
    P.ellipse(0, 100, 90, 12, 0x000000, 0.3)
    // wings
    for (const [x, y, rx, a] of [[-30, -48, 56, 0.2], [-10, -56, 48, 0.45]] as const) {
        const ry = 16 + flap * 10
        g.ellipse(x - rx * 0.4, y - ry * 0.5 - a * 10, rx, Math.abs(ry) + 4).fill({ color: P.c(0xd8fff0), alpha: 0.28 }).stroke({ color: P.c(0x8affc0), width: 2, alpha: 0.7 })
        P.path([x + 10, y + 6, x - rx * 0.9, y - ry - 6], 0x8affc0, 1.4, 0.6)
    }
    // legs
    for (let i = 0; i < 3; i++) {
        const lx = -6 + i * 16
        const sw = Math.sin(ph + i * 2.1) * 6
        P.path([lx, 14, lx - 10 + sw, 50, lx - 16 + sw * 1.3, 86], OUTLINE, 8)
        P.path([lx, 14, lx - 10 + sw, 50, lx - 16 + sw * 1.3, 86], 0x3a2a12, 4.5)
    }
    // abdomen
    P.oval(-58, 14, 52, 34, AMBER, OUTLINE, 3.5)
    for (let i = 0; i < 4; i++) {
        const x = -88 + i * 18
        g.moveTo(x, -16 + Math.abs(i - 1.5) * 4).quadraticCurveTo(x - 8, 14, x, 44 - Math.abs(i - 1.5) * 4).stroke({ color: P.c(CHITIN), width: 7, cap: 'round' })
    }
    P.ellipse(-58, 0, 34, 12, 0xffd07a, 0.45)
    for (let i = 0; i < 5; i++) P.halo(-80 + i * 14, 28 + (i % 2) * 6, 7, ACID, 0.5 + 0.2 * Math.sin(ph + i))
    P.shape([-106, 6, -126, 18 + step * 2, -106, 24], CHITIN, OUTLINE, 2.5)
    // thorax
    P.oval(6, 0, 30, 25, 0x3a2a12, OUTLINE, 3)
    P.ellipse(2, -8, 18, 8, shade(AMBER, 0.8), 0.7)
    P.path([-14, 8, 24, 8], AMBER, 2, 0.7)
    // front legs
    for (let i = 0; i < 2; i++) {
        const sw = Math.sin(ph + i * 2.6 + 1) * 6
        P.path([20 + i * 6, 16, 40 + sw, 46, 30 + sw, 84], OUTLINE, 8)
        P.path([20 + i * 6, 16, 40 + sw, 46, 30 + sw, 84], 0x4a3418, 4.5)
    }
    // head
    const hx = 50
    const hy = -14 + step * 1.5
    P.g.moveTo(hx + 4, hy - 18).quadraticCurveTo(hx + 4, hy - 50, hx + 30, hy - 58).stroke({ color: P.c(OUTLINE), width: 5, cap: 'round' })
    P.g.moveTo(hx + 4, hy - 18).quadraticCurveTo(hx + 4, hy - 50, hx + 30, hy - 58).stroke({ color: P.c(AMBER), width: 2.6, cap: 'round' })
    P.g.moveTo(hx + 12, hy - 16).quadraticCurveTo(hx + 22, hy - 44, hx + 48, hy - 46).stroke({ color: P.c(OUTLINE), width: 5, cap: 'round' })
    P.g.moveTo(hx + 12, hy - 16).quadraticCurveTo(hx + 22, hy - 44, hx + 48, hy - 46).stroke({ color: P.c(AMBER), width: 2.6, cap: 'round' })
    P.disc(hx, hy, 24, 0x3a2a12, OUTLINE, 3)
    for (let i = 0; i < 5; i++) P.shape([hx - 18 + i * 8, hy - 18, hx - 14 + i * 8, hy - 34 - (i === 2 ? 8 : 0), hx - 10 + i * 8, hy - 18], AMBER, OUTLINE, 2)
    P.halo(hx + 10, hy - 4, 18, ACID, 0.35)
    P.oval(hx + 10, hy - 4, 11, 13, ACID, OUTLINE, 2.5)
    P.oval(hx - 8, hy - 6, 8, 10, shade(ACID, 0.85), OUTLINE, 2)
    for (let i = 0; i < 6; i++) P.circle(hx + 6 + (i % 3) * 4, hy - 9 + Math.floor(i / 3) * 6, 1.4, 0xf0ffd0, 0.8)
    P.circle(hx + 6, hy - 10, 3, 0xffffff, 0.8)
    const mand = 4 + step * 3
    P.shape([hx + 16, hy + 12, hx + 36, hy + 10 - mand, hx + 30, hy + 18], AMBER, OUTLINE, 2)
    P.shape([hx + 12, hy + 18, hx + 32, hy + 22 + mand, hx + 22, hy + 24], AMBER, OUTLINE, 2)
    P.circle(hx + 26, hy + 18, 3, ACID, 0.8)
}

function drawEgg(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const pulse = Math.sin((frame / 4) * TAU)
    P.ellipse(0, 16, 14, 4, 0x000000, 0.3)
    P.halo(0, 0, 22 + pulse * 3, ACID, 0.25)
    P.oval(0, 0, 13 + pulse, 17 - pulse, 0xe8f0c0, 0x4a5a1a, 2.5)
    P.ellipse(-4, -6, 4, 6, 0xffffff, 0.6)
    P.halo(1, 3, 9, ACID, 0.6)
    P.ellipse(1, 3, 5 + pulse, 6, 0x6a8a1a, 0.7)
    P.path([-8, -4, -3, 2, -6, 8], 0x8aa03a, 1.4)
    P.path([7, -8, 4, -2, 8, 4], 0x8aa03a, 1.4)
}

function queenAttacks(phase: number): Attack[] {
    const frenzy = phase >= 2
    const list: Attack[] = [
        {
            id: 'acid', weight: 3,
            run(e, _g) {
                const volleys = frenzy ? 4 : 3
                for (let v = 0; v < volleys; v++) {
                    later(v * 0.28, gg => {
                        if (!alive(e)) return
                        fan(gg, e.x + 40 * e.facing, e.y - 10, aim(e, gg).angle, frenzy ? 7 : 5, frenzy ? 1.1 : 0.8, orb(e, 270, ACID, { radius: 9 }))
                        gg.sfx.play('enemyShot', { volume: 0.5, pitch: 1.2, pan: panOf(e, gg) })
                    })
                }
                return 2
            }
        },
        {
            id: 'eggs', weight: 2,
            run(e, g) {
                const n = phase >= 1 ? 6 : 4
                for (let i = 0; i < n; i++) {
                    const p = nearPlayer(g, 80, 300)
                    g.telegraphCircle({ x: p.x, y: p.y, radius: 55, delay: 1.1, damage: e.damage * 0.8, color: ACID })
                    later(1.1, gg => {
                        gg.particles(p.x, p.y, { count: 14, color: ACID, speed: 160, life: 0.5, size: 5 })
                        if (alive(e)) summon(gg, 'broodEgg', p.x, p.y, Math.max(1, e.maxHp / 15000))
                    })
                }
                g.sfx.play('summon', { volume: 0.5, pitch: 1.3 })
                return 2.4
            }
        },
        {
            id: 'swarm', weight: 2,
            run(e, g) {
                const n = frenzy ? 18 : 12
                for (let i = 0; i < n; i++) {
                    later(i * 0.05, gg => {
                        if (!alive(e)) return
                        const id = frenzy && i % 3 === 0 ? 'spider' : i % 2 === 0 ? 'mite' : 'bat'
                        summon(gg, id, e.x + rand(-30, 30), e.y + rand(-30, 30), minionMul(gg))
                    })
                }
                g.particles(e.x, e.y, { count: 30, color: AMBER, speed: 240, life: 0.6, size: 5 })
                g.sfx.play('summon', { volume: 0.6 })
                return 2.6
            }
        }
    ]
    if (phase >= 1) {
        list.push({
            id: 'sting', weight: 2.5,
            run(e, g) {
                const t = lead(g, 0.3)
                const dx = t.x - e.x
                const dy = t.y - e.y
                const d = Math.hypot(dx, dy) || 1
                e.ai.st = 'wind'
                e.ai.t = 0.7
                e.ai.dx = dx / d
                e.ai.dy = dy / d
                g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + (dx / d) * 900, y2: e.y + (dy / d) * 900, width: e.radius * 1.8, delay: 0.7, damage: 0, color: AMBER })
                g.sfx.play('telegraph', { volume: 0.6, pitch: 1.1 })
                return 2.2
            }
        }, {
            id: 'spiral', weight: 2,
            run(e, _g) {
                const base = rand(0, TAU)
                const dir = chance(0.5) ? 1 : -1
                emit(e, 2.6, 0.08, (ee, gg, i) => {
                    shoot(gg, ee.x, ee.y, base + dir * i * 0.31, orb(ee, 190, ACID, { radius: 8 }))
                    shoot(gg, ee.x, ee.y, base + dir * i * 0.31 + Math.PI, orb(ee, 190, ACID, { radius: 8 }))
                })
                return 3
            }
        })
    }
    return list
}

function queenUpdate(e: Enemy, g: GameApi, dt: number): void {
    tickEmitters(e, g, dt)
    const phase = phases(e, [0.6, 0.25], p => {
        if (p === 1) roar(e, g, 'HIVE SCREAMS', ACID)
        else roar(e, g, 'FRENZY', AMBER, 0.9)
        ring(g, e.x, e.y, 24, 0, orb(e, 220, ACID))
        e.ai.atk = 1.2
    })
    const st = e.ai.st
    if (st === 'wind') {
        e.scale = 1 + Math.sin(e.age * 50) * 0.03
        if (tick(e, 't', dt) <= 0) {
            e.scale = 1
            e.ai.st = 'dash'
            e.ai.t = 0.8
            g.sfx.play('dash', { pitch: 0.7 })
        }
        return
    }
    if (st === 'dash') {
        move(e, g, num(e, 'dx') * 900, num(e, 'dy') * 900, dt)
        if (tick(e, 'trail', dt) <= 0) {
            e.ai.trail = 0.12
            g.telegraphCircle({ x: e.x, y: e.y, radius: 40, delay: 0.5, damage: e.damage * 0.5, color: ACID })
        }
        if (tick(e, 't', dt) <= 0) e.ai.st = ''
        return
    }
    if (tick(e, 'intro', dt) > 0) return
    kite(e, g, dt, 180, 320, 0.6)
    attackClock(e, g, dt, queenAttacks(phase), phase >= 2 ? 0.6 : phase >= 1 ? 0.8 : 1)
}

function eggUpdate(e: Enemy, g: GameApi, dt: number): void {
    e.scale = 1 + Math.max(0, 1.2 - num(e, 'hatch', 4)) * 0.2 * Math.abs(Math.sin(e.age * 12))
    if (tick(e, 'hatch', dt) > 0) return
    if (flag(e, 'hatched')) return
    e.ai.hatched = true
    g.particles(e.x, e.y, { count: 20, color: 0xe8f0c0, speed: 200, life: 0.5, size: 5 })
    for (let i = 0; i < 3; i++) summon(g, 'spider', e.x + rand(-12, 12), e.y + rand(-12, 12), minionMul(g))
    e.dead = true
}

// ─── 3. Storm Wyrm (9:00) ────────────────────────────────────────────────

const STORM = 0x63c7ff
const SCALE = 0x1e3a6a
const SCALE_L = 0x3d7ad8

const wyrms = new Map<number, Enemy>()
const links = new Map<number, Enemy>()

function zigzag(P: ReturnType<typeof pen>, x1: number, y1: number, x2: number, y2: number, seedN: number, color: number, width: number): void {
    const pts: number[] = [x1, y1]
    const steps = 5
    for (let i = 1; i < steps; i++) {
        const t = i / steps
        const j = Math.sin(seedN * 12.9898 + i * 78.233) * 6
        pts.push(x1 + (x2 - x1) * t + j, y1 + (y2 - y1) * t - j)
    }
    pts.push(x2, y2)
    P.path(pts, color, width + 3, 0.35)
    P.path(pts, mix(color, 0xffffff, 0.6), width)
}

function drawWyrmHead(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const open = 5 + Math.sin((frame / 6) * TAU) * 5
    P.halo(10, 0, 80, STORM, 0.18)
    for (const s of [-1, 1]) {
        P.shape([-30, s * 18, -62, s * 44, -48, s * 22, -70, s * 30, -40, s * 10], SCALE_L, OUTLINE, 2.5)
        P.shape([0, s * 20, -30, s * 52, -20, s * 24], 0xbfe8ff, OUTLINE, 2.5)
        P.shape([14, s * 18, -6, s * 44, 0, s * 18], 0xbfe8ff, OUTLINE, 2.2)
    }
    P.shape([-46, -24, 20, -24, 56, -12 - open, 74, -6 - open, 50, -2, 50, 2, 74, 6 + open, 56, 12 + open, 20, 24, -46, 24, -56, 0], SCALE, OUTLINE, 3.5)
    P.halo(52, 0, 20, STORM, 0.6)
    P.poly([48, -2, 72, -6 - open, 72, 6 + open, 48, 2], 0x9ae6ff, 0.9)
    for (let i = 0; i < 4; i++) {
        const x = 52 + i * 5.5
        P.poly([x, -8 - open * (0.3 + i * 0.15), x + 2.5, -8 - open * (0.3 + i * 0.15), x + 1.2, -3], 0xffffff)
        P.poly([x, 8 + open * (0.3 + i * 0.15), x + 2.5, 8 + open * (0.3 + i * 0.15), x + 1.2, 3], 0xffffff)
    }
    P.ellipse(0, 0, 40, 9, SCALE_L, 0.6)
    for (let i = 0; i < 5; i++) P.shape([-40 + i * 16, -4, -32 + i * 16, 0, -40 + i * 16, 4, -46 + i * 16, 0], 0x6ab0ff, OUTLINE, 1.2)
    for (const s of [-1, 1]) {
        P.ellipse(26, s * 15, 8, 5, 0x05101e)
        P.eye(28, s * 15, 4, STORM)
        P.path([10, s * 20, 22, s * 22, 36, s * 18], 0x6ab0ff, 2)
    }
    zigzag(P, -10, -20, 30, -36, frame, STORM, 1.6)
    zigzag(P, -20, 22, 20, 38, frame + 7, STORM, 1.6)
}

function drawWyrmBody(g: Graphics, frame: number, white: boolean, s: number): void {
    const P = pen(g, white)
    const r = 34 * s
    P.halo(0, 0, r * 1.5, STORM, 0.12)
    for (const k of [-1, 1]) {
        P.shape([-r * 0.5, k * r * 0.7, -r * 1.05, k * r * 1.35, -r * 0.1, k * r * 0.9], SCALE_L, OUTLINE, 2.2)
        P.shape([r * 0.3, k * r * 0.75, -r * 0.2, k * r * 1.25, r * 0.6, k * r * 0.85], 0xbfe8ff, OUTLINE, 2)
    }
    P.oval(0, 0, r, r * 0.82, SCALE, OUTLINE, 3)
    P.ellipse(-r * 0.2, -r * 0.35, r * 0.55, r * 0.2, SCALE_L, 0.6)
    P.shape([r * 0.75, 0, -r * 0.1, -r * 0.34, -r * 0.7, 0, -r * 0.1, r * 0.34], 0x2c5aa0, OUTLINE, 2)
    const glow = 0.6 + 0.4 * Math.sin((frame / 4) * TAU)
    P.line(-r * 0.6, 0, r * 0.6, 0, STORM, 4 * s, glow)
    P.line(-r * 0.6, 0, r * 0.6, 0, 0xffffff, 1.5 * s, glow)
    if (frame % 2 === 0) zigzag(P, -r * 0.8, -r * 0.6, r * 0.6, r * 0.7, frame, STORM, 1.2)
}

function drawWyrmSegment(g: Graphics, frame: number, white: boolean): void {
    drawWyrmBody(g, frame, white, 1)
}

function drawWyrmTail(g: Graphics, frame: number, white: boolean): void {
    drawWyrmBody(g, frame, white, 0.7)
    const P = pen(g, white)
    P.shape([-20, 0, -44, -22, -36, 0, -44, 22], SCALE_L, OUTLINE, 2.5)
}

function segmentsOf(head: Enemy): Enemy[] {
    const out: Enemy[] = []
    for (const s of links.values()) if (s.ai.head === head.uid && !s.dead) out.push(s)
    return out
}

function wyrmInit(e: Enemy, g: GameApi): void {
    bossIntro(e, g, 'STORM WYRM', STORM)
    wyrms.set(e.uid, e)
    e.ai.h = aim(e, g).angle
    let prev = e
    const count = 14
    const a = e.ai.h as number
    for (let i = 0; i < count; i++) {
        const id = i >= count - 3 ? 'wyrmTail' : 'wyrmSegment'
        const x = e.x - Math.cos(a) * 48 * (i + 1)
        const y = e.y - Math.sin(a) * 48 * (i + 1)
        const seg = summon(g, id, x, y, 1)
        if (!seg) break
        seg.ai.head = e.uid
        seg.ai.prev = prev.uid
        seg.ai.idx = i
        links.set(seg.uid, seg)
        prev = seg
    }
}

function wyrmAttacks(phase: number): Attack[] {
    const storm = phase >= 1
    const eye = phase >= 2
    const list: Attack[] = [
        {
            id: 'strikes', weight: 3,
            run(e, g) {
                const n = eye ? 16 : storm ? 12 : 8
                for (let i = 0; i < n; i++) {
                    const p = i === 0 ? lead(g, 0.5) : nearPlayer(g, 40, 300)
                    const delay = 0.8 + (i / n) * 0.8
                    g.telegraphCircle({ x: p.x, y: p.y, radius: 58, delay, damage: e.damage * 0.8, color: STORM })
                    later(delay, gg => {
                        gg.particles(p.x, p.y, { count: 16, color: STORM, speed: 280, life: 0.4, size: 4 })
                        if (i % 3 === 0) gg.sfx.play('zap', { volume: 0.5, pitch: 0.6 })
                    })
                }
                g.sfx.play('telegraph', { volume: 0.5, pitch: 1.4 })
                return 2.4
            }
        },
        {
            id: 'walls', weight: 2,
            run(e, g) {
                const n = eye ? 5 : storm ? 4 : 3
                const base = rand(0, Math.PI)
                for (let i = 0; i < n; i++) {
                    const ang = base + (i / n) * Math.PI
                    const off = rand(-120, 120)
                    const cx = g.player.x + Math.cos(ang + Math.PI / 2) * off
                    const cy = g.player.y + Math.sin(ang + Math.PI / 2) * off
                    const len = 900
                    g.telegraphLine({ x1: cx - Math.cos(ang) * len, y1: cy - Math.sin(ang) * len, x2: cx + Math.cos(ang) * len, y2: cy + Math.sin(ang) * len, width: 38, delay: 1.1 + i * 0.15, damage: e.damage, color: STORM })
                }
                later(1.1, gg => gg.sfx.play('laser', { volume: 0.6, pitch: 0.6 }))
                return 2.6
            }
        },
        {
            id: 'volley', weight: 2,
            run(e, g) {
                ring(g, e.x, e.y, 18, rand(0, TAU), orb(e, 230, STORM))
                for (const s of segmentsOf(e)) {
                    if (num(s, 'idx') % 4 !== 1) continue
                    later(0.1 * num(s, 'idx') / 4, gg => {
                        if (!s.dead) fan(gg, s.x, s.y, aim(s, gg).angle, 3, 0.4, orb(e, 210, STORM, { radius: 8 }))
                    })
                }
                g.sfx.play('zap', { volume: 0.6, pitch: 1.2 })
                return 2
            }
        }
    ]
    if (storm) {
        list.push({
            id: 'dive', weight: 2.5,
            run(e, g) {
                const a = aim(e, g)
                e.ai.st = 'wind'
                e.ai.t = 0.8
                e.ai.h = a.angle
                g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + a.nx * 1000, y2: e.y + a.ny * 1000, width: e.radius * 2.2, delay: 0.8, damage: 0, color: STORM })
                g.sfx.play('telegraph', { volume: 0.6, pitch: 0.8 })
                return 2.6
            }
        }, {
            id: 'static', weight: 1.5,
            run(e, _g) {
                const base = rand(0, TAU)
                emit(e, 2.4, 0.12, (ee, gg, i) => {
                    for (let k = 0; k < 4; k++) shoot(gg, ee.x, ee.y, base + i * 0.22 + (k * TAU) / 4, orb(ee, 160, STORM, { radius: 8 }))
                })
                return 2.8
            }
        })
    }
    return list
}

function wyrmUpdate(e: Enemy, g: GameApi, dt: number): void {
    tickEmitters(e, g, dt)
    const phase = phases(e, [0.5, 0.2], p => {
        roar(e, g, p === 1 ? 'STORM BREAKS' : 'EYE OF STORM', STORM, 0.9)
        for (const s of segmentsOf(e)) g.particles(s.x, s.y, { count: 8, color: STORM, speed: 200, life: 0.5, size: 4 })
        e.ai.atk = 1.2
    })
    let h = num(e, 'h')
    const st = e.ai.st
    if (st === 'wind') {
        if (tick(e, 't', dt) <= 0) {
            e.ai.st = 'dive'
            e.ai.t = 1
            g.sfx.play('dash', { pitch: 0.5 })
        }
        move(e, g, Math.cos(h) * 40, Math.sin(h) * 40, dt)
        return
    }
    if (st === 'dive') {
        move(e, g, Math.cos(h) * 720, Math.sin(h) * 720, dt)
        if (tick(e, 't', dt) <= 0) e.ai.st = ''
        return
    }
    const a = aim(e, g)
    const weave = Math.sin(e.age * 1.4) * 0.7
    let d = a.angle + weave - h
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    const turn = (phase >= 1 ? 2 : 1.5) * dt
    h += Math.max(-turn, Math.min(turn, d))
    e.ai.h = h
    if (tick(e, 'intro', dt) <= 0) attackClock(e, g, dt, wyrmAttacks(phase), phase >= 2 ? 0.65 : phase >= 1 ? 0.8 : 1)
    const speed = e.speed * (phase >= 1 ? 1.25 : 1) * (a.dist > 700 ? 1.8 : 1)
    move(e, g, Math.cos(h) * speed, Math.sin(h) * speed, dt)
}

function wyrmDeath(e: Enemy, g: GameApi): void {
    const segs = segmentsOf(e).sort((a, b) => num(a, 'idx') - num(b, 'idx'))
    segs.forEach((s, i) => {
        later(i * 0.09, gg => {
            gg.particles(s.x, s.y, { count: 26, color: STORM, speed: 300, life: 0.6, size: 6 })
            gg.particles(s.x, s.y, { count: 10, color: 0xffffff, speed: 200, life: 0.4, size: 4 })
            gg.sfx.play('explosion', { volume: 0.4, pitch: 1.2 - i * 0.03 })
            gg.shake(0.15)
            s.dead = true
            links.delete(s.uid)
        })
    })
    wyrms.delete(e.uid)
    deathSpectacle(e.x, e.y, g, [STORM, 0xbfe8ff, SCALE_L], 90, 1.4)
}

function segmentUpdate(e: Enemy, g: GameApi, dt: number): void {
    const head = wyrms.get(num(e, 'head'))
    if (!head || head.dead) {
        if (!e.dead) {
            g.particles(e.x, e.y, { count: 14, color: STORM, speed: 220, life: 0.5, size: 5 })
            e.dead = true
            links.delete(e.uid)
        }
        return
    }
    // Damage taken by the body is passed on to the head at a discount (piercing
    // and area weapons hit many segments at once); the final blow must land on
    // the head itself
    if (e.hp < e.maxHp) {
        const lost = (e.maxHp - e.hp) * 0.6
        head.hp = Math.max(1, head.hp - lost)
        e.hp = e.maxHp
    }
    e.untargetable = head.untargetable
    const prevId = num(e, 'prev')
    const prev = prevId === head.uid ? head : links.get(prevId) ?? head
    const dx = prev.x - e.x
    const dy = prev.y - e.y
    const d = Math.hypot(dx, dy) || 1
    const gap = num(e, 'idx') >= 11 ? 40 : 48
    if (d > gap) place(e, g, prev.x - (dx / d) * gap, prev.y - (dy / d) * gap, dt)
    else place(e, g, e.x + (dx / d) * 0.01, e.y + (dy / d) * 0.01, dt)
    e.facing = dx < 0 ? -1 : 1
}

// ─── 4. Lich King (12:00) ────────────────────────────────────────────────

const NECRO = 0xb06bff
const ROBE = 0x2a1840
const FROST = 0x9fe8ff

function drawLich(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const w = Math.sin(ph)
    const pulse = 0.5 + 0.5 * Math.sin(ph)
    P.ellipse(0, 92, 60, 10, 0x000000, 0.3)
    // rune circle
    P.ring(0, 0, 86, NECRO, 2.5, 0.35)
    P.ring(0, 0, 78, NECRO, 1.2, 0.25)
    for (let i = 0; i < 6; i++) {
        const a = ph / 6 + (i * TAU) / 6
        const x = Math.cos(a) * 82
        const y = Math.sin(a) * 82
        P.shape([x, y - 6, x + 4, y, x, y + 6, x - 4, y], NECRO, OUTLINE, 1.5)
    }
    P.halo(0, 0, 70, NECRO, 0.14 + pulse * 0.05)
    // cape and robe
    P.shape([-30, -40, -58, 10, -54, 50 + w * 4, -64, 80, -40, 70 + w * 3, -30, 86, -12, 74, 0, 88 - w * 3, 14, 74, 30, 86, 38, 66, 46, 30, 30, -40], ROBE, OUTLINE, 3.5)
    P.shape([-18, -30, -26, 40, -14, 70, 0, 60, 14, 70, 24, 40, 18, -30], 0x3e2460, OUTLINE, 2.5)
    P.path([-26, 40, -14, 70, 0, 60, 14, 70, 24, 40], 0xf5c451, 2.2)
    P.path([0, -24, 0, 56], 0xf5c451, 1.6, 0.8)
    // ribs under the open robe
    for (let i = 0; i < 3; i++) {
        const y = -18 + i * 10
        g.moveTo(-10, y).quadraticCurveTo(0, y - 4, 10, y).stroke({ color: P.c(BONE), width: 3, cap: 'round' })
    }
    P.halo(0, -4, 12, NECRO, 0.6)
    // pauldrons
    for (const s of [-1, 1]) {
        P.shape([s * 14, -44, s * 34, -54, s * 50, -44, s * 46, -28, s * 26, -26], 0x4a3a6a, OUTLINE, 3)
        P.shape([s * 36, -52, s * 44, -72, s * 46, -48], BONE, OUTLINE, 2)
        P.shape([s * 26, -52, s * 28, -66, s * 32, -52], BONE, OUTLINE, 2)
    }
    // back hand
    P.line(-40, -30, -52, 0 + w * 3, OUTLINE, 8)
    P.line(-40, -30, -52, 0 + w * 3, BONE, 4.5)
    P.halo(-54, 4 + w * 3, 14, FROST, 0.6)
    P.circle(-54, 4 + w * 3, 4, 0xe8fbff)
    // skull and crown
    const sy = -56 + w * 1.5
    P.disc(4, sy, 18, BONE, OUTLINE, 3)
    P.ellipse(-2, sy - 8, 9, 5, 0xffffff, 0.45)
    P.shape([-6, sy + 8, 16, sy + 8, 18, sy + 20, 4, sy + 24, -6, sy + 18], shade(BONE, 0.88), OUTLINE, 2.5)
    for (let i = 0; i < 5; i++) P.line(-3 + i * 4.5, sy + 9, -3 + i * 4.5, sy + 15, OUTLINE, 1.3)
    P.ellipse(11, sy - 1, 5, 6, 0x0a0614)
    P.ellipse(-3, sy - 1, 4.5, 5.5, 0x0a0614)
    P.eye(11, sy - 1, 3.2, NECRO)
    P.eye(-3, sy - 1, 2.8, NECRO)
    P.poly([4, sy + 4, 1, sy + 8, 7, sy + 8], 0x0a0614)
    P.shape([-14, sy - 12, -16, sy - 34, -8, sy - 20, -2, sy - 40, 4, sy - 22, 12, sy - 40, 16, sy - 20, 24, sy - 34, 22, sy - 12], 0xf5c451, OUTLINE, 2.5)
    for (const [x, y] of [[-2, sy - 30], [12, sy - 30], [5, sy - 18]] as const) P.eye(x, y, 2.2, 0x63c7ff)
    // staff
    const tx = 46
    P.line(tx, 80, tx + 6, -70, OUTLINE, 7)
    P.line(tx, 80, tx + 6, -70, 0x4a3a6a, 4)
    P.line(30, -26, tx + 3, -18, OUTLINE, 8)
    P.line(30, -26, tx + 3, -18, BONE, 4.5)
    P.shape([tx - 6, -66, tx + 6, -78, tx + 18, -66, tx + 6, -60], BONE, OUTLINE, 2)
    P.halo(tx + 6, -84, 26 + pulse * 6, NECRO, 0.55)
    P.disc(tx + 6, -84, 10, 0xe9e4d4, OUTLINE, 2.5)
    P.ellipse(tx + 9, -85, 2.6, 3, 0x0a0614)
    P.ellipse(tx + 3, -85, 2.4, 3, 0x0a0614)
    P.eye(tx + 9, -85, 1.6, NECRO)
    P.eye(tx + 3, -85, 1.4, NECRO)
    // soul wisps
    for (let i = 0; i < 4; i++) {
        const a = ph / 2 + (i * TAU) / 4
        P.halo(Math.cos(a) * 62, Math.sin(a) * 30 + 10, 8, FROST, 0.5)
    }
}

function drawPhylactery(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const ph = (frame / 6) * TAU
    const bob = Math.sin(ph) * 2
    P.ellipse(0, 26, 14, 4, 0x000000, 0.3)
    P.halo(0, bob, 30, NECRO, 0.35)
    P.ring(0, bob, 22, NECRO, 1.5, 0.5)
    P.shape([0, -24 + bob, 12, -4 + bob, 8, 18 + bob, -8, 18 + bob, -12, -4 + bob], 0x6a3aa0, OUTLINE, 2.5)
    P.poly([0, -24 + bob, 12, -4 + bob, 0, 0 + bob], 0xc8a0ff, 0.8)
    P.poly([0, 0 + bob, -12, -4 + bob, -8, 18 + bob], 0x3a1a60, 0.7)
    P.halo(0, -2 + bob, 10, 0xffffff, 0.6)
    P.eye(0, -2 + bob, 3.2, NECRO)
    for (let i = 0; i < 3; i++) {
        const a = ph + (i * TAU) / 3
        P.circle(Math.cos(a) * 18, Math.sin(a) * 6 + bob, 2.2, FROST)
    }
}

const phylacteries = new Map<number, Enemy>()

function lichAttacks(phase: number): Attack[] {
    const shielded = phase === 1
    const doom = phase >= 2
    const list: Attack[] = [
        {
            id: 'spiral', weight: 3,
            run(e, _g) {
                const base = rand(0, TAU)
                const arms = doom ? 6 : 4
                const dir = chance(0.5) ? 1 : -1
                emit(e, doom ? 3.4 : 2.8, 0.11, (ee, gg, i) => {
                    for (let k = 0; k < arms; k++) shoot(gg, ee.x, ee.y, base + dir * i * 0.19 + (k * TAU) / arms, orb(ee, 165, NECRO, { radius: 9 }))
                    if (i % 5 === 0) gg.sfx.play('enemyShot', { volume: 0.35, pitch: 0.7 })
                })
                return 3.2
            }
        },
        {
            id: 'souls', weight: 2.5,
            run(e, g) {
                const n = doom ? 9 : 6
                const a = aim(e, g).angle
                for (let i = 0; i < n; i++) {
                    shoot(g, e.x, e.y, a + Math.PI + (i - (n - 1) / 2) * 0.35, orb(e, 230, FROST, { radius: 10, homing: 1.4, life: 4.5 }))
                }
                g.sfx.play('frost', { volume: 0.6, pitch: 0.7 })
                return 2.4
            }
        },
        {
            id: 'nova', weight: 2,
            run(e, g) {
                const r = doom ? 260 : 210
                g.telegraphCircle({ x: e.x, y: e.y, radius: r, delay: 1.2, damage: e.damage, color: FROST })
                g.sfx.play('telegraph', { volume: 0.6, pitch: 0.5 })
                later(1.2, gg => {
                    if (!alive(e)) return
                    ring(gg, e.x, e.y, doom ? 32 : 24, rand(0, TAU), orb(e, 200, FROST, { radius: 8, kind: 'spike' }))
                    gg.shake(0.4)
                    gg.flash(FROST, 0.2)
                    gg.sfx.play('frost', { volume: 0.8, pitch: 0.5 })
                })
                return 2.6
            }
        },
        {
            id: 'raise', weight: 1.5,
            run(e, g) {
                const n = doom ? 10 : 8
                const off = rand(0, TAU)
                for (let i = 0; i < n; i++) {
                    const a = off + (i / n) * TAU
                    const x = g.player.x + Math.cos(a) * 240
                    const y = g.player.y + Math.sin(a) * 240
                    g.particles(x, y, { count: 12, color: NECRO, speed: 140, life: 0.6, size: 5 })
                    later(0.45, gg => {
                        if (alive(e)) summon(gg, pick(['archer', 'ghoul', 'knight', 'skull']), x, y, minionMul(gg))
                    })
                }
                g.sfx.play('summon', { volume: 0.7, pitch: 0.6 })
                return 2.6
            }
        },
        {
            id: 'bonerain', weight: 2,
            run(e, g) {
                const ox = g.player.x
                const oy = g.player.y
                const shift = rand(0, 1) < 0.5 ? 0 : 60
                for (let ix = -3; ix <= 3; ix++) {
                    for (let iy = -2; iy <= 2; iy++) {
                        if ((ix + iy) % 2 !== 0) continue
                        g.telegraphCircle({ x: ox + ix * 120 + shift, y: oy + iy * 120, radius: 50, delay: 1 + Math.abs(ix) * 0.08, damage: e.damage * 0.8, color: NECRO })
                    }
                }
                g.sfx.play('telegraph', { volume: 0.6, pitch: 1.2 })
                return 2.4
            }
        }
    ]
    if (shielded || doom) list.push({
        id: 'blink', weight: 2,
        run(e, g) {
            blink(e, g)
            later(0.3, gg => {
                if (alive(e)) ring(gg, e.x, e.y, 20, rand(0, TAU), orb(e, 190, NECRO, { radius: 9 }))
            })
            return 1.6
        }
    })
    return list
}

function blink(e: Enemy, g: GameApi): void {
    g.particles(e.x, e.y, { count: 30, color: NECRO, speed: 260, life: 0.5, size: 5 })
    const p = nearPlayer(g, 260, 340)
    teleport(e, p.x, p.y)
    g.particles(e.x, e.y, { count: 30, color: NECRO, speed: 260, life: 0.5, size: 5 })
    g.sfx.play('dash', { pitch: 0.6, volume: 0.7, pan: panOf(e, g) })
}

function lichUpdate(e: Enemy, g: GameApi, dt: number): void {
    tickEmitters(e, g, dt)
    const phase = phases(e, [0.5, 0.2], p => {
        if (p === 1) {
            roar(e, g, 'UNDYING', NECRO, 0.9)
            e.ai.shield = 25
            const off = rand(0, TAU)
            const mul = Math.max(1, e.maxHp / 50000)
            for (let i = 0; i < 4; i++) {
                const a = off + (i / 4) * TAU
                const ph = summon(g, 'phylactery', g.player.x + Math.cos(a) * 280, g.player.y + Math.sin(a) * 280, mul)
                if (ph) {
                    ph.ai.lich = e.uid
                    phylacteries.set(ph.uid, ph)
                }
            }
        } else {
            roar(e, g, 'DEATH COMES', NECRO, 1)
            ring(g, e.x, e.y, 36, 0, orb(e, 240, NECRO))
        }
        e.ai.atk = 1
    })
    // phylactery shield
    if (num(e, 'shield') > 0) {
        const left = [...phylacteries.values()].filter(p => p.ai.lich === e.uid && !p.dead)
        const t = tick(e, 'shield', dt)
        e.untargetable = true
        e.alpha = 0.45 + Math.sin(e.age * 10) * 0.1
        if (!left.length || t <= 0) {
            e.ai.shield = 0
            e.untargetable = false
            e.alpha = 1
            for (const p of left) {
                p.dead = true
                phylacteries.delete(p.uid)
            }
            g.announce('PHYLACTERIES SHATTER', FROST)
            g.flash(0xffffff, 0.4)
            g.shake(0.5)
            g.sfx.play('explosion', { pitch: 0.6 })
            g.particles(e.x, e.y, { count: 60, color: FROST, speed: 380, life: 0.8, size: 6 })
            e.ai.atk = 3
            e.ai.dazed = 3
        }
    }
    if (tick(e, 'dazed', dt) > 0) {
        e.scale = 1 - 0.04 * Math.abs(Math.sin(e.age * 6))
        return
    }
    if (tick(e, 'intro', dt) > 0) return
    kite(e, g, dt, 230, 360, 0.5)
    if (tick(e, 'blinkCd', dt) <= 0 && phase >= 1) {
        e.ai.blinkCd = rand(6, 9)
        if (aim(e, g).dist > 520) blink(e, g)
    }
    attackClock(e, g, dt, lichAttacks(phase), num(e, 'shield') > 0 ? 0.75 : phase >= 2 ? 0.65 : 1)
}

function phylacteryUpdate(e: Enemy, g: GameApi, dt: number): void {
    if (tick(e, 'cd', dt) <= 0) {
        e.ai.cd = rand(2.6, 3.4)
        ring(g, e.x, e.y, 10, rand(0, TAU), { speed: 120, damage: e.damage * 0.6, color: NECRO, radius: 8, life: 4 })
    }
    if (chance(dt * 8)) g.particles(e.x, e.y, { count: 1, color: NECRO, speed: 40, life: 0.6, size: 4 })
}

function phylacteryDeath(e: Enemy, g: GameApi): void {
    phylacteries.delete(e.uid)
    g.particles(e.x, e.y, { count: 40, color: NECRO, speed: 320, life: 0.7, size: 6 })
    g.shake(0.3)
    g.sfx.play('legendary', { volume: 0.4, pitch: 0.6 })
}

// ─── 5. Rift Heart (15:00, final) ────────────────────────────────────────

const RIFT = 0xff3fa4
const VOID = 0x14061f
const RIFT_C = 0x6af0ff

function drawHeart(g: Graphics, frame: number, white: boolean): void {
    const P = pen(g, white)
    const beat = [1.08, 0.97, 1.04, 0.98, 1, 0.99, 1, 1][frame] ?? 1
    const ph = (frame / 8) * TAU
    // outer rift ring
    P.halo(0, 0, 128, RIFT, 0.16)
    const jag: number[] = []
    for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU + ph / 7
        const r = (i % 2 ? 100 : 116) * (0.98 + 0.03 * Math.sin(i * 3 + ph))
        jag.push(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.poly(jag).stroke({ color: P.c(RIFT), width: 3, alpha: 0.7, join: 'round' })
    // void tendrils
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2
        const sw = Math.sin(ph + i * 1.3) * 0.25
        const x1 = Math.cos(a) * 50
        const y1 = Math.sin(a) * 50
        const cx = Math.cos(a + sw) * 86
        const cy = Math.sin(a + sw) * 86
        const x2 = Math.cos(a - sw) * 112
        const y2 = Math.sin(a - sw) * 112
        g.moveTo(x1, y1).quadraticCurveTo(cx, cy, x2, y2).stroke({ color: P.c(OUTLINE), width: 11, cap: 'round' })
        g.moveTo(x1, y1).quadraticCurveTo(cx, cy, x2, y2).stroke({ color: P.c(0x5a1a6a), width: 7, cap: 'round' })
        P.circle(x2, y2, 4, RIFT, 0.9)
    }
    // heart body: two lobes and a point, crystalline
    const s = 62 * beat
    const pts: number[] = []
    for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * TAU
        const x = 16 * Math.sin(t) ** 3
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
        pts.push((x / 16) * s, (y / 16) * s + 4)
    }
    P.halo(0, 0, s * 1.4, RIFT, 0.4)
    P.shape(pts, 0x8a1a5a, OUTLINE, 4)
    P.poly(pts.map((v, i) => (i % 2 === 0 ? v * 0.82 : v * 0.82 - 4)), 0xc22a7a, 0.9)
    // veins
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.5
        P.path([0, 0, Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.4, Math.cos(a + 0.3) * s * 0.7, Math.sin(a + 0.3) * s * 0.6], RIFT, 3, 0.9)
    }
    // crystal facets
    for (const [x, y, r, a] of [[-34, -30, 18, -0.6], [34, -30, 18, 0.6], [-10, -46, 14, -0.2], [12, -48, 12, 0.3]] as const) {
        const tx = x + Math.sin(a) * r
        const ty = y - Math.cos(a) * r
        P.shape([x - 6, y + 4, tx, ty, x + 6, y + 4], RIFT_C, 0x1a5a70, 2)
        P.poly([x - 1, y + 3, tx, ty, x + 3, y + 3], 0xe0ffff, 0.8)
    }
    // the eye
    const er = 30 * beat
    P.oval(0, 2, er * 1.2, er * 0.82, 0xf8e8ff, OUTLINE, 3)
    P.halo(0, 2, er, RIFT, 0.5)
    P.disc(0, 2, er * 0.62, RIFT, OUTLINE, 2)
    P.ring(0, 2, er * 0.45, 0xffa0dc, 2, 0.8)
    P.oval(0, 2, er * 0.14, er * 0.5, VOID, VOID, 1)
    P.circle(-er * 0.25, -er * 0.2, er * 0.14, 0xffffff)
    // orbiting shards (8-fold, seamless)
    for (let i = 0; i < 8; i++) {
        const a = ph / 8 + (i * TAU) / 8
        const x = Math.cos(a) * 92
        const y = Math.sin(a) * 92
        P.halo(x, y, 12, RIFT_C, 0.4)
        P.shape([x + Math.cos(a) * 10, y + Math.sin(a) * 10, x - Math.sin(a) * 5, y + Math.cos(a) * 5, x - Math.cos(a) * 8, y - Math.sin(a) * 8, x + Math.sin(a) * 5, y - Math.cos(a) * 5], RIFT_C, 0x1a5a70, 1.8)
    }
}

function heartAttacks(phase: number): Attack[] {
    const p = phase
    const list: Attack[] = [
        {
            id: 'rings', weight: 3,
            run(e, _g) {
                const waves = 3 + Math.min(2, p)
                const base = rand(0, TAU)
                for (let w = 0; w < waves; w++) {
                    later(w * 0.42, gg => {
                        if (!alive(e)) return
                        ring(gg, e.x, e.y, 26 + p * 4, base + (w % 2) * 0.12, orb(e, 210 + p * 15, w % 2 ? RIFT_C : RIFT), base + w * 0.9, 0.55)
                        gg.sfx.play('enemyShot', { volume: 0.5, pitch: 0.6 })
                    })
                }
                return 2.4
            }
        },
        {
            id: 'helix', weight: 3,
            run(e, _g) {
                const base = rand(0, TAU)
                emit(e, 3.6, p >= 2 ? 0.07 : 0.09, (ee, gg, i) => {
                    shoot(gg, ee.x, ee.y, base + i * 0.23, orb(ee, 185, RIFT, { radius: 9 }))
                    shoot(gg, ee.x, ee.y, base - i * 0.23 + Math.PI, orb(ee, 185, RIFT_C, { radius: 9 }))
                    if (p >= 1) shoot(gg, ee.x, ee.y, base + i * 0.23 + Math.PI, orb(ee, 185, RIFT, { radius: 9 }))
                    if (p >= 3) shoot(gg, ee.x, ee.y, base - i * 0.23, orb(ee, 185, RIFT_C, { radius: 9 }))
                    if (i % 5 === 0) gg.sfx.play('enemyShot', { volume: 0.3, pitch: 0.9 })
                })
                return 4
            }
        },
        {
            id: 'shotgun', weight: 2.5,
            run(e, _g) {
                for (let v = 0; v < 3 + (p >= 2 ? 1 : 0); v++) {
                    later(v * 0.35, gg => {
                        if (!alive(e)) return
                        fan(gg, e.x, e.y, aim(e, gg).angle, 9, 0.95, orb(e, 300, RIFT, { radius: 9 }))
                        gg.sfx.play('shootHeavy', { volume: 0.4, pitch: 0.7 })
                    })
                }
                return 2.2
            }
        },
        {
            id: 'beams', weight: 2.5,
            run(e, g) {
                const spokes = 6 + p
                const base = aim(e, g).angle + Math.PI / spokes
                const dir = chance(0.5) ? 1 : -1
                for (let v = 0; v < 4; v++) {
                    const off = base + dir * v * 0.22
                    for (let k = 0; k < spokes; k++) {
                        const a = off + (k / spokes) * TAU
                        g.telegraphLine({ x1: e.x, y1: e.y, x2: e.x + Math.cos(a) * 1100, y2: e.y + Math.sin(a) * 1100, width: 34, delay: 1.1 + v * 0.38, damage: e.damage, color: RIFT })
                    }
                    later(1.1 + v * 0.38, gg => {
                        gg.sfx.play('laser', { volume: 0.5, pitch: 0.5 + v * 0.1 })
                        gg.shake(0.15)
                    })
                }
                g.sfx.play('telegraph', { volume: 0.7, pitch: 0.5 })
                return 3.4
            }
        },
        {
            id: 'meteors', weight: 2,
            run(e, g) {
                const n = 12 + p * 3
                for (let i = 0; i < n; i++) {
                    const pos = i < 2 ? lead(g, 0.8) : nearPlayer(g, 30, 360)
                    const delay = 1.1 + (i / n) * 1
                    g.telegraphCircle({ x: pos.x, y: pos.y, radius: 70, delay, damage: e.damage * 0.9, color: 0xff7a1a })
                    later(delay, gg => {
                        gg.particles(pos.x, pos.y, { count: 18, color: 0xff7a1a, speed: 300, life: 0.5, size: 6 })
                        if (p >= 2) ring(gg, pos.x, pos.y, 6, rand(0, TAU), { speed: 160, damage: e.damage * 0.4, color: 0xffa02b, radius: 7, kind: 'fire', life: 1.6 })
                        if (i % 3 === 0) {
                            gg.shake(0.2)
                            gg.sfx.play('explosion', { volume: 0.4, pitch: rand(0.8, 1.2) })
                        }
                    })
                }
                return 3
            }
        },
        {
            id: 'bleed', weight: 1.2,
            run(e, g) {
                const pool = ['knight', 'brute', 'golem', 'gazer', 'drone']
                const n = 3 + Math.min(3, p)
                if (!flag(e, 'bled')) g.announce('RIFT BLEEDS', RIFT)
                e.ai.bled = true
                for (let i = 0; i < n; i++) {
                    const pos = nearPlayer(g, 320, 380)
                    g.particles(pos.x, pos.y, { count: 20, color: RIFT, speed: 200, life: 0.6, size: 5 })
                    later(0.5, gg => {
                        if (alive(e)) gg.spawn(pick(pool), pos.x, pos.y, { elite: true, hpMul: hpCurve(gg.time) })
                    })
                }
                g.sfx.play('spawnElite')
                return 2.6
            }
        }
    ]
    if (p >= 2) list.push({
        id: 'void', weight: 2,
        run(e, g) {
            ring(g, e.x, e.y, 10, rand(0, TAU), orb(e, 140, VOID, { radius: 13, homing: 0.9, life: 5 }))
            ring(g, e.x, e.y, 24, rand(0, TAU), orb(e, 240, RIFT_C, { radius: 7 }))
            g.sfx.play('summon', { volume: 0.6, pitch: 0.5 })
            return 2
        }
    })
    return list
}

function heartUpdate(e: Enemy, g: GameApi, dt: number): void {
    tickEmitters(e, g, dt)
    const phase = phases(e, [0.7, 0.4, 0.15], p => {
        const text = p === 1 ? 'HEARTBEAT QUICKENS' : p === 2 ? 'REALITY FRACTURES' : 'COLLAPSE'
        roar(e, g, text, RIFT, 0.8 + p * 0.2)
        for (let k = 0; k < 3; k++) later(k * 0.25, gg => ring(gg, e.x, e.y, 30, k * 0.1, orb(e, 260, k % 2 ? RIFT_C : RIFT), aim(e, gg).angle, 0.7))
        e.ai.atk = 1.6
        e.untargetable = true
        later(1.2, () => {
            e.untargetable = false
        })
    })
    if (tick(e, 'beat', dt) <= 0) {
        e.ai.beat = phase >= 3 ? 0.55 : phase >= 1 ? 0.8 : 1.1
        g.particles(e.x, e.y, { count: 10, color: RIFT, speed: 240, life: 0.5, size: 5 })
        if (Math.hypot(g.player.x - e.x, g.player.y - e.y) < g.view.width) g.shake(0.05)
    }
    if (tick(e, 'intro', dt) > 0) return
    const a = aim(e, g)
    if (a.dist > 340) g.chase(e, dt, a.dist > 800 ? 3 : 1)
    else move(e, g, -a.ny * e.speed * 0.6, a.nx * e.speed * 0.6, dt)
    attackClock(e, g, dt, heartAttacks(phase), [1, 0.85, 0.7, 0.55][phase] ?? 0.55)
}

function heartDeath(e: Enemy, g: GameApi): void {
    clearEmitters(e)
    deathSpectacle(e.x, e.y, g, [RIFT, RIFT_C, 0xffffff, 0xb06bff], 160, 2.4, true)
    // the horde collapses with its heart, in a ripple outward
    for (const other of g.enemies) {
        if (other === e || other.dead) continue
        const d = Math.hypot(other.x - e.x, other.y - e.y)
        later(0.3 + Math.min(2.2, d / 900), gg => {
            if (other.dead) return
            gg.particles(other.x, other.y, { count: 8, color: RIFT, speed: 180, life: 0.5, size: 4 })
            other.dead = true
        })
    }
}

// ─── Intros ──────────────────────────────────────────────────────────────

function bossIntro(e: Enemy, g: GameApi, text: string, color: number): void {
    e.ai.intro = 2.2
    e.ai.atk = 0.6
    e.ai.phase = 0
    e.ai.st = ''
    g.announce(text, color)
    g.sfx.play('bossRoar')
    g.shake(0.8)
    g.flash(color, 0.3)
    g.particles(e.x, e.y, { count: 80, color, speed: 460, life: 1, size: 7 })
}

function standardDeath(colors: number[], spread: number) {
    return (e: Enemy, g: GameApi) => {
        clearEmitters(e)
        deathSpectacle(e.x, e.y, g, colors, spread, 1.5)
    }
}

// ─── Defs ────────────────────────────────────────────────────────────────

export const BOSS_DEFS: Record<string, EnemyDef> = {
    boneColossus: {
        id: 'boneColossus', name: 'Bone Colossus', hp: 6000, speed: 50, damage: 24, radius: 62, xp: 150, mass: 10,
        size: 260, frames: 8, frameRate: 7, glow: SOUL, boss: true,
        draw: drawColossus,
        init: (e, g) => bossIntro(e, g, 'BONE COLOSSUS', SOUL),
        update: colossusUpdate,
        onDeath: standardDeath([SOUL, BONE, 0xffffff], 100)
    },
    hiveQueen: {
        id: 'hiveQueen', name: 'Hive Queen', hp: 15000, speed: 70, damage: 26, radius: 64, xp: 250, mass: 10,
        size: 260, frames: 6, frameRate: 12, glow: ACID, boss: true,
        draw: drawQueen,
        init: (e, g) => bossIntro(e, g, 'HIVE QUEEN', ACID),
        update: queenUpdate,
        onDeath: (e, g) => {
            clearEmitters(e)
            for (const o of g.enemies) {
                if (o.def.id === 'broodEgg' && !o.dead) {
                    g.particles(o.x, o.y, { count: 10, color: ACID, speed: 160, life: 0.4, size: 4 })
                    o.dead = true
                }
            }
            deathSpectacle(e.x, e.y, g, [ACID, AMBER, 0xffffff], 110, 1.5)
        }
    },
    broodEgg: {
        id: 'broodEgg', name: 'Brood Egg', hp: 60, speed: 0, damage: 6, radius: 15, xp: 1, mass: 50,
        size: 48, frames: 4, frameRate: 6, glow: ACID,
        draw: drawEgg,
        init: e => {
            e.ai.hatch = rand(3.4, 4.2)
        },
        update: eggUpdate
    },
    stormWyrm: {
        id: 'stormWyrm', name: 'Storm Wyrm', hp: 30000, speed: 150, damage: 30, radius: 48, xp: 350, mass: 12,
        size: 180, frames: 6, frameRate: 14, glow: STORM, boss: true, rotate: true,
        draw: drawWyrmHead,
        init: wyrmInit,
        update: wyrmUpdate,
        onDeath: wyrmDeath
    },
    wyrmSegment: {
        id: 'wyrmSegment', name: 'Storm Wyrm', hp: 100000, speed: 150, damage: 20, radius: 34, xp: 0, mass: 60,
        size: 110, frames: 4, frameRate: 8, glow: STORM, rotate: true,
        draw: drawWyrmSegment,
        update: segmentUpdate
    },
    wyrmTail: {
        id: 'wyrmTail', name: 'Storm Wyrm', hp: 100000, speed: 150, damage: 16, radius: 24, xp: 0, mass: 60,
        size: 100, frames: 4, frameRate: 8, glow: STORM, rotate: true,
        draw: drawWyrmTail,
        update: segmentUpdate
    },
    lichKing: {
        id: 'lichKing', name: 'Lich King', hp: 50000, speed: 62, damage: 34, radius: 52, xp: 450, mass: 10,
        size: 200, frames: 6, frameRate: 8, glow: NECRO, boss: true,
        draw: drawLich,
        init: (e, g) => {
            bossIntro(e, g, 'LICH KING', NECRO)
            e.ai.blinkCd = 6
        },
        update: lichUpdate,
        onDeath: (e, g) => {
            clearEmitters(e)
            for (const p of phylacteries.values()) p.dead = true
            phylacteries.clear()
            deathSpectacle(e.x, e.y, g, [NECRO, FROST, 0xffffff], 110, 1.6)
        }
    },
    phylactery: {
        id: 'phylactery', name: 'Phylactery', hp: 1800, speed: 0, damage: 10, radius: 20, xp: 5, mass: 50,
        size: 72, frames: 6, frameRate: 8, glow: NECRO,
        draw: drawPhylactery,
        init: e => {
            e.ai.cd = rand(1, 2)
        },
        update: phylacteryUpdate,
        onDeath: phylacteryDeath
    },
    riftHeart: {
        id: 'riftHeart', name: 'The Rift Heart', hp: 120000, speed: 40, damage: 40, radius: 80, xp: 1000, mass: 20,
        size: 260, frames: 8, frameRate: 10, glow: RIFT, boss: true, final: true,
        draw: drawHeart,
        init: (e, g) => {
            bossIntro(e, g, 'THE RIFT HEART', RIFT)
            e.ai.intro = 3
            g.flash(0xffffff, 0.6)
        },
        update: heartUpdate,
        onDeath: heartDeath
    }
}

/** Boss ids in RIFTBORN_BOSS_TIMES order */
export const BOSS_ORDER = ['boneColossus', 'hiveQueen', 'stormWyrm', 'lichKing', 'riftHeart'] as const

/** Called by the director when a new run starts */
export function resetBossState(): void {
    wyrms.clear()
    links.clear()
    phylacteries.clear()
}
