/*
 * Shared helpers for enemy and boss AI: scratch-field access, geometry,
 * bullet patterns and a small timeline for delayed effects (egg hatches,
 * boss death cascades) that the director ticks every frame.
 */
import { randomFloat } from '#shared/utils/random'
import type { Enemy, EnemyShot, GameApi } from './types'

export const TAU = Math.PI * 2

export function rand(min = 0, max = 1): number {
    return min + randomFloat() * (max - min)
}

export function chance(p: number): boolean {
    return randomFloat() < p
}

export function pick<T>(items: readonly T[]): T {
    return items[Math.floor(randomFloat() * items.length)]!
}

/** Number scratch field with a default */
export function num(e: Enemy, key: string, fallback = 0): number {
    const v = e.ai[key]
    return typeof v === 'number' ? v : fallback
}

export function flag(e: Enemy, key: string): boolean {
    return e.ai[key] === true
}

/** Count a scratch timer down, returns the new value */
export function tick(e: Enemy, key: string, dt: number): number {
    const v = num(e, key) - dt
    e.ai[key] = v
    return v
}

export interface Aim {
    dx: number
    dy: number
    dist: number
    /** Unit vector to the player */
    nx: number
    ny: number
    angle: number
}

export function aim(e: Enemy, g: GameApi): Aim {
    const dx = g.player.x - e.x
    const dy = g.player.y - e.y
    const dist = Math.hypot(dx, dy) || 0.0001
    return { dx, dy, dist, nx: dx / dist, ny: dy / dist, angle: Math.atan2(dy, dx) }
}

/** Where the player will be in `t` seconds if they keep moving */
export function lead(g: GameApi, t: number): { x: number, y: number } {
    return { x: g.player.x + g.player.vx * t, y: g.player.y + g.player.vy * t }
}

// The engine either integrates e.vx/e.vy itself or moves enemies directly in
// g.chase. We probe chase once and follow whichever convention it uses, so
// custom AI never double-moves or freezes.
let integrates: boolean | null = null
let chaseSetsVelocity = false

function probe(e: Enemy, g: GameApi, dt: number): void {
    if (e.stunT > 0 || dt <= 0) return
    const x = e.x
    const y = e.y
    const vx = e.vx
    const vy = e.vy
    g.chase(e, dt)
    const moved = Math.abs(e.x - x) + Math.abs(e.y - y) > 1e-7
    const steered = Math.abs(e.vx - vx) + Math.abs(e.vy - vy) > 1e-7
    e.x = x
    e.y = y
    e.vx = vx
    e.vy = vy
    if (moved) {
        integrates = false
        chaseSetsVelocity = steered
    } else if (steered) {
        integrates = true
    }
}

export function resetMotionProbe(): void {
    integrates = null
    chaseSetsVelocity = false
}

/**
 * Move an enemy by a velocity for this frame. Custom AI uses this instead of
 * g.chase when it needs a dash, an orbit or a retreat.
 */
export function move(e: Enemy, g: GameApi, vx: number, vy: number, dt: number): void {
    if (integrates === null) probe(e, g, dt)
    if (Math.abs(vx) > 1) e.facing = vx < 0 ? -1 : 1
    if (e.stunT > 0) {
        if (integrates) {
            e.vx = 0
            e.vy = 0
        }
        return
    }
    const slow = e.slowT > 0 ? 0.55 : 1
    if (integrates) {
        e.vx = vx * slow
        e.vy = vy * slow
        return
    }
    e.x += vx * dt * slow
    e.y += vy * dt * slow
    if (chaseSetsVelocity) {
        e.vx = vx * slow
        e.vy = vy * slow
    }
}

/** Put an enemy at an exact spot this frame (segments, teleports) */
export function place(e: Enemy, g: GameApi, x: number, y: number, dt: number): void {
    if (integrates === null) probe(e, g, dt)
    if (integrates && dt > 0) {
        e.vx = (x - e.x) / dt
        e.vy = (y - e.y) / dt
        return
    }
    if (chaseSetsVelocity && dt > 0) {
        e.vx = (x - e.x) / dt
        e.vy = (y - e.y) / dt
    }
    e.x = x
    e.y = y
}

/** Instant teleport, no velocity left behind */
export function teleport(e: Enemy, x: number, y: number): void {
    e.x = x
    e.y = y
    if (integrates) {
        e.vx = 0
        e.vy = 0
    }
}

/** True while the enemy is stunned: AI should skip its attacks */
export function stunned(e: Enemy): boolean {
    return e.stunT > 0
}

/** Keep the enemy at a preferred distance band, strafing around the player */
export function kite(e: Enemy, g: GameApi, dt: number, near: number, far: number, strafe = 0.5): void {
    const a = aim(e, g)
    const dir = num(e, 'strafeDir', 0) || (chance(0.5) ? 1 : -1)
    e.ai.strafeDir = dir
    let fwd = 0
    if (a.dist > far) fwd = 1
    else if (a.dist < near) fwd = -1
    if (fwd === 1 && a.dist > far + 200) {
        g.chase(e, dt)
        return
    }
    const vx = (a.nx * fwd + -a.ny * strafe * dir) * e.speed
    const vy = (a.ny * fwd + a.nx * strafe * dir) * e.speed
    move(e, g, vx, vy, dt)
    e.facing = a.dx < 0 ? -1 : 1
}

/** Distance from the player to the nearest point just outside the view */
export function offscreenRadius(g: GameApi, margin = 80): number {
    return Math.hypot(g.view.width, g.view.height) / 2 + margin
}

// ─── Bullet patterns ─────────────────────────────────────────────────────

export interface ShotStyle {
    speed: number
    damage: number
    color: number
    radius?: number
    life?: number
    kind?: EnemyShot['kind']
    homing?: number
}

export function shoot(g: GameApi, x: number, y: number, angle: number, s: ShotStyle): void {
    g.enemyShot({
        x,
        y,
        vx: Math.cos(angle) * s.speed,
        vy: Math.sin(angle) * s.speed,
        radius: s.radius ?? 8,
        damage: s.damage,
        color: s.color,
        life: s.life ?? 5,
        kind: s.kind ?? 'orb',
        homing: s.homing
    })
}

/** Evenly spaced ring, optionally with a gap the player can slip through */
export function ring(g: GameApi, x: number, y: number, count: number, offset: number, s: ShotStyle, gapAt?: number, gapWidth = 0.5): void {
    for (let i = 0; i < count; i++) {
        const a = offset + (i / count) * TAU
        if (gapAt !== undefined) {
            let d = Math.abs(((a - gapAt) % TAU + TAU) % TAU)
            if (d > Math.PI) d = TAU - d
            if (d < gapWidth / 2) continue
        }
        shoot(g, x, y, a, s)
    }
}

/** A fan of shots centred on an angle */
export function fan(g: GameApi, x: number, y: number, angle: number, count: number, spread: number, s: ShotStyle): void {
    if (count <= 1) {
        shoot(g, x, y, angle, s)
        return
    }
    for (let i = 0; i < count; i++) shoot(g, x, y, angle - spread / 2 + (spread * i) / (count - 1), s)
}

/** Minion spawns inherit the summoner's hp scaling */
export function hpMulOf(e: Enemy): number {
    return Math.max(1, e.maxHp / Math.max(1, e.def.hp)) * (e.elite ? 0.5 : 1)
}

// ─── Timeline: delayed content effects ───────────────────────────────────

interface Pending {
    at: number
    fn: (g: GameApi) => void
}

let pending: Pending[] = []
let clock = 0

/** Run `fn` after `delay` seconds of game time (ticked by the director) */
export function later(delay: number, fn: (g: GameApi) => void): void {
    pending.push({ at: clock + delay, fn })
}

export function tickTimeline(g: GameApi, dt: number): void {
    clock += dt
    if (!pending.length) return
    const due = pending.filter(p => p.at <= clock)
    if (!due.length) return
    pending = pending.filter(p => p.at > clock)
    for (const p of due) {
        try {
            p.fn(g)
        } catch {
            // a broken effect must never take the run down
        }
    }
}

export function resetTimeline(): void {
    pending = []
    clock = 0
}

/** Spawn helper that never throws and tags minions */
export function summon(g: GameApi, id: string, x: number, y: number, hpMul = 1): Enemy | null {
    try {
        return g.spawn(id, x, y, { minion: true, hpMul })
    } catch {
        return null
    }
}

/** Enemy toughness over the run: the director and the bosses' summons share it */
export function hpCurve(t: number): number {
    // Gentler than before: the horde is far denser, so each body stays
    // flimsy and the kill count does the talking
    const m = t / 60
    return 1 + m * 0.22 + (t / 360) ** 2
}

// ─── Emitters: short-lived bullet sources owned by an enemy ──────────────

interface Emitter {
    left: number
    every: number
    acc: number
    i: number
    fire(e: Enemy, g: GameApi, i: number): void
}

const emitters = new WeakMap<Enemy, Emitter[]>()

/** Fire `fire` every `every` seconds for `duration` seconds while `e` lives */
export function emit(e: Enemy, duration: number, every: number, fire: (e: Enemy, g: GameApi, i: number) => void): void {
    const list = emitters.get(e) ?? []
    list.push({ left: duration, every, acc: every, i: 0, fire })
    emitters.set(e, list)
}

export function tickEmitters(e: Enemy, g: GameApi, dt: number): void {
    const list = emitters.get(e)
    if (!list?.length) return
    for (const em of list) {
        em.left -= dt
        em.acc += dt
        while (em.acc >= em.every && em.left > -em.every) {
            em.acc -= em.every
            em.fire(e, g, em.i++)
        }
    }
    emitters.set(e, list.filter(em => em.left > 0))
}

export function clearEmitters(e: Enemy): void {
    emitters.delete(e)
}

// ─── Speed buffs (Grave Herald banners, champion war cries) ──────────────

/** Speed an enemy up for `dur` seconds; refreshing never stacks the bonus */
export function buff(e: Enemy, g: GameApi, mul: number, dur: number): void {
    if (e.boss || e.dead) return
    if (typeof e.ai.bfMul !== 'number') {
        e.ai.bfMul = mul
        e.speed *= mul
    }
    e.ai.bfT = g.time + dur
}

/** Reverts expired buffs and sparkles the live ones (the director calls it) */
export function tickBuffs(g: GameApi, dt: number): void {
    for (const e of g.enemies) {
        const until = e.ai.bfT
        if (typeof until !== 'number' || e.dead) continue
        if (g.time >= until) {
            // Multipliers, not stored speeds, so overlapping buffs unwind cleanly
            if (typeof e.ai.bfMul === 'number' && e.ai.bfMul > 0) e.speed /= e.ai.bfMul
            delete e.ai.bfMul
            delete e.ai.bfT
            continue
        }
        if (chance(dt * 2.5)) g.particles(e.x + rand(-e.radius, e.radius) * 0.6, e.y - e.radius * 0.6, { count: 1, color: 0x7dff9a, speed: 40, life: 0.5, size: 4, angle: -Math.PI / 2, spread: 0.6 })
    }
}

export function panOf(e: { x: number }, g: GameApi): number {
    return Math.max(-1, Math.min(1, (e.x - g.player.x) / Math.max(200, g.view.width / 2)))
}

export function onScreen(e: { x: number, y: number }, g: GameApi, margin = 40): boolean {
    return Math.abs(e.x - g.player.x) < g.view.width / 2 + margin && Math.abs(e.y - g.player.y) < g.view.height / 2 + margin
}
