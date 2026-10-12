// Pooled particle system: preallocated structure-of-arrays, reused round-robin, nothing
// allocated after construction. Each particle walks a palette ramp over its life (its colour
// is a palette *index* stepping along RAMP), and is snapped to the grid when drawn. A shard
// (`spawnShard`) keeps one fixed colour instead: a pixel knocked out of a sprite.
//
// Cosmetic only — spread comes from Math.random, which is fine for sparks (CLAUDE.md
// "Randomness": acceptable for cosmetics with no bearing on state).

import { RAMP, RAMP_NAMES, type RampName } from './palette'
import type { Surface } from './surface'

const RAMPS: readonly Uint8Array[] = RAMP_NAMES.map(n => RAMP[n])
const RAMP_ID = Object.fromEntries(RAMP_NAMES.map((n, i) => [n, i])) as Record<RampName, number>
/** The `ramp` slot of a shard: it draws its own `color` for its whole life. */
const FIXED = 255

export class Particles {
    readonly max: number
    private x: Float32Array
    private y: Float32Array
    private vx: Float32Array
    private vy: Float32Array
    private life: Float32Array
    private span: Float32Array
    private grav: Float32Array
    private drag: Float32Array
    private floor: Float32Array
    private ramp: Uint8Array
    private size: Uint8Array
    private color: Uint8Array
    private live: Uint8Array
    private cursor = 0

    constructor(max = 1024) {
        this.max = max
        this.x = new Float32Array(max)
        this.y = new Float32Array(max)
        this.vx = new Float32Array(max)
        this.vy = new Float32Array(max)
        this.life = new Float32Array(max)
        this.span = new Float32Array(max)
        this.grav = new Float32Array(max)
        this.drag = new Float32Array(max)
        this.floor = new Float32Array(max)
        this.ramp = new Uint8Array(max)
        this.size = new Uint8Array(max)
        this.color = new Uint8Array(max)
        this.live = new Uint8Array(max)
    }

    spawn(x: number, y: number, vx: number, vy: number, life: number, ramp: RampName, grav = 0, drag = 0, floor = 0, size = 1): void {
        const i = this.take(x, y, vx, vy, life, grav, drag, floor, size)
        this.ramp[i] = RAMP_ID[ramp]
    }

    /** A chunk of a sprite in one fixed palette colour — what a shattering body breaks into. */
    spawnShard(x: number, y: number, vx: number, vy: number, life: number, color: number, grav = 0, drag = 0, floor = 0, size = 2): void {
        const i = this.take(x, y, vx, vy, life, grav, drag, floor, size)
        this.ramp[i] = FIXED
        this.color[i] = color
    }

    private take(x: number, y: number, vx: number, vy: number, life: number, grav: number, drag: number, floor: number, size: number): number {
        let i = this.cursor
        for (let n = 0; n < this.max; n++) {
            if (!this.live[i]) break
            i = (i + 1) % this.max
        }
        this.cursor = (i + 1) % this.max
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy
        this.life[i] = life; this.span[i] = life; this.grav[i] = grav; this.drag[i] = drag
        this.floor[i] = floor; this.size[i] = size
        this.live[i] = 1
        return i
    }

    /** A radial burst of `n` particles. */
    burst(x: number, y: number, n: number, speed: number, life: number, ramp: RampName, grav = 0, floor = 0, dir = 0, spread = Math.PI * 2): void {
        for (let k = 0; k < n; k++) {
            const a = dir - spread / 2 + Math.random() * spread
            const v = speed * (0.35 + Math.random() * 0.65)
            this.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.6 + Math.random() * 0.4), ramp, grav, 1.5, floor, Math.random() < 0.3 ? 2 : 1)
        }
    }

    update(dt: number): void {
        for (let i = 0; i < this.max; i++) {
            if (!this.live[i]) continue
            const l = this.life[i]! - dt
            if (l <= 0) { this.live[i] = 0; continue }
            this.life[i] = l
            let vx = this.vx[i]!
            let vy = this.vy[i]! + this.grav[i]! * dt
            const d = this.drag[i]!
            if (d > 0) { const k = Math.max(0, 1 - d * dt); vx *= k; vy *= k }
            let y = this.y[i]! + vy * dt
            const f = this.floor[i]!
            if (f > 0 && y > f) { y = f; vy = -vy * 0.35; vx *= 0.6 }
            this.x[i] = this.x[i]! + vx * dt
            this.y[i] = y
            this.vx[i] = vx
            this.vy[i] = vy
        }
    }

    draw(dst: Surface): void {
        for (let i = 0; i < this.max; i++) {
            if (!this.live[i]) continue
            const age = 1 - this.life[i]! / this.span[i]!
            const k = this.ramp[i]!
            let c: number
            let s: number
            if (k === FIXED) {
                // a shard keeps its colour and its size until it has nearly settled
                c = this.color[i]!
                s = age < 0.8 ? this.size[i]! : 1
            } else {
                const r = RAMPS[k]!
                c = r[Math.min(r.length - 1, Math.floor(age * r.length))]!
                s = age < 0.5 ? this.size[i]! : 1
            }
            const px = Math.round(this.x[i]!) - (s >> 1)
            const py = Math.round(this.y[i]!) - (s >> 1)
            for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) dst.set(px + xx, py + yy, c)
        }
    }

    clear(): void {
        this.live.fill(0)
    }
}
