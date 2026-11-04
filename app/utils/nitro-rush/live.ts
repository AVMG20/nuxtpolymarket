/**
 * Live ghosts, client side: the pose frame a car sends, and the buffer that
 * turns other players' 10 Hz poses into a smooth car drawn a little behind.
 * Pure, so it runs in tests; the socket lives in `useNitroRushLive`.
 */

import { findPaint } from './config'
import type { CarPose, GhostFrame } from './types'

/** How far behind a remote car is drawn, so there is usually a pose on each side to blend. */
export const LIVE_DELAY_MS = 120
/** A player who sent nothing for this long is dropped. */
export const LIVE_STALE_MS = 3000
/** How far past its last pose a car may coast when the next one is late. */
const MAX_EXTRAPOLATE_MS = 100
/** Further apart than this between two poses is a reset, not driving: jump instead of sliding there. */
const TELEPORT_M = 50
/** A clock that jumps by more than this (a reload) starts the player's buffer over. */
const CLOCK_JUMP_MS = 1000
/** How quickly the clock offset follows a path that got slower (per pose). */
const OFFSET_RELAX = 0.02
const MAX_FRAMES = 20

/** What the server relays for another player's car. */
export interface LivePoseMsg {
    id: string
    name: string
    paint: string
    /** The sender's clock in ms. */
    at: number
    pose: CarPose
}

const round = (v: number, places: number) => {
    const f = 10 ** places
    return Math.round(v * f) / f
}

/** The pose frame for the socket: centimetres and four-decimal rotation keep it small. */
export function poseMessage(pose: CarPose, paint: string, at: number) {
    return {
        t: 'pose' as const,
        at: Math.round(at),
        paint,
        pose: {
            x: round(pose.x, 2), y: round(pose.y, 2), z: round(pose.z, 2),
            qx: round(pose.qx, 4), qy: round(pose.qy, 4), qz: round(pose.qz, 4), qw: round(pose.qw, 4)
        }
    }
}

/** Blends two poses: lerp for the position, slerp for the rotation (the short way round). */
export function blendPose(a: CarPose, b: CarPose, t: number, out: CarPose): CarPose {
    out.x = a.x + (b.x - a.x) * t
    out.y = a.y + (b.y - a.y) * t
    out.z = a.z + (b.z - a.z) * t
    let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw
    let cos = a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw
    if (cos < 0) {
        cos = -cos
        bx = -bx
        by = -by
        bz = -bz
        bw = -bw
    }
    let wa: number, wb: number
    if (cos > 0.9995) {
        // Nearly the same rotation: a plain lerp, normalized below.
        wa = 1 - t
        wb = t
    } else {
        const angle = Math.acos(cos)
        const sin = Math.sin(angle)
        wa = Math.sin((1 - t) * angle) / sin
        wb = Math.sin(t * angle) / sin
    }
    const qx = a.qx * wa + bx * wb
    const qy = a.qy * wa + by * wb
    const qz = a.qz * wa + bz * wb
    const qw = a.qw * wa + bw * wb
    const len = Math.hypot(qx, qy, qz, qw) || 1
    out.qx = qx / len
    out.qy = qy / len
    out.qz = qz / len
    out.qw = qw / len
    return out
}

interface Sample {
    at: number
    pose: CarPose
}

interface Player {
    frame: GhostFrame
    samples: Sample[]
    /** The pose before `samples[0]`, kept to coast on when the next one is late. */
    prev: Sample | null
    /** Local clock minus the sender's, from the quickest pose seen (drifting up slowly). */
    offset: number
    heardAt: number
}

const copyPose = (p: CarPose): CarPose => ({ x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw })

const dist = (a: CarPose, b: CarPose) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)

/** Other players on the course, each drawn `LIVE_DELAY_MS` behind their latest pose. */
export class LiveGhosts {
    private players = new Map<string, Player>()

    /** Players heard from in the last `LIVE_STALE_MS`, as of the last `frames` or `prune`. */
    get count(): number {
        return this.players.size
    }

    /** Takes a relayed pose; `now` is the local `performance.now()` it arrived at. */
    push(msg: LivePoseMsg, now: number): void {
        const ghostId = `live:${msg.id}`
        let p = this.players.get(ghostId)
        const sample = now - msg.at
        const last = p?.samples[p.samples.length - 1]
        if (p && last) {
            if (Math.abs(sample - p.offset) > CLOCK_JUMP_MS) {
                // The sender's clock started over (a reload), or the line stalled: start again from here.
                p.samples.length = 0
                p.prev = null
                p.offset = sample
            } else if (msg.at <= last.at) {
                return
            }
        }
        if (!p) {
            p = { frame: { id: ghostId, pose: copyPose(msg.pose) }, samples: [], prev: null, offset: sample, heardAt: now }
            this.players.set(ghostId, p)
        }
        p.frame.label = msg.name
        p.frame.color = findPaint(msg.paint).color
        p.offset = sample < p.offset ? sample : p.offset + (sample - p.offset) * OFFSET_RELAX
        p.heardAt = now
        p.samples.push({ at: msg.at, pose: copyPose(msg.pose) })
        if (p.samples.length > MAX_FRAMES) p.prev = p.samples.splice(0, p.samples.length - MAX_FRAMES).pop()!
    }

    /** That player left the course. */
    remove(userId: string): void {
        this.players.delete(`live:${userId}`)
    }

    clear(): void {
        this.players.clear()
    }

    /** Drops players silent for `LIVE_STALE_MS`. */
    prune(now: number): void {
        for (const [id, p] of this.players) {
            if (now - p.heardAt > LIVE_STALE_MS) this.players.delete(id)
        }
    }

    /** The ghosts to draw at local time `now`. Frame objects are reused per player. */
    frames(now: number): GhostFrame[] {
        this.prune(now)
        const out: GhostFrame[] = []
        for (const p of this.players.values()) {
            this.place(p, now - p.offset - LIVE_DELAY_MS)
            out.push(p.frame)
        }
        return out
    }

    private place(p: Player, at: number): void {
        const s = p.samples
        const pose = p.frame.pose
        let i = 0
        while (i < s.length - 1 && s[i + 1]!.at <= at) i++
        // Older poses than the one we're blending from are no longer needed.
        if (i > 0) {
            p.prev = s[i - 1]!
            s.splice(0, i)
        }
        const a = s[0]!
        const b = s[1]
        if (at <= a.at) {
            Object.assign(pose, a.pose)
            return
        }
        if (b) {
            const t = (at - a.at) / (b.at - a.at)
            if (dist(a.pose, b.pose) > TELEPORT_M) Object.assign(pose, t < 0.5 ? a.pose : b.pose)
            else blendPose(a.pose, b.pose, t, pose)
            return
        }
        // Past the latest pose: coast on the last step's velocity a little, keep its rotation.
        Object.assign(pose, a.pose)
        const prev = p.prev
        if (prev && a.at > prev.at && dist(prev.pose, a.pose) <= TELEPORT_M) {
            const k = Math.min(at - a.at, MAX_EXTRAPOLATE_MS) / (a.at - prev.at)
            pose.x += (a.pose.x - prev.pose.x) * k
            pose.y += (a.pose.y - prev.pose.y) * k
            pose.z += (a.pose.z - prev.pose.z) * k
        }
    }
}
