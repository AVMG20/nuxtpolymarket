import type { DfPlayerSnap, DfSnapshot, DfZombieSnap } from '#shared/utils/dead-front/protocol'
import type { Vec3 } from '#shared/utils/dead-front/types'

// Snapshot buffer and interpolation for remote entities (pure, tested).
// Remote players and zombies render DF_INTERP_DELAY_MS behind the estimated
// server clock; when the next snapshot is late the newest pair extrapolates
// for a short while, then holds.

const MAX_SNAPS = 40
/** Longest extrapolation past the newest snapshot, in seconds. */
export const DF_MAX_EXTRAPOLATE = 0.25

export interface DfBufferedSnap {
    s: DfSnapshot
    zombies: Map<number, DfZombieSnap>
    players: Map<number, DfPlayerSnap>
}

export interface DfSample {
    a: DfBufferedSnap
    b: DfBufferedSnap
    /** 0..1 between a and b; >1 extrapolating past b. */
    alpha: number
    /** Seconds between a and b. */
    span: number
}

/** Shortest-arc angle lerp (radians). */
export function dfLerpAngle(a: number, b: number, t: number): number {
    let d = (b - a) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    else if (d < -Math.PI) d += Math.PI * 2
    return a + d * t
}

export function dfWrapAngle(a: number): number {
    let x = a % (Math.PI * 2)
    if (x > Math.PI) x -= Math.PI * 2
    else if (x < -Math.PI) x += Math.PI * 2
    return x
}

export class DfSnapBuffer {
    readonly snaps: DfBufferedSnap[] = []
    /** Estimated localMs - serverMs. */
    offset: number | null = null
    private readonly sample: DfSample = { a: null as unknown as DfBufferedSnap, b: null as unknown as DfBufferedSnap, alpha: 0, span: 0.05 }

    get latest(): DfBufferedSnap | null {
        return this.snaps[this.snaps.length - 1] ?? null
    }

    /** Adds a snapshot received at local time `nowMs`. Returns false for stale / duplicate ones. */
    push(s: DfSnapshot, nowMs: number): boolean {
        const last = this.latest
        if (last && s.time <= last.s.time) {
            // a restarted clock (new match on the same buffer) resets everything
            if (s.time < last.s.time - 5) this.reset()
            else return false
        }
        const z = new Map<number, DfZombieSnap>()
        for (const e of s.zombies) z.set(e.id, e)
        const p = new Map<number, DfPlayerSnap>()
        for (const e of s.players) p.set(e.pid, e)
        this.snaps.push({ s, zombies: z, players: p })
        if (this.snaps.length > MAX_SNAPS) this.snaps.shift()
        const sample = nowMs - s.time * 1000
        if (this.offset === null) this.offset = sample
        // arrivals earlier than expected pull the estimate in quickly, late ones drift it slowly
        else if (sample < this.offset) this.offset += (sample - this.offset) * 0.3
        else this.offset += (sample - this.offset) * 0.015
        return true
    }

    reset(): void {
        this.snaps.length = 0
        this.offset = null
    }

    /** Server time (seconds) to render remote entities at. */
    renderTime(nowMs: number, delayMs: number): number {
        if (this.offset === null) return 0
        return (nowMs - this.offset - delayMs) / 1000
    }

    /** Finds the pair of snapshots around `t` (server seconds). The returned object is reused. */
    at(t: number): DfSample | null {
        const n = this.snaps.length
        if (n === 0) return null
        const out = this.sample
        if (n === 1) {
            out.a = out.b = this.snaps[0]!
            out.alpha = 1
            out.span = 0.05
            return out
        }
        const first = this.snaps[0]!
        if (t <= first.s.time) {
            out.a = first
            out.b = this.snaps[1]!
            out.span = Math.max(1e-3, out.b.s.time - out.a.s.time)
            out.alpha = 0
            return out
        }
        for (let i = n - 1; i > 0; i--) {
            const a = this.snaps[i - 1]!
            const b = this.snaps[i]!
            if (t >= a.s.time && (t <= b.s.time || i === n - 1)) {
                out.a = a
                out.b = b
                out.span = Math.max(1e-3, b.s.time - a.s.time)
                const over = Math.min(t - b.s.time, DF_MAX_EXTRAPOLATE)
                out.alpha = t <= b.s.time ? (t - a.s.time) / out.span : 1 + Math.max(0, over) / out.span
                return out
            }
        }
        return null
    }

    /** Drops snapshots older than `t` minus a margin (keeps at least two). */
    trim(t: number): void {
        while (this.snaps.length > 2 && this.snaps[1]!.s.time < t - 1) this.snaps.shift()
    }
}

export function dfLerpVec(a: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
    out.x = a.x + (b.x - a.x) * t
    out.y = a.y + (b.y - a.y) * t
    out.z = a.z + (b.z - a.z) * t
    return out
}

function newZombie(): DfZombieSnap {
    return { id: 0, type: 'shambler', pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 1, anim: 'walk' }
}

/**
 * Interpolated zombie list for a sample, written into `pool` (grown as
 * needed, objects reused). Zombies present only in `b` appear at their `b`
 * state; zombies gone from `b` are dropped (the zombie view keeps corpses).
 */
export function dfInterpZombies(sample: DfSample, pool: DfZombieSnap[], out: DfZombieSnap[]): DfZombieSnap[] {
    const { a, b } = sample
    const t = sample.alpha
    out.length = 0
    let i = 0
    for (const zb of b.s.zombies) {
        let z = pool[i]
        if (!z) pool[i] = z = newZombie()
        i++
        const za = a.zombies.get(zb.id)
        z.id = zb.id
        z.type = zb.type
        z.hp = zb.hp
        z.anim = zb.anim
        z.armored = zb.armored
        z.shocked = zb.shocked
        if (za && za !== zb) {
            // a long jump between snapshots (respawn / teleport) snaps instead of sliding
            const dx = zb.pos.x - za.pos.x
            const dz = zb.pos.z - za.pos.z
            if (dx * dx + dz * dz > 25) {
                z.pos.x = zb.pos.x
                z.pos.y = zb.pos.y
                z.pos.z = zb.pos.z
                z.yaw = zb.yaw
            } else {
                dfLerpVec(za.pos, zb.pos, t, z.pos)
                z.yaw = dfLerpAngle(za.yaw, zb.yaw, Math.min(1, t))
            }
        } else {
            z.pos.x = zb.pos.x
            z.pos.y = zb.pos.y
            z.pos.z = zb.pos.z
            z.yaw = zb.yaw
        }
        out.push(z)
    }
    return out
}

export interface DfInterpPlayer {
    pid: number
    pos: Vec3
    /** Horizontal velocity estimate (m/s) for animation. */
    vx: number
    vz: number
    vy: number
    yaw: number
    pitch: number
    flags: number
    snap: DfPlayerSnap
}

export function dfNewInterpPlayer(): DfInterpPlayer {
    return { pid: -1, pos: { x: 0, y: 0, z: 0 }, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, flags: 0, snap: null as unknown as DfPlayerSnap }
}

/** Interpolates one player from a sample into `out`. Returns false if the player isn't in `b`. */
export function dfInterpPlayer(sample: DfSample, pid: number, out: DfInterpPlayer): boolean {
    const pb = sample.b.players.get(pid)
    if (!pb) return false
    const pa = sample.a.players.get(pid) ?? pb
    const t = sample.alpha
    out.pid = pid
    out.snap = pb
    out.flags = t < 0.5 && pa ? pa.flags : pb.flags
    const dx = pb.pos.x - pa.pos.x
    const dy = pb.pos.y - pa.pos.y
    const dz = pb.pos.z - pa.pos.z
    if (dx * dx + dz * dz > 25) {
        out.pos.x = pb.pos.x
        out.pos.y = pb.pos.y
        out.pos.z = pb.pos.z
        out.vx = out.vz = out.vy = 0
    } else {
        dfLerpVec(pa.pos, pb.pos, t, out.pos)
        out.vx = dx / sample.span
        out.vy = dy / sample.span
        out.vz = dz / sample.span
    }
    out.yaw = dfLerpAngle(pa.yaw, pb.yaw, Math.min(1, t))
    out.pitch = pa.pitch + (pb.pitch - pa.pitch) * Math.min(1, t)
    return true
}
