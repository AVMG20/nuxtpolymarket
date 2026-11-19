import { isCustomTrackId, isPublishedTrackId } from '#shared/utils/nitro-rush/custom'
import { isPaintId, type PaintId } from '#shared/utils/nitro-rush/paints'
import { findCar, type CarId } from '#shared/utils/nitro-rush/cars'
import { findTrack } from '#shared/utils/nitro-rush/tracks'

// Nitro Rush live ghosts: players on the same course see each other as ghost
// cars. The server is a relay and nothing more: no collisions, no timing, no
// value. It keeps one room per track id in memory, stamps every pose with the
// sender's server-side id and name, and passes it on to the others in the room.
//
// One player is one presence. A player with several tabs on the same course
// counts once towards the room's cap, never sees their own car relayed back to
// any of their tabs, and shows up to the others as a single ghost
// (`live:<userId>` on the client). Only one of their tabs drives that ghost at a
// time: the one that sent a pose last, and another tab takes over only once the
// driving one has been quiet for `NR_LIVE_HANDOFF_MS` (switching tabs pauses the
// hidden one), so two tabs racing at once can't make the ghost jump between cars.
//
// Players in the track menu can watch how many players are driving each course,
// pushed as a `busy` frame when it changes.
//
// In dev, fake drivers (`server/utils/nitro-rush-fakes.ts`) can join the counts
// and send poses; they hold no socket, so they never receive frames.
//
// Everything lives in this process. Run several instances and players only see
// the ones whose sockets landed on the same instance.

/** The most live sockets the process holds at once. */
export const NR_LIVE_MAX_PEERS = 1_000
/** The most sockets one player may hold (tabs). */
export const NR_LIVE_MAX_PER_USER = 4
/** The most distinct players in one track's room. */
export const NR_LIVE_ROOM_MAX = 24
/** The most of a room's slots dev fake drivers may take. */
export const NR_LIVE_FAKE_ROOM_MAX = 6
/** Bigger frames are dropped unread; a pose is about 150 bytes. */
export const NR_LIVE_MAX_FRAME = 512
/** Token bucket per socket: clients send about 10 poses a second. */
export const NR_LIVE_RATE = 15
export const NR_LIVE_BURST = 30
/** How far from the origin a car may be, in metres, on any axis. */
export const NR_LIVE_POS_LIMIT = 50_000
/** How far a quaternion's length may stray from 1 (clients round to 4 decimals). */
export const NR_LIVE_QUAT_TOLERANCE = 0.02
/** How long a player's driving tab must be quiet before another of their tabs takes over the ghost. */
export const NR_LIVE_HANDOFF_MS = 1_000
/** A player counts as driving a course while their latest pose there is at most this old. */
export const NR_LIVE_DRIVING_MS = 5_000
/** How often watchers get the driving counts, when they changed. */
export const NR_LIVE_BUSY_TICK_MS = 2_000
/** The sender's own clock in ms (`performance.now()`), which receivers interpolate on. */
const MAX_CLOCK_MS = 1e11
const MAX_TRACK_ID = 64
const CUSTOM_ID_RE = /^[a-z0-9-]+$/i
const MAX_NAME = 24


export interface NrLivePose {
    x: number
    y: number
    z: number
    qx: number
    qy: number
    qz: number
    qw: number
}

export type NrLiveClientMsg =
    | { t: 'join', track: string }
    | { t: 'leave' }
    | { t: 'pose', at: number, paint: string, car: CarId, pose: NrLivePose }
    /** The track menu opened or closed: start or stop getting `busy` frames. */
    | { t: 'watch', on: boolean }

export type NrLiveServerMsg =
    /** Another player's car. `at` is the sender's clock in ms, only meaningful between their own poses. */
    | { t: 'pose', id: string, name: string, paint: string, car: CarId, at: number, pose: NrLivePose }
    /** That player left this course or closed their last tab on it. */
    | { t: 'gone', id: string }
    /** The room is at its cap: no ghosts on this course for now. */
    | { t: 'full', track: string }
    /** Players driving each public course right now; courses nobody drives are left out. */
    | { t: 'busy', tracks: Record<string, number> }

export interface NrLiveSocket {
    id: string
    send: (frame: string) => void
    close: (code?: number, reason?: string) => void
}

/** A built-in course, or a player's own or published one (bounded length and charset). */
export function nrLiveTrackId(id: unknown): string | null {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_TRACK_ID) return null
    if (isCustomTrackId(id) || isPublishedTrackId(id)) return CUSTOM_ID_RE.test(id) ? id : null
    return findTrack(id) ? id : null
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A pose in bounds, with its quaternion renormalized; null for anything else. */
export function nrLivePose(raw: unknown): NrLivePose | null {
    if (!raw || typeof raw !== 'object') return null
    const { x, y, z, qx, qy, qz, qw } = raw as Record<string, unknown>
    if (!finite(x) || !finite(y) || !finite(z)) return null
    if (Math.abs(x) > NR_LIVE_POS_LIMIT || Math.abs(y) > NR_LIVE_POS_LIMIT || Math.abs(z) > NR_LIVE_POS_LIMIT) return null
    if (!finite(qx) || !finite(qy) || !finite(qz) || !finite(qw)) return null
    const len = Math.hypot(qx, qy, qz, qw)
    if (Math.abs(len - 1) > NR_LIVE_QUAT_TOLERANCE) return null
    return { x, y, z, qx: qx / len, qy: qy / len, qz: qz / len, qw: qw / len }
}

/** Parses and validates one client frame; null drops it. */
export function parseNrLiveMessage(raw: string): NrLiveClientMsg | null {
    if (raw.length > NR_LIVE_MAX_FRAME) return null
    let msg: unknown
    try {
        msg = JSON.parse(raw)
    } catch {
        return null
    }
    if (!msg || typeof msg !== 'object') return null
    const m = msg as Record<string, unknown>
    switch (m.t) {
        case 'join': {
            const track = nrLiveTrackId(m.track)
            return track ? { t: 'join', track } : null
        }
        case 'leave':
            return { t: 'leave' }
        case 'watch':
            return typeof m.on === 'boolean' ? { t: 'watch', on: m.on } : null
        case 'pose': {
            if (!finite(m.at) || m.at < 0 || m.at > MAX_CLOCK_MS) return null
            if (typeof m.paint !== 'string' || !isPaintId(m.paint)) return null
            const pose = nrLivePose(m.pose)
            // Tabs still on a build from before car choice send none: they drive the first car.
            return pose ? { t: 'pose', at: m.at, paint: m.paint, car: findCar(m.car).id, pose } : null
        }
        default:
            return null
    }
}

export interface NrLiveBucket {
    tokens: number
    at: number
}

/** Takes one message's worth from the bucket; false means drop the message. */
export function takeNrLiveToken(bucket: NrLiveBucket, now: number, rate = NR_LIVE_RATE, burst = NR_LIVE_BURST): boolean {
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, now - bucket.at) / 1000 * rate)
    bucket.at = now
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
}

interface Conn {
    socket: NrLiveSocket
    userId: string
    name: string
    bucket: NrLiveBucket
    track: string | null
}

/** A player in a room: their tabs on this course and the one driving their ghost. */
interface Presence {
    conns: Set<Conn>
    driver: Conn | null
    driverAt: number
}

/** A dev fake driver: who it shows as to the players on its course. */
export interface NrLiveFake {
    id: string
    name: string
    paint: PaintId
    car: CarId
}

export class NrLiveHub {
    private conns = new Map<string, Conn>() // socket id -> conn
    private userConns = new Map<string, number>() // user id -> open sockets
    private rooms = new Map<string, Map<string, Presence>>() // track -> user id -> presence
    private watchers = new Set<Conn>()
    /** The last `busy` frame sent to the watchers. */
    private busyFrame: string | null = null
    /** Dev fake drivers, kept apart from the rooms so no socket path can reach them. */
    private fakes = new Map<string, { track: string, at: number }>() // fake id -> course and last pose

    get peerCount(): number {
        return this.conns.size
    }

    /** Distinct players on a course. */
    roomSize(track: string): number {
        return this.rooms.get(track)?.size ?? 0
    }

    /** Distinct players driving each public course at `now`; a private course is its owner's alone. */
    busyCounts(now = Date.now()): Record<string, number> {
        const counts: Record<string, number> = {}
        for (const [track, room] of this.rooms) {
            if (isCustomTrackId(track)) continue
            let n = 0
            for (const presence of room.values()) if (this.isDriving(presence, now)) n++
            if (n) counts[track] = n
        }
        for (const { track, at } of this.fakes.values()) {
            if (isCustomTrackId(track) || now - at >= NR_LIVE_DRIVING_MS) continue
            counts[track] = (counts[track] ?? 0) + 1
        }
        return counts
    }

    /** Sends the driving counts to the watchers when they changed since the last send. */
    tick(now = Date.now()): void {
        if (this.watchers.size) this.pushBusy(now)
    }

    /** Registers an authenticated socket, or closes it when the process or the player is at the cap. */
    open(socket: NrLiveSocket, user: { id: string, name: string }, now = Date.now()): boolean {
        if (this.conns.size >= NR_LIVE_MAX_PEERS) {
            socket.close(4429, 'Server full')
            return false
        }
        const tabs = this.userConns.get(user.id) ?? 0
        if (tabs >= NR_LIVE_MAX_PER_USER) {
            socket.close(4429, 'Too many tabs')
            return false
        }
        this.userConns.set(user.id, tabs + 1)
        this.conns.set(socket.id, {
            socket,
            userId: user.id,
            name: (user.name || '').trim().slice(0, MAX_NAME) || 'Racer',
            bucket: { tokens: NR_LIVE_BURST, at: now },
            track: null
        })
        return true
    }

    close(socketId: string): void {
        const conn = this.conns.get(socketId)
        if (!conn) return
        this.leave(conn)
        this.watchers.delete(conn)
        this.conns.delete(socketId)
        const tabs = (this.userConns.get(conn.userId) ?? 1) - 1
        if (tabs > 0) this.userConns.set(conn.userId, tabs)
        else this.userConns.delete(conn.userId)
    }

    message(socketId: string, raw: string, now = Date.now()): void {
        const conn = this.conns.get(socketId)
        if (!conn || raw.length > NR_LIVE_MAX_FRAME || !takeNrLiveToken(conn.bucket, now)) return
        const msg = parseNrLiveMessage(raw)
        if (!msg) return
        switch (msg.t) {
            case 'join':
                this.join(conn, msg.track)
                return
            case 'leave':
                this.leave(conn)
                return
            case 'pose':
                this.pose(conn, msg, now)
                return
            case 'watch':
                this.watch(conn, msg.on, now)
        }
    }

    private join(conn: Conn, track: string): void {
        if (conn.track === track) return
        this.leave(conn)
        let room = this.rooms.get(track)
        let presence = room?.get(conn.userId)
        if (!presence && (room?.size ?? 0) + this.fakesOn(track) >= NR_LIVE_ROOM_MAX) {
            this.sendTo(conn, { t: 'full', track })
            return
        }
        if (!room) this.rooms.set(track, room = new Map())
        if (!presence) room.set(conn.userId, presence = { conns: new Set(), driver: null, driverAt: 0 })
        presence.conns.add(conn)
        conn.track = track
    }

    private leave(conn: Conn): void {
        const track = conn.track
        if (!track) return
        conn.track = null
        const room = this.rooms.get(track)
        const presence = room?.get(conn.userId)
        if (!room || !presence) return
        presence.conns.delete(conn)
        if (presence.driver === conn) presence.driver = null
        if (presence.conns.size > 0) return
        room.delete(conn.userId)
        if (room.size === 0) {
            this.rooms.delete(track)
            return
        }
        this.broadcast(room, conn.userId, JSON.stringify({ t: 'gone', id: conn.userId } satisfies NrLiveServerMsg))
    }

    private pose(conn: Conn, msg: Extract<NrLiveClientMsg, { t: 'pose' }>, now: number): void {
        if (!conn.track) return
        const room = this.rooms.get(conn.track)
        const presence = room?.get(conn.userId)
        if (!room || !presence) return
        if (presence.driver && presence.driver !== conn && now - presence.driverAt < NR_LIVE_HANDOFF_MS) return
        presence.driver = conn
        presence.driverAt = now
        const frame: NrLiveServerMsg = { t: 'pose', id: conn.userId, name: conn.name, paint: msg.paint, car: msg.car, at: msg.at, pose: msg.pose }
        this.broadcast(room, conn.userId, JSON.stringify(frame))
    }

    /** Dev fake drivers on a course. */
    fakesOn(track: string): number {
        let n = 0
        for (const f of this.fakes.values()) if (f.track === track) n++
        return n
    }

    /** Whether a new fake may take a slot on `track`: a few at most, and only ones no real player holds. */
    fakeFits(track: string): boolean {
        const fakes = this.fakesOn(track)
        return fakes < NR_LIVE_FAKE_ROOM_MAX && this.roomSize(track) + fakes < NR_LIVE_ROOM_MAX
    }

    /** Relays a fake's pose to the real players on its course; false when a new fake finds no slot there. */
    fakePose(fake: NrLiveFake, track: string, at: number, pose: NrLivePose, now = Date.now()): boolean {
        const held = this.fakes.get(fake.id)
        if (held?.track !== track) {
            if (held) this.fakeGone(fake.id)
            if (!this.fakeFits(track)) return false
        }
        this.fakes.set(fake.id, { track, at: now })
        const room = this.rooms.get(track)
        if (!room) return true
        const frame: NrLiveServerMsg = { t: 'pose', id: fake.id, name: fake.name, paint: fake.paint, car: fake.car, at, pose }
        this.broadcast(room, fake.id, JSON.stringify(frame))
        return true
    }

    /** Takes a fake off its course and tells the real players there. */
    fakeGone(id: string): void {
        const fake = this.fakes.get(id)
        if (!fake) return
        this.fakes.delete(id)
        const room = this.rooms.get(fake.track)
        if (room) this.broadcast(room, id, JSON.stringify({ t: 'gone', id } satisfies NrLiveServerMsg))
    }

    /** A watcher gets the counts at once; when they moved since the last tick, so does every other watcher. */
    private watch(conn: Conn, on: boolean, now: number): void {
        if (!on) {
            this.watchers.delete(conn)
            return
        }
        this.watchers.add(conn)
        if (!this.pushBusy(now)) this.sendRaw(conn, this.busyFrame!)
    }

    /** Sends the counts to every watcher when they changed since the last send; false when they hadn't. */
    private pushBusy(now: number): boolean {
        const frame = this.busyFrameAt(now)
        if (frame === this.busyFrame) return false
        this.busyFrame = frame
        for (const c of this.watchers) this.sendRaw(c, frame)
        return true
    }

    /** A tab in the menu isn't driving, whatever its last pose says, so a player who just quit isn't counted on their own course. */
    private isDriving(presence: Presence, now: number): boolean {
        const driver = presence.driver
        return !!driver && now - presence.driverAt < NR_LIVE_DRIVING_MS && !this.watchers.has(driver)
    }

    private busyFrameAt(now: number): string {
        return JSON.stringify({ t: 'busy', tracks: this.busyCounts(now) } satisfies NrLiveServerMsg)
    }

    /** Sends to every tab in the room except the given player's own. */
    private broadcast(room: Map<string, Presence>, exceptUserId: string, frame: string): void {
        for (const [userId, presence] of room) {
            if (userId === exceptUserId) continue
            for (const c of presence.conns) this.sendRaw(c, frame)
        }
    }

    private sendTo(conn: Conn, msg: NrLiveServerMsg): void {
        this.sendRaw(conn, JSON.stringify(msg))
    }

    private sendRaw(conn: Conn, frame: string): void {
        try {
            conn.socket.send(frame)
        } catch {
            // The socket is going away; its close cleans up.
        }
    }
}

let hub: NrLiveHub | null = null

/** The process's one hub, with its `busy` tick; the timer never holds the process open. */
export function useNrLiveHub(): NrLiveHub {
    if (hub) return hub
    const created = hub = new NrLiveHub()
    const timer = setInterval(() => created.tick(), NR_LIVE_BUSY_TICK_MS) as { unref?: () => void }
    timer.unref?.()
    return created
}
